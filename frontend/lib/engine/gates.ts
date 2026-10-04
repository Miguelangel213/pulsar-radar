import { pyFixed, pyMoney0, pySigned } from "./pyfmt";
import type { Cfg, Entry, GateResult, Token } from "./types";
import type { GmgnData } from "../types";

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

  const txns = t.buys.h1 === null || t.sells.h1 === null ? null : t.buys.h1 + t.sells.h1, a = g.min_activity;
  out.push(t.age_min !== null && t.age_min < a.applies_after_min
    ? res("min_activity", g, null, `no aplica antes de ${a.applies_after_min} min de vida`)
    : txns === null ? res("min_activity", g, null, "sin dato de operaciones en 1 h")
    : res("min_activity", g, txns < a.min_txns_h1, `${pyFixed(txns, 0)} operaciones en 1 h (mín ${a.min_txns_h1})`));

  out.push(t.price_change.h1 === null
    ? res("dump_h1", g, null, "sin dato")
    : res("dump_h1", g, t.price_change.h1 <= g.dump_h1.min_change_pct, `${pySigned(t.price_change.h1, 0)}% en 1 h (límite ${g.dump_h1.min_change_pct}%)`));

  const w = g.sell_wall;
  if (txns === null || txns < w.min_txns_h1 || (t.buys.h1 === 0 && t.sells.h1 === 0)) {
    out.push(res("sell_wall", g, null, `muestra insuficiente (<${w.min_txns_h1} operaciones)`));
  } else {
    const ratio = (t.sells.h1 as number) / Math.max(t.buys.h1 as number, 1);
    out.push(res("sell_wall", g, ratio > w.max_sell_to_buy, `ventas/compras ${pyFixed(ratio, 2)} (máx ${w.max_sell_to_buy.toFixed(1)})`));
  }
  if (t.gmgn) out.push(...gmgnGates(t.gmgn, cfg));
  return out;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Hard gates con datos de GMGN (honeypot, impuestos, autoridades, rug ratio, bundlers, top 10, snipers, insiders, dev). */
export function gmgnGates(d: GmgnData, cfg: Cfg): GateResult[] {
  const g = cfg.gmgn_gates, out: GateResult[] = [];
  const add = (name: string, severity: string, failed: boolean | null, detail: string) =>
    out.push({ name, status: failed === null ? "unknown" : failed ? "fail" : "pass", severity: severity as GateResult["severity"], detail });
  const rate = (name: string, value: number | null, max: number, severity: string, fmt: (x: number) => string, limitFmt: (x: number) => string) =>
    add(name, severity, value === null ? null : value > max, value === null ? "sin dato" : `${fmt(value)} (máx ${limitFmt(max)})`);

  add("honeypot", g.honeypot.severity, d.honeypot, d.honeypot === null ? "sin dato" : d.honeypot ? "honeypot detectado" : "no es honeypot");
  const tax = d.buy_tax === null && d.sell_tax === null ? null : Math.max(d.buy_tax ?? 0, d.sell_tax ?? 0);
  add("tax", g.tax.severity, tax === null ? null : tax > g.tax.max, tax === null ? "sin dato" : `compra ${pct(d.buy_tax ?? 0)} · venta ${pct(d.sell_tax ?? 0)} (máx ${pct(g.tax.max)})`);
  add("mint_authority", g.mint_authority.severity, d.renounced_mint === null ? null : !d.renounced_mint, d.renounced_mint === null ? "sin dato" : d.renounced_mint ? "renunciado" : "SIN renunciar");
  add("freeze_authority", g.freeze_authority.severity, d.renounced_freeze === null ? null : !d.renounced_freeze, d.renounced_freeze === null ? "sin dato" : d.renounced_freeze ? "renunciado" : "SIN renunciar");
  add("wash_trading", g.wash_trading.severity, d.wash_trading, d.wash_trading === null ? "sin dato" : d.wash_trading ? "volumen falso (wash trading)" : "sin señales");

  const rug = d.rug_ratio;
  add("rug_ratio", rug !== null && rug > g.rug_ratio.reject_above ? "reject" : g.rug_ratio.severity, rug === null ? null : rug > g.rug_ratio.max,
      rug === null ? "sin dato" : `${rug.toFixed(2)} (máx ${g.rug_ratio.max.toFixed(2)}; descarte sobre ${g.rug_ratio.reject_above.toFixed(2)})`);
  rate("bundlers", d.bundler_rate, g.bundlers.max_rate, g.bundlers.severity, pct, pct);
  rate("top10", d.top10_rate, g.top10.max_rate, g.top10.severity, pct, pct);
  rate("snipers", d.sniper_count, g.snipers.max_count, g.snipers.severity, (x) => `${x}`, (x) => `${x}`);
  rate("insiders", d.insider_rate, g.insiders.max_rate, g.insiders.severity, pct, pct);
  rate("dev_holding", d.dev_hold_rate, g.dev_holding.max_rate, g.dev_holding.severity, pct, pct);

  const sd = g.serial_deployer, known = d.dev_created_count !== null && d.dev_open_ratio !== null;
  add("serial_deployer", sd.severity, known ? isSerialDeployer(d, sd) : null,
      known ? `${d.dev_created_count} lanzamientos, ${pct(d.dev_open_ratio as number)} prosperaron` : "sin dato");
  return out;
}

/** Dev con muchos lanzamientos y casi ninguno que prospere. */
export function isSerialDeployer(d: GmgnData, sd: { min_created: number; max_open_ratio: number }): boolean {
  return d.dev_created_count !== null && d.dev_open_ratio !== null && d.dev_created_count >= sd.min_created && d.dev_open_ratio < sd.max_open_ratio;
}

export function buildEntry(t: Token, cfg: Cfg): Entry {
  const gates = evaluateGates(t, cfg);
  const failed = gates.filter((x) => x.status === "fail").map((x) => x.name);
  const verdict = gates.some((x) => x.status === "fail" && x.severity === "reject") ? "rejected" : failed.length ? "red_flags" : "clean";
  return { token: t, gates, verdict, failed };
}
