// Tipos internos del motor (los de salida —Token, RadarItem…— viven en lib/types.ts y son los que usa la interfaz).
import type { GateResult, PriceChange, RadarItem, Social, Token, Win } from "../types";
import CONFIG from "./config.generated.json";

export type Cfg = typeof CONFIG;
export type { GateResult, PriceChange, RadarItem, Social, Token, Win };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Pair = Record<string, any>;
export type Sub = number | null;

export interface Entry { token: Token; gates: GateResult[]; verdict: "rejected" | "red_flags" | "clean"; failed: string[] }
export interface RiskScore { score: number; level: string; subscores: Record<string, number>; unavailable: string[]; reasons: string[] }
export interface PotentialScore { score: number; subscores: Record<string, number>; unavailable: string[]; note: string }
export interface ScoredEntry { entry: Entry; risk: RiskScore; potential: PotentialScore; adjusted: number; quadrant: boolean }

/** Lo que RadarService y AlertService necesitan de una fuente de datos. */
export interface Scanner {
  scan(force?: boolean): Promise<ScoredEntry[]>;
  readonly lastScan: number | null;
  readonly lastError: string | null;
  readonly sourceId?: string;
}

export interface DexClient {
  chain: string;
  boostsLatest(): Promise<Pair[]>;
  boostsTop(): Promise<Pair[]>;
  profilesLatest(): Promise<Pair[]>;
  search(q: string): Promise<Pair[]>;
  tokenInfo(addresses: string[]): Promise<Pair[]>;
}
