import type { Cfg, DexClient, Pair } from "./types";

export class DexScreenerError extends Error {}
class TransientError extends Error {}   // 429, 5xx o red: se reintenta

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ventana deslizante: como máximo `max` llamadas por `perMs`; si se llena, espera. */
export class RateLimiter {
  private calls: number[] = [];
  constructor(private max: number, private perMs = 60_000, private now: () => number = Date.now, private sleep: Sleep = realSleep) {}
  async acquire(): Promise<number> {
    let waited = 0;
    for (;;) {
      const t = this.now();
      this.calls = this.calls.filter((c) => t - c < this.perMs);
      if (this.calls.length < this.max) { this.calls.push(t); return waited; }
      const delay = this.perMs - (t - this.calls[0]);
      await this.sleep(delay);
      waited += delay;
    }
  }
}

/** Cliente de solo lectura de la API pública de DexScreener (sin API key), llamada directamente desde el navegador.
 *  Cada petición pasa por: caché con TTL -> limitador por grupo -> reintentos con backoff -> último dato conocido si falla. */
export class DexScreenerClient implements DexClient {
  readonly chain: string;
  calls = 0;
  private cache = new Map<string, { exp: number; data: unknown }>();
  private limiters: Record<string, RateLimiter>;
  private base: string;

  constructor(private cfg: Cfg, private fetchFn: typeof fetch = (...a) => fetch(...a), private now: () => number = Date.now, private sleep: Sleep = realSleep) {
    const d = cfg.dexscreener;
    this.chain = d.chain;
    this.base = d.base_url.replace(/\/$/, "");
    this.limiters = Object.fromEntries(Object.entries(d.rate_limits).map(([g, n]) => [g, new RateLimiter(n, 60_000, now, sleep)]));
  }

  private async get(group: keyof Cfg["dexscreener"]["cache_ttl_s"], path: string): Promise<unknown> {
    const hit = this.cache.get(path);
    if (hit && hit.exp > this.now()) return hit.data;

    const call = async () => {
      await this.limiters[group].acquire();
      this.calls++;
      let r: Response;
      try { r = await this.fetchFn(this.base + path); } catch (e) { throw new TransientError(String(e)); }
      if (r.status === 429 || r.status >= 500) throw new TransientError(`HTTP ${r.status}`);
      if (r.status >= 400) throw new DexScreenerError(`HTTP ${r.status} en ${path}`);
      return r.json();
    };

    const b = this.cfg.dexscreener.backoff;
    let delay = b.base_delay_s * 1000;
    let data: unknown;
    for (let attempt = 0; ; attempt++) {
      try { data = await call(); break; } catch (e) {
        if (!(e instanceof TransientError)) throw e;
        if (attempt >= b.max_retries) {
          if (hit) return hit.data;   // API caída: se sirve el último dato (aunque esté caducado)
          throw new DexScreenerError("DexScreener no responde (límite de tasa o red)");
        }
        await this.sleep(delay);
        delay = Math.min(delay * b.factor, b.max_delay_s * 1000);
      }
    }
    this.cache.set(path, { exp: this.now() + this.cfg.dexscreener.cache_ttl_s[group] * 1000, data });
    return data;
  }

  async search(q: string): Promise<Pair[]> { return ((await this.get("search", `/latest/dex/search?q=${encodeURIComponent(q)}`)) as { pairs?: Pair[] }).pairs ?? []; }
  async tokenInfo(addresses: string[]): Promise<Pair[]> { return addresses.length ? (((await this.get("tokens", `/tokens/v1/${this.chain}/${addresses.join(",")}`)) as Pair[]) ?? []) : []; }
  async tokenPairs(address: string): Promise<Pair[]> { return ((await this.get("pairs", `/token-pairs/v1/${this.chain}/${address}`)) as Pair[]) ?? []; }
  async boostsLatest(): Promise<Pair[]> { return ((await this.get("boosts", "/token-boosts/latest/v1")) as Pair[]) ?? []; }
  async boostsTop(): Promise<Pair[]> { return ((await this.get("boosts", "/token-boosts/top/v1")) as Pair[]) ?? []; }
  async profilesLatest(): Promise<Pair[]> { return ((await this.get("profiles", "/token-profiles/latest/v1")) as Pair[]) ?? []; }
}
