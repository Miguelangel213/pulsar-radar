export type StageKey = "new_creation" | "near_graduation" | "graduated" | "trending";
export type RiskLevel = "Sólido" | "Moderado" | "Alto" | "Extremo";
export type SortKey = "adjusted" | "potential" | "risk" | "age" | "market_cap" | "liquidity" | "volume" | "txns" | "change";

/** Valores por ventana. null = la fuente no informa esa ventana (GMGN); DexScreener siempre informa números. */
export interface Win { m5: number | null; h1: number | null; h6: number | null; h24: number | null }
export interface PriceChange { m5: number | null; h1: number | null; h6: number | null; h24: number | null }
export interface Social { type: string; url: string }

/** Datos extra de GMGN (solo cuando el token viene de GMGN). null = GMGN no lo informa para ese token. */
export interface GmgnData {
  progress: number | null;                  // avance de la bonding curve, 0..1
  holders: number | null; top10_rate: number | null; rug_ratio: number | null; bundler_rate: number | null;
  sniper_count: number | null; insider_rate: number | null; bot_rate: number | null; fresh_wallet_rate: number | null;
  smart_degen_count: number | null; renowned_count: number | null;
  honeypot: boolean | null; buy_tax: number | null; sell_tax: number | null;
  renounced_mint: boolean | null; renounced_freeze: boolean | null; wash_trading: boolean | null;
  dev_hold_rate: number | null; dev_created_count: number | null; dev_open_ratio: number | null; dev_status: string | null;
  creator: string | null; launchpad: string | null; complete_timestamp: number | null;
}

export interface Token {
  address: string; symbol: string; name: string; pair_address: string; dex_id: string; url: string; image_url: string | null;
  price_usd: number | null; market_cap: number | null; fdv: number | null; liquidity_usd: number | null;
  volume: Win; buys: Win; sells: Win; price_change: PriceChange;
  pair_created_at: number | null; age_min: number | null; website: string | null; socials: Social[];
  boosts_active: number; sources: string[]; stages: StageKey[]; first_seen: number | null;
  links: { dexscreener: string; dexscreener_chart: string; solscan: string; birdeye: string; gmgn: string };
  gmgn?: GmgnData;                           // solo en tokens que vienen de GMGN
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
  mode: "DEXSCREENER" | "GMGN"; stage: StageKey; generated_at: number; count: number; disclaimer: string; items: RadarItem[];
  meta: { quadrant: { min_potential: number; max_risk: number }; coverage: string; last_scan: number | null; last_error: string | null; gmgn?: GmgnStatus };
}
/** Estado de la conexión opcional con GMGN (clave propia del visitante). */
export interface GmgnStatus {
  enabled: boolean;                          // hay una key guardada en este navegador
  active: boolean;                           // la última consulta usó GMGN
  paused_until: number | null;               // epoch s: GMGN pidió esperar (límite/bloqueo)
  error: "invalid_key" | "rate_limited" | "unreachable" | null;
  reason?: string | null;                    // motivo que dio GMGN al frenarnos (texto de GMGN, sin datos sensibles)
  strikes?: number;                          // veces seguidas que GMGN respondió 429
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
  config: { sound: { quadrant: number[]; smart_money?: number[]; volume: number } };
}
