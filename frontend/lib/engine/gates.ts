import { pyFixed, pyMoney0, pySigned } from "./pyfmt";
import type { Cfg, Entry, GateResult, Token } from "./types";

type GateCfg = Cfg["gates"];
const res = (name: keyof GateCfg, g: GateCfg, failed: boolean | null, detail: string): GateResult => ({
  name, status: failed === null ? "unknown" : failed ? "fail" : "pass", severity: g[name].severity as GateResult["severity"], detail,
});

export function evaluateGates(t: Token, cfg: Cfg): GateResult[] {
  const g = cfg.gates, out: GateResult[] = [];

  const lim = g.min_liquidity.min_usd;
  out.push(t.liquidity_usd === null
    ? res("min_liquidity", g, null, "sin dato (par en bonding curve)")
    : res("min_liquidity", g, t.liquidity_usd < lim, `$${pyMoney0(t.liquidity_usd)} (mín $${pyMoney0(lim)})`));

  const txns = t.buys.h1 + t.sells.h1, a = g.min_activity;
  out.push(t.age_min !== null && t.age_min < a.applies_after_min
    ? res("min_activity", g, null, `no aplica antes de ${a.applies_after_min} min de vida`)
    : res("min_activity", g, txns < a.min_txns_h1, `${pyFixed(txns, 0)} operaciones en 1 h (mín ${a.min_txns_h1})`));

  out.push(t.price_change.h1 === null
    ? res("dump_h1", g, null, "sin dato")
    : res("dump_h1", g, t.price_change.h1 <= g.dump_h1.min_change_pct, `${pySigned(t.price_change.h1, 0)}% en 1 h (límite ${g.dump_h1.min_change_pct}%)`));

  const w = g.sell_wall;
  if (txns < w.min_txns_h1 || (t.buys.h1 === 0 && t.sells.h1 === 0)) {
    out.push(res("sell_wall", g, null, `muestra insuficiente (<${w.min_txns_h1} operaciones)`));
  } else {
    const ratio = t.sells.h1 / Math.max(t.buys.h1, 1);
    out.push(res("sell_wall", g, ratio > w.max_sell_to_buy, `ventas/compras ${pyFixed(ratio, 2)} (máx ${w.max_sell_to_buy.toFixed(1)})`));
  }
  return out;
}

export function buildEntry(t: Token, cfg: Cfg): Entry {
  const gates = evaluateGates(t, cfg);
  const failed = gates.filter((x) => x.status === "fail").map((x) => x.name);
  const verdict = gates.some((x) => x.status === "fail" && x.severity === "reject") ? "rejected" : failed.length ? "red_flags" : "clean";
  return { token: t, gates, verdict, failed };
}
