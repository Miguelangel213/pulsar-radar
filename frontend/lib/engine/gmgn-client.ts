import type { Cfg, Pair } from "./types";

export class GmgnAuthError extends Error {}                       // key ausente, inválida o sin permiso
export class GmgnError extends Error {}                           // fallo puntual (red, 5xx, respuesta rara)
export class GmgnPausedError extends Error {                      // GMGN pidió esperar (límite/bloqueo): no insistir
  constructor(readonly untilEpochS: number) { super("gmgn_paused"); }
}

export interface GmgnKeyStore { get(): string | null; set(key: string | null): void }

/** Estado de la pausa, compartido entre pestañas y recargas: si no, cada recarga o pestaña reintentaría y alargaría el bloqueo. */
export interface GmgnPauseState { pausedUntilMs: number; strikes: number; reason?: string | null }
export interface GmgnPauseStore { read(): GmgnPauseState; write(s: GmgnPauseState): void }

const PAUSE_KEY = "radar.gmgn_pause";
export const browserPauseStore: GmgnPauseStore = {
  read() {
    try { const v = JSON.parse(localStorage.getItem(PAUSE_KEY) || "{}"); return { pausedUntilMs: Number(v.pausedUntilMs) || 0, strikes: Number(v.strikes) || 0, reason: typeof v.reason === "string" ? v.reason.slice(0, 300) : null }; }
    catch { return { pausedUntilMs: 0, strikes: 0, reason: null }; }
  },
  write(s) { try { s.pausedUntilMs || s.strikes ? localStorage.setItem(PAUSE_KEY, JSON.stringify(s)) : localStorage.removeItem(PAUSE_KEY); } catch { /* sin almacenamiento */ } },
};
export const memoryPauseStore = (): GmgnPauseStore => { let s: GmgnPauseState = { pausedUntilMs: 0, strikes: 0, reason: null }; return { read: () => s, write: (v) => { s = v; } }; };

const STORAGE_KEY = "radar.gmgn_key";
/** La key solo vive en este navegador (localStorage) y solo se envía a openapi.gmgn.ai. */
export const browserKeyStore: GmgnKeyStore = {
  get() { try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; } },
  set(key) { try { key ? localStorage.setItem(STORAGE_KEY, key) : localStorage.removeItem(STORAGE_KEY); } catch { /* sin almacenamiento disponible */ } },
};

type Kind = "trenches" | "rank";

/** Cliente de solo lectura de GMGN (https://openapi.gmgn.ai), llamado directamente desde el navegador con la key del visitante.
 *  Respeta los límites: caché corta, una petición a la vez por tipo y, si GMGN pide esperar, no vuelve a llamar hasta que termine. */
export class GmgnClient {
  pausedUntilMs = 0;
  strikes = 0;                                                     // 429 seguidos sin ninguna respuesta buena entre medias
  lastReason: string | null = null;                                // motivo que dio GMGN en el último 429 (solo texto, sin datos sensibles)
  calls = 0;
  private cache = new Map<string, { exp: number; data: unknown }>();
  private inflight = new Map<string, Promise<unknown>>();

  constructor(
    private cfg: Cfg, private keys: GmgnKeyStore, private fetchFn: typeof fetch = (...a) => fetch(...a),
    private now: () => number = Date.now, private uuid: () => string = () => crypto.randomUUID(),
    private pause: GmgnPauseStore = browserPauseStore,
  ) { this.syncPause(); }

  get hasKey(): boolean { return Boolean(this.keys.get()); }
  /** Se llama al cambiar o quitar la key: olvida respuestas y pausas anteriores. */
  reset(): void { this.cache.clear(); this.inflight.clear(); this.pausedUntilMs = 0; this.strikes = 0; this.lastReason = null; this.pause.write({ pausedUntilMs: 0, strikes: 0 }); }

  /** Lee la pausa guardada (otra pestaña o una recarga anterior) y se queda con la más larga. */
  private syncPause(): void {
    const s = this.pause.read();
    if (s.pausedUntilMs > this.pausedUntilMs) { this.pausedUntilMs = s.pausedUntilMs; if (s.reason) this.lastReason = s.reason; }
    if (s.strikes > this.strikes) this.strikes = s.strikes;
  }

  trenches(): Promise<Pair> { return this.request("trenches") as Promise<Pair>; }
  async rank(): Promise<Pair[]> {
    const d = (await this.request("rank")) as { rank?: Pair[] } | null;
    return d?.rank ?? [];
  }

