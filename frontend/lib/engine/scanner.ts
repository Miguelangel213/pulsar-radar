import { buildEntry } from "./gates";
import { scoreEntry } from "./scoring";
import type { Cfg, DexClient, Pair, ScoredEntry, Token, Win } from "./types";
import { DexScreenerError } from "./client";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const win = (d: Record<string, unknown> | null | undefined): Win => ({ m5: Number(d?.m5 || 0), h1: Number(d?.h1 || 0), h6: Number(d?.h6 || 0), h24: Number(d?.h24 || 0) });

export function buildLinks(templates: Record<string, string>, address: string, pairAddress: string): Record<string, string> {
  return Object.fromEntries(Object.entries(templates).map(([k, v]) => [k, v.split("{address}").join(address).split("{pair_address}").join(pairAddress)]));
}

export function normalizePair(p: Pair, nowMs: number, linkTemplates: Record<string, string>): Token {
  const info = p.info ?? {}, txns = p.txns ?? {}, created: number | null = p.pairCreatedAt ?? null, webs: Pair[] = info.websites ?? [];
  const t = (k: "buys" | "sells") => win({ m5: txns.m5?.[k], h1: txns.h1?.[k], h6: txns.h6?.[k], h24: txns.h24?.[k] });
  const pc = p.priceChange ?? {};
  return {
    address: p.baseToken.address, symbol: p.baseToken.symbol || "?", name: p.baseToken.name || "?",
    pair_address: p.pairAddress ?? "", dex_id: p.dexId ?? "", url: p.url ?? "", image_url: info.imageUrl ?? null,
    price_usd: num(p.priceUsd), market_cap: num(p.marketCap) || num(p.fdv) || null, fdv: num(p.fdv), liquidity_usd: num(p.liquidity?.usd),
    volume: win(p.volume), buys: t("buys"), sells: t("sells"),
    price_change: { m5: num(pc.m5), h1: num(pc.h1), h6: num(pc.h6), h24: num(pc.h24) },
    pair_created_at: created, age_min: created === null ? null : Math.max(0, (nowMs - created) / 60000),
    website: webs.length ? webs[0].url ?? null : null,
    socials: (info.socials ?? []).filter((s: Pair) => s.url).map((s: Pair) => ({ type: s.type ?? "?", url: s.url })),
    boosts_active: Math.trunc(Number(p.boosts?.active || 0)), sources: [], stages: [], first_seen: null, links: buildLinks(linkTemplates, p.baseToken.address, p.pairAddress ?? "") as Token["links"],
  };
}

/** Por cada token, el par con más liquidez (desempate por volumen 24 h). Respeta el orden de primera aparición. */
export function bestPairPerToken(pairs: Pair[], chain: string): Map<string, Pair> {
  const best = new Map<string, { p: Pair; k: [number, number] }>();
  for (const p of pairs) {
    if (p.chainId !== chain || !p.baseToken?.address) continue;
    const k: [number, number] = [num(p.liquidity?.usd) || 0, num(p.volume?.h24) || 0];
    const cur = best.get(p.baseToken.address);
    if (!cur || k[0] > cur.k[0] || (k[0] === cur.k[0] && k[1] > cur.k[1])) best.set(p.baseToken.address, { p, k });
  }
  return new Map([...best].map(([a, v]) => [a, v.p]));
}

export function classify(t: Token, cfg: Cfg): string[] {
  const s = cfg.stages, out: string[] = [];
  if (t.age_min !== null && t.age_min <= s.new_creation.max_age_min) out.push("new_creation");
  if (s.near_graduation.bonding_dex_ids.includes(t.dex_id) && (t.market_cap || 0) >= s.near_graduation.min_market_cap_usd) out.push("near_graduation");
  if (s.graduated.dex_ids.includes(t.dex_id) && t.age_min !== null && t.age_min <= s.graduated.max_age_min) out.push("graduated");
  if (t.boosts_active > 0 || t.sources.includes("boost_latest") || t.sources.includes("boost_top")) out.push("trending");
  return out;
}

interface Tracked { first_seen: number; last_seen: number; sources: string[] }

