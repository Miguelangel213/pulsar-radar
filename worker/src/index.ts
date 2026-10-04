/**
 * Proxy de SOLO LECTURA hacia la API de GMGN (https://openapi.gmgn.ai).
 *
 * Por qué existe: una página estática (GitHub Pages) no puede esconder una API key. Este Worker la guarda como
 * secreto de Cloudflare (`GMGN_API_KEY`), añade las cabeceras de autenticación y devuelve los datos. El navegador
 * nunca ve la key.
 *
 * Protecciones:
 *  - Lista cerrada de rutas de lectura (2). No hay forma de pedir nada más ni de operar/comprar/vender.
 *  - Los parámetros no los controla el visitante (solo `interval`, de una lista fija): no se puede "romper" la caché.
 *  - Solo responde a páginas de ALLOWED_ORIGINS (el navegador manda `Origin` siempre en llamadas entre sitios).
 *  - Caché de borde compartida (TTL corto): las llamadas reales a GMGN quedan acotadas sin importar el tráfico.
 *  - Si GMGN falla, sirve la última respuesta buena (marcada `stale`) durante unos minutos.
 *  - Nunca devuelve ni registra la key, ni detalles internos del error de GMGN.
 */

export interface Env {
  GMGN_API_KEY?: string;
  ALLOWED_ORIGINS?: string;
}

export interface Deps {
  fetchFn: typeof fetch;
  cache: { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> };
  now: () => number;                 // ms
  uuid: () => string;
}

const UPSTREAM = "https://openapi.gmgn.ai";
const CHAIN = "sol";
const FRESH_S = 15;                  // una respuesta se considera fresca 15 s
const STALE_S = 300;                 // si GMGN falla, se sirve hasta 5 min de antigüedad
const INTERVALS = new Set(["5m", "1h", "6h", "24h"]);

const SECTION = { filters: ["offchain", "onchain"], launchpad_platform_v2: true, limit: 80, quote_address_type: [4, 5, 3, 1, 13, 0] };
const TRENCHES_BODY = { version: "v2", new_creation: SECTION, near_completion: SECTION, completed: SECTION };

interface Route { method: "GET" | "POST"; path: string; query: (u: URL) => Record<string, string> | null; body?: unknown }

const ROUTES: Record<string, Route> = {
  "/trenches": { method: "POST", path: "/v1/trenches", query: () => ({ chain: CHAIN }), body: TRENCHES_BODY },
  "/rank": {
    method: "GET", path: "/v1/market/rank",
    query: (u) => {
      const interval = u.searchParams.get("interval") ?? "1h";
      return INTERVALS.has(interval) ? { chain: CHAIN, interval, limit: "80", order_by: "volume", direction: "desc" } : null;
    },
  },
};

const inflight = new Map<string, Promise<Result>>();

interface Result { status: number; body: unknown; stale?: boolean; fetchedAt: number; bannedUntil?: number }

function allowedOrigins(env: Env): Set<string> {
  return new Set((env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...extra } });
}

function cors(origin: string): Record<string, string> {
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };
}

const MIN_BAN_S = 30, MAX_BAN_S = 900, DEFAULT_BAN_S = 60;

/** Instante (ms) hasta el que GMGN nos pide no insistir: cabeceras Retry-After / X-RateLimit-Reset o `reset_at` del cuerpo. */
async function bannedUntilFrom(res: Response, now: number): Promise<number> {
  let sec: number | null = null;
  const ra = Number(res.headers.get("Retry-After"));
  if (Number.isFinite(ra) && ra > 0) sec = ra;
  const resetHeader = Number(res.headers.get("X-RateLimit-Reset"));
  let resetEpoch = Number.isFinite(resetHeader) && resetHeader > 1e9 ? resetHeader : null;
  try { const b = await res.clone().json() as { reset_at?: number }; if (typeof b.reset_at === "number" && b.reset_at > 1e9) resetEpoch = b.reset_at; } catch { /* cuerpo no JSON */ }
  if (resetEpoch !== null) sec = resetEpoch - now / 1000;
  const wait = Math.min(MAX_BAN_S, Math.max(MIN_BAN_S, sec ?? DEFAULT_BAN_S));
  return now + wait * 1000;
}

const banReq = () => new Request("https://cache.invalid/__ban");
async function currentBan(deps: Deps): Promise<number | null> {
  const hit = await deps.cache.match(banReq());
  const until = hit ? Number(hit.headers.get("X-Banned-Until")) : 0;
  return until > deps.now() ? until : null;
}

async function logUpstreamError(route: Route, res: Response): Promise<void> {
  try {
    const keep = ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "cf-ray", "content-type"];
    const headers = Object.fromEntries(keep.map((h) => [h, res.headers.get(h)]).filter(([, v]) => v));
    const body = (await res.clone().text()).slice(0, 300);
    console.log(JSON.stringify({ upstream_error: route.path, status: res.status, headers, body }));
  } catch { /* el registro nunca debe romper la respuesta */ }
}

