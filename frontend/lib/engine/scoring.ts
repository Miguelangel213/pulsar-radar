import { pyFixed, pyRound1 } from "./pyfmt";
import type { Cfg, Entry, PotentialScore, RiskScore, ScoredEntry, Sub, Token } from "./types";

export const ramp = (v: Sub, [lo, hi]: number[]): Sub => (v === null ? null : Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100)));
const inv = (v: Sub): Sub => (v === null ? null : 100 - v);
const avg = (vals: Sub[]): Sub => {
  const known = vals.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};
const buyRatio = (buys: number, sells: number, minTxns: number): Sub => (buys + sells >= minTxns ? buys / (buys + sells) : null);

function finish(raw: Record<string, Sub>, neutral: number): [Record<string, number>, string[]] {
  const unavailable = Object.keys(raw).filter((k) => raw[k] === null);
  const out: Record<string, number> = {};
  for (const k of Object.keys(raw)) out[k] = pyRound1(Math.max(0, Math.min(100, raw[k] === null ? neutral : (raw[k] as number))));
  return [out, unavailable];
}

// ------------------------------- RIESGO (de mercado) -------------------------------------------------------
export function riskSubscores(t: Token, c: Cfg["scoring"]): [Record<string, number>, string[]] {
  const r = c.risk;
  const liqToMcap = t.liquidity_usd !== null && t.market_cap ? t.liquidity_usd / t.market_cap : null;
  const b1 = buyRatio(t.buys.h1, t.sells.h1, c.min_txns_h1), b5 = buyRatio(t.buys.m5, t.sells.m5, c.min_txns_m5);
  const raw: Record<string, Sub> = {
    liquidity: avg([inv(ramp(t.liquidity_usd, r.liquidity.liq_ramp)), inv(ramp(liqToMcap, r.liquidity.liq_to_mcap_ramp))]),
    age: inv(ramp(t.age_min, r.age.age_ramp_min)),
    sell_pressure: avg([ramp(b1 === null ? null : 1 - b1, r.sell_pressure.sell_ratio_ramp), ramp(b5 === null ? null : 1 - b5, r.sell_pressure.sell_ratio_ramp)]),
    drop: ramp(t.price_change.h1 === null ? null : -t.price_change.h1, r.drop.drop_ramp_pct),
    contract: null,   // DexScreener no entrega seguridad del contrato
  };
  const [subs, unavailable] = finish(raw, c.unknown_neutral);
  subs.contract = r.contract_unavailable;
  return [subs, unavailable];
}

const REASON_TEXT: Record<string, string> = {
  liquidity: "Liquidez baja frente al market cap",
  age: "Par muy reciente (poca historia)",
  sell_pressure: "Más ventas que compras en la última hora",
  drop: "Caída fuerte del precio en 1 h",
};

export function scoreRisk(entry: Entry, cfg: Cfg): RiskScore {
  const c = cfg.scoring, w = c.risk.weights as Record<string, number>;
  const [subs, unavailable] = riskSubscores(entry.token, c);
  const score = pyRound1(Object.keys(w).reduce((a, k) => a + subs[k] * w[k], 0));
  const lv = c.risk.levels;
  const level = score <= lv.solid_max ? "Sólido" : score <= lv.moderate_max ? "Moderado" : score <= lv.high_max ? "Alto" : "Extremo";
  const failed = entry.gates.filter((g) => g.status === "fail");
  const reasons = [...failed.filter((g) => g.severity === "reject"), ...failed.filter((g) => g.severity !== "reject")].map((g) => `Gate ${g.name}: ${g.detail}`);
  const keys = Object.keys(REASON_TEXT).sort((a, b) => subs[b] * w[b] - subs[a] * w[a]);   // estable, como sorted(reverse=True)
  for (const k of keys) if (subs[k] >= 40 && !unavailable.includes(k)) reasons.push(`${REASON_TEXT[k]} (${pyFixed(subs[k], 0)}/100)`);
  if (!reasons.length) reasons.push("Sin señales de riesgo de mercado relevantes");
  return { score, level, subscores: subs, unavailable: [...unavailable, "contract"], reasons: reasons.slice(0, 3) };
}

// ------------------------------- POTENCIAL ------------------------------------------------------------------
export function potentialSubscores(t: Token, c: Cfg["scoring"]): [Record<string, number>, string[]] {
  const p = c.potential, br = p.buy_sell;
  const turnover = t.market_cap ? t.volume.h1 / t.market_cap : null;
  const h1 = ramp(buyRatio(t.buys.h1, t.sells.h1, c.min_txns_h1), br.buy_ratio_ramp);
  const m5 = ramp(buyRatio(t.buys.m5, t.sells.m5, c.min_txns_m5), br.buy_ratio_ramp);
  const buySell: Sub = h1 !== null && m5 !== null ? h1 * br.h1_weight + m5 * br.m5_weight : h1 !== null ? h1 : m5;
  const raw: Record<string, Sub> = {
    liquidity: ramp(t.liquidity_usd, p.liquidity.liq_ramp),
    volume: avg([ramp(turnover, p.volume.turnover_ramp), ramp(t.volume.h1, p.volume.volume_h1_ramp)]),
    market_cap: !t.market_cap ? null : inv(ramp(Math.log10(t.market_cap), p.market_cap.log10_ramp)),
    age: inv(ramp(t.age_min, p.age.age_ramp_min)),
    buy_sell: buySell,
  };
  return finish(raw, c.unknown_neutral);
}

export function scorePotential(entry: Entry, cfg: Cfg): PotentialScore {
  const c = cfg.scoring, w = c.potential.weights as Record<string, number>;
  const [subs, unavailable] = potentialSubscores(entry.token, c);
  return { score: pyRound1(Object.keys(w).reduce((a, k) => a + subs[k] * w[k], 0)), subscores: subs, unavailable, note: c.disclaimer };
}

// ------------------------------- RANKING ----------------------------------------------------------------------
export function scoreEntry(entry: Entry, cfg: Cfg): ScoredEntry {
  const c = cfg.scoring, risk = scoreRisk(entry, cfg), pot = scorePotential(entry, cfg);
  const rejected = entry.verdict === "rejected";
  const adjusted = rejected ? 0 : pyRound1(pot.score * (1 - (risk.score / 100) * c.ranking.risk_penalty));
  const q = c.ranking.quadrant;
  return { entry, risk, potential: pot, adjusted, quadrant: !rejected && pot.score >= q.min_potential && risk.score <= q.max_risk };
}