/** Descubre tokens (boosts, perfiles, búsquedas), los detalla en lotes, los puntúa. Todo en memoria: no se guarda histórico. */
export class TokenScanner {
  tracked = new Map<string, Tracked>();
  entries: ScoredEntry[] = [];
  lastScan: number | null = null;
  lastError: string | null = null;
  private inflight: Promise<ScoredEntry[]> | null = null;

  constructor(readonly client: DexClient, readonly cfg: Cfg, private clock: () => number = () => Date.now() / 1000) {}

  private async discover(): Promise<Map<string, Set<string>>> {
    const found = new Map<string, Set<string>>();
    const add = (addr: string, src: string) => { if (!found.has(addr)) found.set(addr, new Set()); found.get(addr)!.add(src); };
    const feeds: [string, () => Promise<Pair[]>][] = [["boost_latest", () => this.client.boostsLatest()], ["boost_top", () => this.client.boostsTop()], ["profile", () => this.client.profilesLatest()]];
    for (const [src, fn] of feeds) {
      try { for (const row of await fn()) if (row.chainId === this.client.chain && row.tokenAddress) add(row.tokenAddress, src); }
      catch (e) { if (e instanceof DexScreenerError) this.lastError = e.message; else throw e; }
    }
    for (const q of this.cfg.scanner.search_queries as string[]) {
      try { for (const p of await this.client.search(q)) if (p.chainId === this.client.chain && p.baseToken?.address) add(p.baseToken.address, "search"); }
      catch (e) { if (e instanceof DexScreenerError) this.lastError = e.message; else throw e; }
    }
    return found;
  }

  private updateTracked(found: Map<string, Set<string>>, now: number): void {
    const sc = this.cfg.scanner;
    for (const [addr, srcs] of found) {
      const cur = this.tracked.get(addr) ?? { first_seen: now, last_seen: now, sources: [] };
      cur.last_seen = now;
      cur.sources = [...new Set([...cur.sources, ...srcs])].sort();
      this.tracked.set(addr, cur);
    }
    const cutoff = now - sc.track_hours * 3600;
    for (const [a, v] of [...this.tracked]) if (v.last_seen < cutoff) this.tracked.delete(a);
    if (this.tracked.size > sc.max_tracked) {
      const keep = [...this.tracked.keys()].sort((a, b) => this.tracked.get(b)!.last_seen - this.tracked.get(a)!.last_seen).slice(0, sc.max_tracked);
      this.tracked = new Map(keep.map((a) => [a, this.tracked.get(a)!]));
    }
  }

  scan(force = false): Promise<ScoredEntry[]> {
    if (this.inflight) return this.inflight;                       // un solo escaneo a la vez
    const now = this.clock();
    if (!force && this.lastScan !== null && now - this.lastScan < this.cfg.scanner.scan_interval_s) return Promise.resolve(this.entries);
    this.inflight = this.doScan(now).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async doScan(now: number): Promise<ScoredEntry[]> {
    this.lastError = null;
    this.updateTracked(await this.discover(), now);
    const addrs = [...this.tracked.keys()], size = this.cfg.scanner.batch_size;
    let pairs: Pair[] = [];
    for (let i = 0; i < addrs.length; i += size) {
      try { pairs = pairs.concat(await this.client.tokenInfo(addrs.slice(i, i + size))); }
      catch (e) { if (e instanceof DexScreenerError) this.lastError = e.message; else throw e; }
    }
    if (!pairs.length && this.entries.length) return this.entries;   // sin respuesta: se conserva el último estado bueno
    const entries: ScoredEntry[] = [];
    for (const [addr, pair] of bestPairPerToken(pairs, this.client.chain)) {
      const t = normalizePair(pair, now * 1000, this.cfg.links);
      const meta = this.tracked.get(addr);
      t.sources = meta?.sources ?? [];
      t.first_seen = meta?.first_seen ?? null;
      t.stages = classify(t, this.cfg) as Token["stages"];
      entries.push(scoreEntry(buildEntry(t, this.cfg), this.cfg));
    }
    this.entries = entries;
    this.lastScan = now;
    return this.entries;
  }
}