async function fromUpstream(route: Route, query: Record<string, string>, env: Env, deps: Deps): Promise<Result> {
  const params = new URLSearchParams({ ...query, timestamp: String(Math.floor(deps.now() / 1000)), client_id: deps.uuid() });
  let res: Response;
  try {
    res = await deps.fetchFn(`${UPSTREAM}${route.path}?${params}`, {
      method: route.method,
      headers: { "X-APIKEY": env.GMGN_API_KEY as string, "Content-Type": "application/json" },
      body: route.body ? JSON.stringify(route.body) : undefined,
    });
  } catch {
    return { status: 502, body: { error: "gmgn_unreachable" }, fetchedAt: deps.now() };
  }
  if (res.status >= 400) await logUpstreamError(route, res);   // solo a los logs privados de Cloudflare (wrangler tail), nunca al visitante
  if (res.status === 429) {
    const until = await bannedUntilFrom(res, deps.now());
    return { status: 429, body: { error: "gmgn_rate_limited", retry_after_s: Math.max(1, Math.ceil((until - deps.now()) / 1000)) }, fetchedAt: deps.now(), bannedUntil: until };
  }
  if (res.status === 401 || res.status === 403) return { status: 502, body: { error: "gmgn_auth" }, fetchedAt: deps.now() };
  if (res.status >= 400) return { status: 502, body: { error: "gmgn_error" }, fetchedAt: deps.now() };
  let payload: { code?: number; data?: unknown };
  try { payload = await res.json(); } catch { return { status: 502, body: { error: "gmgn_bad_response" }, fetchedAt: deps.now() }; }
  if (payload.code !== 0) return { status: 502, body: { error: "gmgn_rejected" }, fetchedAt: deps.now() };
  let data = payload.data as { code?: number; data?: unknown } | undefined;
  if (data && typeof data === "object" && data.code === 0 && "data" in data) data = data.data as typeof data;   // GMGN a veces anida {code, data}
  return { status: 200, body: data, fetchedAt: deps.now() };
}

async function load(key: string, route: Route, query: Record<string, string>, env: Env, deps: Deps): Promise<Result> {
  const cacheReq = new Request(`https://cache.invalid/${key}`);
  const hit = await deps.cache.match(cacheReq);
  let cached: Result | null = null;
  if (hit) {
    cached = { status: 200, body: await hit.json(), fetchedAt: Number(hit.headers.get("X-Fetched-At")) };
    if (deps.now() - cached.fetchedAt < FRESH_S * 1000) return cached;
  }
  const ban = await currentBan(deps);
  if (ban !== null) {                                        // GMGN nos pidió esperar: no insistir (insistir alarga el bloqueo)
    return cached ? { ...cached, stale: true } : { status: 429, body: { error: "gmgn_rate_limited", retry_after_s: Math.max(1, Math.ceil((ban - deps.now()) / 1000)) }, fetchedAt: deps.now() };
  }
  const pending = inflight.get(key) ?? fromUpstream(route, query, env, deps).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  const fresh = await pending;
  if (fresh.bannedUntil) {
    await deps.cache.put(banReq(), new Response("{}", { headers: { "Cache-Control": `max-age=${Math.ceil((fresh.bannedUntil - deps.now()) / 1000)}`, "X-Banned-Until": String(fresh.bannedUntil) } }));
  }
  if (fresh.status === 200) {
    await deps.cache.put(cacheReq, new Response(JSON.stringify(fresh.body), {
      headers: { "Cache-Control": `max-age=${STALE_S}`, "X-Fetched-At": String(fresh.fetchedAt), "Content-Type": "application/json" },
    }));
    return fresh;
  }
  return cached ? { ...cached, stale: true } : fresh;       // GMGN falló: última respuesta buena, si la hay
}

export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") ?? "";
  const allowed = allowedOrigins(env).has(origin);

  if (request.method === "OPTIONS") return allowed ? new Response(null, { status: 204, headers: cors(origin) }) : json({ error: "origin_not_allowed" }, 403);
  if (!allowed) return json({ error: "origin_not_allowed" }, 403);
  const h = cors(origin);

  if (url.pathname === "/health") return json({ ok: true, configured: Boolean(env.GMGN_API_KEY) }, 200, h);   // sin datos sensibles
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, h);

  const route = ROUTES[url.pathname];
  if (!route) return json({ error: "not_found" }, 404, h);
  if (!env.GMGN_API_KEY) return json({ error: "not_configured" }, 500, h);
  const query = route.query(url);
  if (!query) return json({ error: "bad_params" }, 400, h);

  const key = `${url.pathname}?${new URLSearchParams(query)}`;
  const r = await load(key, route, query, env, deps);
  if (r.status !== 200) return json(r.body, r.status, h);
  return json({ source: "gmgn", stale: Boolean(r.stale), fetched_at: Math.floor(r.fetchedAt / 1000), data: r.body }, 200, { ...h, "Cache-Control": `public, max-age=${FRESH_S}` });
}

declare const caches: { default: Deps["cache"] };

export default {
  fetch: (request: Request, env: Env): Promise<Response> =>
    // fetch se envuelve en una función flecha: en Workers, un fetch guardado en un objeto pierde su contexto ('Illegal invocation')
    handle(request, env, { fetchFn: (input, init) => fetch(input, init), cache: caches.default, now: () => Date.now(), uuid: () => crypto.randomUUID() }),
};
