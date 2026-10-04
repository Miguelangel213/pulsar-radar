import { GmgnAuthError, GmgnClient, GmgnError, GmgnPausedError, type GmgnKeyStore } from "./gmgn-client";
import type { GmgnScanner } from "./gmgn-scanner";
import type { TokenScanner } from "./scanner";
import type { Cfg, Scanner, ScoredEntry } from "./types";
import type { GmgnStatus } from "../types";

/** Elige la fuente de datos: GMGN si el visitante puso su key y GMGN responde; si no, DexScreener (sin key, siempre disponible).
 *  Si GMGN falla (key inválida, límite, red) cae solo a DexScreener y deja el motivo en `gmgnStatus()`. */
export class SourceManager implements Scanner {
  active: "gmgn" | "dexscreener" = "dexscreener";
  private error: GmgnStatus["error"] = null;
  private lastGmgnKey: string | null;

  constructor(readonly dex: TokenScanner, readonly gmgn: GmgnScanner, private keys: GmgnKeyStore, private client: GmgnClient, readonly cfg: Cfg) {
    this.lastGmgnKey = keys.get();
  }

  get sourceId(): string { return this.active; }
  get entries(): ScoredEntry[] { return this.active === "gmgn" ? this.gmgn.entries : this.dex.entries; }
  get lastScan(): number | null { return this.active === "gmgn" ? this.gmgn.lastScan : this.dex.lastScan; }
  get lastError(): string | null { return this.active === "gmgn" ? this.gmgn.lastError : this.dex.lastError; }

  /** Guarda o quita la key (null). Olvida respuestas y pausas anteriores. */
  setKey(key: string | null): void {
    this.keys.set(key ? key.trim() : null);
    this.client.reset();
    this.gmgn.entries = []; this.gmgn.lastScan = null;
    this.error = null; this.lastGmgnKey = this.keys.get();
    if (!this.keys.get()) this.active = "dexscreener";
  }

  gmgnStatus(): GmgnStatus {
    const until = this.client.pausedUntilMs > Date.now() ? Math.ceil(this.client.pausedUntilMs / 1000) : null;
    return { enabled: this.client.hasKey, active: this.active === "gmgn", paused_until: until, error: until ? "rate_limited" : this.error, reason: this.client.lastReason, strikes: this.client.strikes };
  }

  async scan(force = false): Promise<ScoredEntry[]> {
    if (this.client.hasKey) {
      try {
        const entries = await this.gmgn.scan(force);
        this.active = "gmgn"; this.error = null;
        return entries;
      } catch (e) {
        this.error = e instanceof GmgnAuthError ? "invalid_key" : e instanceof GmgnPausedError ? "rate_limited" : e instanceof GmgnError ? "unreachable" : "unreachable";
        if (!(e instanceof GmgnAuthError || e instanceof GmgnPausedError || e instanceof GmgnError)) throw e;
      }
    }
    this.active = "dexscreener";
    return this.dex.scan(force);
  }
}