  private async request(kind: Kind): Promise<unknown> {
    const key = this.keys.get();
    if (!key) throw new GmgnAuthError("no_key");
    const hit = this.cache.get(kind);
    if (hit && hit.exp > this.now()) return hit.data;
    this.syncPause();
    if (this.now() < this.pausedUntilMs) {
      if (hit) return hit.data;                                    // durante la pausa se sirve lo último que hubo
      throw new GmgnPausedError(Math.ceil(this.pausedUntilMs / 1000));
    }
    const pending = this.inflight.get(kind) ?? this.call(kind, key).finally(() => this.inflight.delete(kind));
    this.inflight.set(kind, pending);
    try {
      const data = await pending;
      this.cache.set(kind, { exp: this.now() + this.cfg.gmgn.cache_ttl_s * 1000, data });
      return data;
    } catch (e) {
      if (hit && !(e instanceof GmgnAuthError)) return hit.data;   // fallo puntual: último dato bueno
      throw e;
    }
  }

  private async call(kind: Kind, key: string): Promise<unknown> {
    const g = this.cfg.gmgn;
    const q = new URLSearchParams(kind === "trenches"
      ? { chain: g.chain }
      : { chain: g.chain, interval: g.rank_interval, limit: "80", order_by: "volume", direction: "desc" });
    q.set("timestamp", String(Math.floor(this.now() / 1000)));
    q.set("client_id", this.uuid());
    const section = g.trenches_body;
    const init: RequestInit = kind === "trenches"
      ? { method: "POST", headers: { "X-APIKEY": key, "Content-Type": "application/json" }, body: JSON.stringify({ version: "v2", new_creation: section, near_completion: section, completed: section }) }
      : { method: "GET", headers: { "X-APIKEY": key } };
    const url = `${g.base_url}${kind === "trenches" ? "/v1/trenches" : "/v1/market/rank"}?${q}`;

    this.calls++;
    let res: Response;
    try { res = await this.fetchFn(url, init); } catch { throw new GmgnError("unreachable"); }

    if (res.status === 401 || res.status === 403) throw new GmgnAuthError("invalid_key");
    if (res.status === 429) {
      this.strikes += 1;
      this.pausedUntilMs = await this.pauseUntil(res);
      this.pause.write({ pausedUntilMs: this.pausedUntilMs, strikes: this.strikes, reason: this.lastReason });
      throw new GmgnPausedError(Math.ceil(this.pausedUntilMs / 1000));
    }
    if (res.status >= 400) throw new GmgnError(`HTTP ${res.status}`);
    let payload: { code?: number; data?: unknown };
    try { payload = await res.json(); } catch { throw new GmgnError("bad_response"); }
    if (payload.code !== 0) throw new GmgnError("rejected");
    if (this.strikes > 0) { this.strikes = 0; this.pause.write({ pausedUntilMs: 0, strikes: 0 }); }   // respuesta buena de verdad: se acabó la racha
    return unwrap(payload.data);
  }

  /** Instante hasta el que GMGN pide no insistir (`reset_at` del cuerpo o cabeceras), acotado por la configuración. */
  private async pauseUntil(res: Response): Promise<number> {
    const g = this.cfg.gmgn, now = this.now();
    let epoch: number | null = null;
    const h = Number(res.headers.get("X-RateLimit-Reset"));
    if (Number.isFinite(h) && h > 1e9) epoch = h;
    const ra = Number(res.headers.get("Retry-After"));
    if (Number.isFinite(ra) && ra > 0) epoch = now / 1000 + ra;
    try { const b = (await res.clone().json()) as { reset_at?: number }; if (typeof b.reset_at === "number" && b.reset_at > 1e9) epoch = b.reset_at; } catch { /* cuerpo no JSON */ }
    let body: { error?: unknown; message?: unknown; tier?: unknown } = {};
    try { body = (await res.clone().json()) as typeof body; } catch { /* cuerpo no JSON */ }
    this.lastReason = [body.error, body.message, body.tier ? `plan ${body.tier}` : null].filter((x) => typeof x === "string" && x).map((x) => String(x).slice(0, 120)).join(" · ") || null;
    // Espera = lo que pide GMGN + margen; y si ya van varios 429 seguidos, crece (reintentar a menudo durante un bloqueo lo alarga).
    const asked = Math.max(g.min_pause_s, epoch === null ? g.min_pause_s : epoch - now / 1000) + g.pause_margin_s;
    const escalated = g.backoff_base_s * 2 ** Math.max(0, this.strikes - 1);
    return now + Math.min(g.max_pause_s, Math.max(asked, escalated)) * 1000;
  }
}

/** GMGN a veces anida {code, data, message}: se desanida hasta llegar a los datos. */
function unwrap(data: unknown): unknown {
  let d = data as { code?: number; data?: unknown } | null;
  for (let i = 0; i < 3 && d && typeof d === "object" && d.code === 0 && "data" in d; i++) d = d.data as typeof d;
  return d;
}
