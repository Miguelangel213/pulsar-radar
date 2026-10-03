export type StageKey = "new_creation" | "near_graduation" | "graduated" | "trending";
export type RiskLevel = "Sólido" | "Moderado" | "Alto" | "Extremo";
export type SortKey = "adjusted" | "potential" | "risk" | "age" | "market_cap" | "liquidity" | "volume" | "txns" | "change";

export interface Win { m5: number; h1: number; h6: number; h24: number }
export interface PriceChange { m5: number | null; h1: number | null; h6: number | null; h24: number | null }
export interface Social { type: string; url: string }

export interface Token {
  address: string; symbol: string; name: string; pair_address: string; dex_id: string; url: string; image_url: string | null;
  price_usd: number | null; market_cap: number | null; fdv: number | null; liquidity_usd: number | null;
  volume: Win; buys: Win; sells: Win; price_change: PriceChange;
  pair_created_at: number | null; age_min: number | null; website: string | null; socials: Social[];
  boosts_active: number; sources: string[]; stages: StageKey[]; first_seen: number | null;
  links: { dexscreener: string; dexscreener_chart: string; solscan: string; birdeye: string };
}
export interface GateResult { name: string; status: "pass" | "fail" | "unknown"; severity: "reject" | "red_flag"; detail: string }
export interface RadarItem {
  entry: { token: Token; gates: GateResult[]; verdict: "rejected" | "red_flags" | "clean"; failed: string[] };
  risk: { score: number; level: RiskLevel; subscores: Record<string, number>; unavailable: string[]; reasons: string[] };
  potential: { score: number; subscores: Record<string, number>; unavailable: string[]; note: string };
  adjusted: number;
  quadrant: boolean;
}
export interface RadarResponse {
  mode: "DEXSCREENER"; stage: StageKey; generated_at: number; count: number; disclaimer: string; items: RadarItem[];
  meta: { quadrant: { min_potential: number; max_risk: number }; coverage: string; last_scan: number | null; last_error: string | null };
}
export interface Filters { riskLevel: RiskLevel | ""; maxAge: string; minLiquidity: string; includeRejected: boolean }

export const STAGES: { key: StageKey; label: string }[] = [
  { key: "new_creation", label: "Recién creados" },
  { key: "near_graduation", label: "Por graduarse" },
  { key: "graduated", label: "Recién graduados" },
  { key: "trending", label: "Tendencias" },
];
export const RISK_LEVELS: RiskLevel[] = ["Sólido", "Moderado", "Alto", "Extremo"];

export interface AlertEvent {
  id: number; type: "quadrant" | "test"; ts: number; address: string; symbol: string; stage: StageKey;
  message: string; potential: number; risk: number; age_min: number;
}
export interface AlertsResponse {
  events: AlertEvent[]; last_id: number;
  config: { sound: { quadrant: number[]; volume: number } };
}
