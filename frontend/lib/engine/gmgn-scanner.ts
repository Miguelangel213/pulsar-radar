import { buildEntry } from "./gates";
import { GmgnClient, GmgnError, GmgnPausedError } from "./gmgn-client";
import { classifyGmgn, normalizeGmgn, type GmgnRecord } from "./gmgn-normalize";
import { scoreEntry } from "./scoring";
import type { Cfg, Pair, ScoredEntry } from "./types";

const CATEGORIES = ["new_creation", "near_completion", "completed"] as const;

/** Descubre tokens con los Trenches de GMGN (recién creados, por graduarse, graduados) y el ranking de tendencias; los puntúa. Todo en memoria. */
export class GmgnScanner {
  entries: ScoredEntry[] = [];
  lastScan: number | null = null;
  lastError: string | null = null;
  readonly sourceId = "gmgn";
  private inflight: Promise<ScoredEntry[]> | null = null;

  constructor(readonly client: GmgnClient, readonly cfg: Cfg, private clock: () => number = () => Date.now() / 1000) {}

  /** Lanza GmgnAuthError / GmgnPausedError / GmgnError: quien llama decide el plan B. */
  scan(force = false): Promise<ScoredEntry[]> {
    if (this.inflight) return this.inflight;
    const now = this.clock();
    if (!force && this.lastScan !== null && now - this.lastScan < this.cfg.gmgn.scan_interval_s) return Promise.resolve(this.entries);
    this.inflight = this.doScan(now).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async doScan(now: number): Promise<ScoredEntry[]> {
    this.lastError = null;
    // Primero la consulta barata (ranking, peso 1): si GMGN todavía nos frena, nos enteramos sin gastar la cara (trenches, peso 3).
    let rank: Pair[] = [];
    try { rank = await this.client.rank(); }
    catch (e) { if (e instanceof GmgnPausedError) throw e; if (!(e instanceof GmgnError)) throw e; this.lastError = "ranking no disponible"; }   // las tendencias son opcionales
    const trenches = (await this.client.trenches()) as Record<string, Pair[]> | null;

    const records = new Map<string, GmgnRecord>();
    for (const cat of CATEGORIES) {
      for (const row of trenches?.[cat] ?? []) {
        if (!row?.address) continue;
        const rec = records.get(row.address) ?? { row, categories: [] };
        if (!rec.categories.includes(cat)) rec.categories.push(cat);
        records.set(row.address, rec);
      }
    }
    for (const row of rank) {
      if (!row?.address) continue;
      const rec = records.get(row.address) ?? { row, categories: [] };
      rec.rank = row;
      records.set(row.address, rec);
    }

    const entries: ScoredEntry[] = [];
    for (const rec of records.values()) {
      const t = normalizeGmgn(rec, now * 1000, this.cfg);
      t.stages = classifyGmgn(t, rec, now * 1000, this.cfg) as typeof t.stages;
      t.first_seen = now;
      entries.push(scoreEntry(buildEntry(t, this.cfg), this.cfg));
    }
    this.entries = entries;
    this.lastScan = now;
    return entries;
  }
}
