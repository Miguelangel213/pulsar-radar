import { beforeEach, describe, expect, it } from "vitest";
import { handle, type Deps, type Env } from "../src/index";

const SECRET = "gmgn_TEST_SECRET_VALUE_123";
const ORIGIN = "https://miguelangel213.github.io";
const env: Env = { GMGN_API_KEY: SECRET, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:3000` };

class FakeCache {
  store = new Map<string, Response>();
  async match(req: Request) { const r = this.store.get(req.url); return r ? r.clone() : undefined; }
  async put(req: Request, res: Response) { this.store.set(req.url, res.clone()); }
}

let t = 1_800_000_000_000, calls: { url: string; init: RequestInit }[] = [], upstream: () => Response, cache: FakeCache, n = 0;
const deps = (): Deps => ({
  fetchFn: (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); return upstream(); }) as unknown as typeof fetch,
  cache, now: () => t, uuid: () => `uuid-${++n}`,
});
const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
const req = (path: string, origin: string | null = ORIGIN, method = "GET") => new Request(`https://w.example${path}`, { method, headers: origin ? { Origin: origin } : {} });

beforeEach(() => { t = 1_800_000_000_000; calls = []; n = 0; cache = new FakeCache(); upstream = () => ok({ new_creation: [{ address: "A" }] }); });

describe("proxy de GMGN", () => {
  it("añade la key y los parámetros de autenticación, y devuelve los datos", async () => {
    const res = await handle(req("/trenches"), env, deps());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ source: "gmgn", stale: false, data: { new_creation: [{ address: "A" }] } });
    const c = calls[0];
    expect(c.url).toContain("https://openapi.gmgn.ai/v1/trenches?");
    expect(c.url).toContain("chain=sol"); expect(c.url).toContain("client_id=uuid-1"); expect(c.url).toContain("timestamp=1800000000");
    expect((c.init.headers as Record<string, string>)["X-APIKEY"]).toBe(SECRET);
    expect(c.init.method).toBe("POST");
    expect(JSON.parse(c.init.body as string)).toMatchObject({ version: "v2", new_creation: { limit: 80 }, near_completion: {}, completed: {} });
  });

  it("la key NUNCA aparece en la respuesta, ni en errores", async () => {
    const good = await (await handle(req("/rank"), env, deps())).text();
    upstream = () => new Response("boom", { status: 500 });
    const bad = await (await handle(req("/trenches"), env, deps())).text();
    for (const text of [good, bad]) expect(text).not.toContain(SECRET);
  });

  it("rank solo acepta intervalos de la lista cerrada", async () => {
    expect((await handle(req("/rank?interval=1h"), env, deps())).status).toBe(200);
    expect(calls[0].url).toContain("interval=1h"); expect(calls[0].init.method).toBe("GET");
    expect((await handle(req("/rank?interval=999d"), env, deps())).status).toBe(400);
    expect((await handle(req("/rank?interval=1h%26evil%3D1"), env, deps())).status).toBe(400);
  });

  it("solo existen las rutas de lectura permitidas; no se puede operar", async () => {
    for (const p of ["/v1/trade/swap", "/v1/trade/quote", "/swap", "/trenches/../x", "/"]) expect((await handle(req(p), env, deps())).status).toBe(404);
    expect(calls.length).toBe(0);
    for (const m of ["POST", "PUT", "DELETE", "PATCH"]) expect((await handle(req("/trenches", ORIGIN, m), env, deps())).status).toBe(405);
  });

  it("rechaza orígenes no autorizados y peticiones sin Origin", async () => {
    expect((await handle(req("/trenches", "https://evil.example"), env, deps())).status).toBe(403);
    expect((await handle(req("/trenches", null), env, deps())).status).toBe(403);
    expect(calls.length).toBe(0);
  });

  it("CORS: solo devuelve el origen autorizado y responde al preflight", async () => {
    const res = await handle(req("/trenches"), env, deps());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const pre = await handle(req("/trenches", ORIGIN, "OPTIONS"), env, deps());
    expect(pre.status).toBe(204); expect(pre.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect((await handle(req("/trenches", "https://evil.example", "OPTIONS"), env, deps())).status).toBe(403);
  });

  it("la caché compartida evita llamadas repetidas a GMGN durante 15 s", async () => {
    await handle(req("/trenches"), env, deps()); await handle(req("/trenches"), env, deps());
    expect(calls.length).toBe(1);
    t += 14_000; await handle(req("/trenches"), env, deps());
    expect(calls.length).toBe(1);
    t += 2_000; await handle(req("/trenches"), env, deps());
    expect(calls.length).toBe(2);
  });

  it("muchas peticiones simultáneas se agrupan en una sola llamada a GMGN", async () => {
    await Promise.all(Array.from({ length: 20 }, () => handle(req("/rank"), env, deps())));
    expect(calls.length).toBe(1);
  });

  it("si GMGN falla sirve la última respuesta buena marcada stale; sin respaldo devuelve error limpio", async () => {
    await handle(req("/trenches"), env, deps());
    t += 60_000; upstream = () => new Response("x", { status: 500 });
    const res = await handle(req("/trenches"), env, deps());
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ stale: true, data: { new_creation: [{ address: "A" }] } });
    t += 600_000;                                              // la copia ya caducó (más de 5 min)
    cache = new FakeCache();
    const bad = await handle(req("/trenches"), env, deps());
    expect(bad.status).toBe(502); expect(await bad.json()).toEqual({ error: "gmgn_error" });
  });

  it("en 429 informa cuánto esperar (si GMGN lo dice) y registra el detalle solo en los logs privados", async () => {
    const logs: string[] = []; const orig = console.log; console.log = (m: string) => logs.push(m);
    try {
      upstream = () => new Response('{"message":"too many requests"}', { status: 429, headers: { "Retry-After": "120" } });
      const res = await handle(req("/trenches"), env, deps());
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body).toEqual({ error: "gmgn_rate_limited", retry_after_s: 120 });
      expect(JSON.stringify(body)).not.toContain("too many requests");          // el detalle NO llega al visitante
      expect(logs.join("")).toContain("too many requests"); expect(logs.join("")).not.toContain(SECRET);
    } finally { console.log = orig; }
  });

  it("tras un 429/ban NO vuelve a llamar a GMGN hasta que termine (insistir alarga el bloqueo)", async () => {
    const resetAt = Math.floor(t / 1000) + 200;                       // GMGN: bloqueado 200 s
    upstream = () => new Response(JSON.stringify({ code: 429, error: "RATE_LIMIT_BANNED", reset_at: resetAt }), { status: 429 });
    const first = await handle(req("/trenches"), env, deps());
    expect(first.status).toBe(429); expect((await first.json()).retry_after_s).toBe(200);
    expect(calls.length).toBe(1);
    for (let i = 0; i < 10; i++) await handle(req(i % 2 ? "/rank" : "/trenches"), env, deps());   // el front sigue insistiendo
    expect(calls.length).toBe(1);                                      // ninguna llamada más a GMGN
    t += 100_000;
    const mid = await handle(req("/rank"), env, deps());
    expect((await mid.json()).retry_after_s).toBe(100);                // la cuenta atrás avanza
    expect(calls.length).toBe(1);
    t += 101_000; upstream = () => ok({ new_creation: [] });           // el bloqueo terminó
    const after = await handle(req("/trenches"), env, deps());
    expect(after.status).toBe(200); expect(calls.length).toBe(2);
  });

  it("durante un ban sirve la última respuesta buena (stale) en vez de error", async () => {
    await handle(req("/trenches"), env, deps());                        // dato bueno en caché
    t += 20_000;
    upstream = () => new Response(JSON.stringify({ code: 429, reset_at: Math.floor(t / 1000) + 300 }), { status: 429 });
    const res = await handle(req("/trenches"), env, deps());
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ stale: true });
  });

  it("traduce los errores de GMGN sin filtrar detalles", async () => {
    upstream = () => new Response("{}", { status: 429 });
    expect((await handle(req("/trenches"), env, deps())).status).toBe(429);
    cache = new FakeCache(); upstream = () => new Response("{}", { status: 401 });
    const auth = await handle(req("/trenches"), env, deps());
    expect(auth.status).toBe(502); expect(await auth.json()).toEqual({ error: "gmgn_auth" });
    cache = new FakeCache(); upstream = () => new Response(JSON.stringify({ code: 1, message: "secret internal detail" }));
    const rej = await handle(req("/trenches"), env, deps());
    expect(await rej.text()).not.toContain("secret internal detail");
  });

  it("desanida respuestas {code, data:{code, data}}", async () => {
    upstream = () => ok({ code: 0, data: { rank: [1, 2] } });
    expect((await (await handle(req("/rank"), env, deps())).json()).data).toEqual({ rank: [1, 2] });
  });

  it("sin key configurada responde 'not_configured' y /health no revela nada sensible", async () => {
    const noKey: Env = { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS };
    const res = await handle(req("/trenches"), noKey, deps());
    expect(res.status).toBe(500); expect(await res.json()).toEqual({ error: "not_configured" });
    const h = await handle(req("/health"), env, deps());
    expect(await h.json()).toEqual({ ok: true, configured: true });
  });

  it("si GMGN no responde (red) devuelve 502 limpio", async () => {
    const d = deps(); d.fetchFn = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    const res = await handle(req("/trenches"), env, d);
    expect(res.status).toBe(502); expect(await res.json()).toEqual({ error: "gmgn_unreachable" });
  });
});

describe("entrada real del Worker (export default)", () => {
  it("llama a fetch sin perder su contexto (en Cloudflare, un fetch guardado en un objeto lanza 'Illegal invocation')", async () => {
    const { default: worker } = await import("../src/index");
    let upstreamCalls = 0;
    const strictFetch = function (this: unknown, ..._a: unknown[]) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");   // como el fetch de Workers
      upstreamCalls++;
      return Promise.resolve(new Response(JSON.stringify({ code: 0, data: { rank: [] } })));
    };
    const fakeCache = new FakeCache();
    const g = globalThis as unknown as Record<string, unknown>;
    const prev = { fetch: g.fetch, caches: g.caches };
    g.fetch = strictFetch; g.caches = { default: fakeCache };
    try {
      const res = await worker.fetch(req("/rank"), env);
      expect(res.status).toBe(200);
      expect(upstreamCalls).toBe(1);
    } finally { g.fetch = prev.fetch; g.caches = prev.caches; }
  });
});
