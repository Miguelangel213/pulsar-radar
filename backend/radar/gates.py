from __future__ import annotations

from typing import Any, Dict, List

from .models import GateResult, RadarEntry, Token


def _res(name: str, cfg: Dict[str, Any], failed: bool | None, detail: str) -> GateResult:
    status = "unknown" if failed is None else ("fail" if failed else "pass")
    return GateResult(name=name, status=status, severity=cfg[name]["severity"], detail=detail)


def _max_check(name: str, cfg, value, limit, fmt="{:.2f}") -> GateResult:
    if value is None:
        return _res(name, cfg, None, "sin dato")
    return _res(name, cfg, value > limit, f"{fmt.format(value)} (máx {fmt.format(limit)})")


def evaluate_gates(t: Token, cfg: Dict[str, Any]) -> List[GateResult]:
    g = cfg["gates"]
    out: List[GateResult] = []

    if t.is_honeypot is None:
        out.append(_res("honeypot", g, None, "sin dato"))
    else:
        out.append(_res("honeypot", g, t.is_honeypot, "honeypot detectado" if t.is_honeypot else "no es honeypot"))

    out.append(_max_check("buy_tax", g, t.buy_tax_pct, g["buy_tax"]["max_pct"], "{:.1f}%"))
    out.append(_max_check("sell_tax", g, t.sell_tax_pct, g["sell_tax"]["max_pct"], "{:.1f}%"))

    for name, val in (("mint_authority", t.mint_renounced), ("freeze_authority", t.freeze_renounced)):
        out.append(_res(name, g, None if val is None else not val,
                        "sin dato" if val is None else ("renunciado" if val else "SIN renunciar")))

    out.append(_max_check("rug_ratio", g, t.rug_ratio, g["rug_ratio"]["max"]))
    out.append(_max_check("bundlers", g, t.bundler_rate, g["bundlers"]["max_rate"]))
    out.append(_max_check("snipers", g, t.sniper_rate, g["snipers"]["max_rate"]))
    out.append(_max_check("top10_concentration", g, t.top10_rate, g["top10_concentration"]["max_rate"]))
    out.append(_max_check("dev_holding", g, t.dev_hold_rate, g["dev_holding"]["max_rate"]))

    if t.dev_rug_count is None:
        out.append(_res("dev_rug_history", g, None, "sin dato"))
    else:
        lim = g["dev_rug_history"]["max_rugs"]
        out.append(_res("dev_rug_history", g, t.dev_rug_count > lim, f"{t.dev_rug_count} rugs previos (máx {lim})"))
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
