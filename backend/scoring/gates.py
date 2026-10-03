from __future__ import annotations

from typing import Any, Dict, List

from radar.models import GateResult, RadarEntry, Token


def _res(name: str, cfg: Dict[str, Any], failed, detail: str) -> GateResult:
    status = "unknown" if failed is None else ("fail" if failed else "pass")
    return GateResult(name=name, status=status, severity=cfg[name]["severity"], detail=detail)


def evaluate_gates(t: Token, cfg: Dict[str, Any]) -> List[GateResult]:
    g = cfg["gates"]
    out: List[GateResult] = []

    lim = g["min_liquidity"]["min_usd"]
    if t.liquidity_usd is None:
        out.append(_res("min_liquidity", g, None, "sin dato (par en bonding curve)"))
    else:
        out.append(_res("min_liquidity", g, t.liquidity_usd < lim, f"${t.liquidity_usd:,.0f} (mín ${lim:,.0f})"))

    txns = t.buys.h1 + t.sells.h1
    a = g["min_activity"]
    if t.age_min is not None and t.age_min < a["applies_after_min"]:
        out.append(_res("min_activity", g, None, f"no aplica antes de {a['applies_after_min']} min de vida"))
    else:
        out.append(_res("min_activity", g, txns < a["min_txns_h1"], f"{txns:.0f} operaciones en 1 h (mín {a['min_txns_h1']})"))

    if t.price_change.h1 is None:
        out.append(_res("dump_h1", g, None, "sin dato"))
    else:
        out.append(_res("dump_h1", g, t.price_change.h1 <= g["dump_h1"]["min_change_pct"],
                        f"{t.price_change.h1:+.0f}% en 1 h (límite {g['dump_h1']['min_change_pct']}%)"))

    w = g["sell_wall"]
    if txns < w["min_txns_h1"] or t.buys.h1 == 0 and t.sells.h1 == 0:
        out.append(_res("sell_wall", g, None, f"muestra insuficiente (<{w['min_txns_h1']} operaciones)"))
    else:
        ratio = t.sells.h1 / max(t.buys.h1, 1)
        out.append(_res("sell_wall", g, ratio > w["max_sell_to_buy"], f"ventas/compras {ratio:.2f} (máx {w['max_sell_to_buy']})"))
    return out


def build_entry(t: Token, cfg: Dict[str, Any]) -> RadarEntry:
    gates = evaluate_gates(t, cfg)
    failed = [x.name for x in gates if x.status == "fail"]
    if any(x.status == "fail" and x.severity == "reject" for x in gates):
        verdict = "rejected"
    elif failed:
        verdict = "red_flags"
    else:
        verdict = "clean"
    return RadarEntry(token=t, gates=gates, verdict=verdict, failed=failed)
