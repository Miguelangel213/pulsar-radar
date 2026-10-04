import type { Cfg, Scanner, ScoredEntry } from "./types";

export const SORT_KEYS: Record<string, (s: ScoredEntry) => number> = {
  adjusted: (s) => s.adjusted, potential: (s) => s.potential.score, risk: (s) => s.risk.score,
  age: (s) => s.entry.token.age_min ?? 1e12,
  market_cap: (s) => s.entry.token.market_cap ?? 0, liquidity: (s) => s.entry.token.liquidity_usd ?? 0,
  volume: (s) => s.entry.token.volume.h1 ?? 0, txns: (s) => (s.entry.token.buys.h1 ?? 0) + (s.entry.token.sells.h1 ?? 0),
  change: (s) => s.entry.token.price_change.h1 ?? -1e9,
};
const DEFAULT_ORDER: Record<string, "asc" | "desc"> = { adjusted: "desc", potential: "desc", risk: "asc", age: "asc" };

export interface Query {
  stage: string; riskLevel?: string | null; maxAge?: number | null; minLiquidity?: number | null; minMcap?: number | null; maxMcap?: number | null;
  sort?: string; order?: "asc" | "desc" | null; includeRejected?: boolean;
}

export class RadarService {
  constructor(readonly scanner: Scanner, readonly cfg: Cfg) {}

  async scored(stage: string): Promise<ScoredEntry[]> {
    return (await this.scanner.scan()).filter((s) => (s.entry.token.stages as string[]).includes(stage));
  }

  async query(q: Query): Promise<ScoredEntry[]> {
    const sort = q.sort ?? "adjusted";
    if (!(sort in SORT_KEYS)) throw new Error(`sort inválido: ${sort}`);
    const out: ScoredEntry[] = [];
    for (const s of await this.scored(q.stage)) {
      const t = s.entry.token;
      if (s.entry.verdict === "rejected" && !q.includeRejected) continue;
      if (q.riskLevel && s.risk.level.toLowerCase() !== q.riskLevel.toLowerCase()) continue;
      if (q.maxAge != null && (t.age_min === null || t.age_min > q.maxAge)) continue;
      if (q.minLiquidity != null && t.liquidity_usd !== null && t.liquidity_usd < q.minLiquidity) continue;   // liquidez desconocida (bonding curve) no se descarta
      if (q.minMcap != null && (t.market_cap || 0) < q.minMcap) continue;
      if (q.maxMcap != null && (t.market_cap || 0) > q.maxMcap) continue;
      out.push(s);
    }
    const desc = (q.order ?? DEFAULT_ORDER[sort] ?? "desc") === "desc", key = SORT_KEYS[sort];
    return out.sort((a, b) => {
      const ra = a.entry.verdict === "rejected" ? 1 : 0, rb = b.entry.verdict === "rejected" ? 1 : 0;
      if (ra !== rb) return ra - rb;                               // descartados al final
      return desc ? key(b) - key(a) : key(a) - key(b);
    });
  }
}
