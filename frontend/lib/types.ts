export type StageKey = "new_creation" | "near_graduation" | "graduated" | "trending";
export type RiskLevel = "Sólido" | "Moderado" | "Alto" | "Extremo";
export type SortKey = "adjusted" | "potential" | "risk" | "age" | "market_cap" | "liquidity" | "volume" | "holders";

export interface Token {
  address: string; symbol: string; name: string; stage: StageKey; age_min: number; price: number;
  market_cap: number; liquidity: number; volume: number; holders: number; curve_progress: number;
  unique_buyers: number; buys: number; sells: number; narrative_tags: string[];
}
export interface GateResult { name: string; status: "pass" | "fail" | "unknown"; severity: "reject" | "red_flag"; detail: string }
export interface RadarItem {
  entry: { token: Token; gates: GateResult[]; verdict: "rejected" | "red_flags" | "clean"; failed: string[] };
  risk: { score: number; level: RiskLevel; subscores: Record<string, number>; reasons: string[] };
  potential: { score: number; subscores: Record<string, number>; note: string };
  adjusted: number;
  quadrant: boolean;
}
export interface RadarResponse {
  mode: "MOCK" | "REAL"; stage: StageKey; generated_at: number; count: number; disclaimer: string; items: RadarItem[];
  meta: { quadrant: { min_potential: number; max_risk: number }; gmgn_token_url: string };
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
  id: number; type: "quadrant" | "smart_money" | "test"; ts: number; address: string; symbol: string; stage: StageKey;
  message: string; potential: number; risk: number; age_min: number;
}
export interface AlertsResponse {
  events: AlertEvent[]; last_id: number;
  config: { smart_money_max_age_min: number; sound: { quadrant: number[]; smart_money: number[]; volume: number } };
}
