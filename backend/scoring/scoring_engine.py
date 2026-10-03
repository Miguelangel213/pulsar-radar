from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from pydantic import BaseModel

from radar.models import RadarEntry, Token

Sub = Optional[float]


def ramp(value: Sub, bounds: Sequence[float]) -> Sub:
    """Lineal [lo, hi] -> [0, 100] con tope en los extremos. None = sin dato."""
    if value is None:
        return None
    lo, hi = bounds
    return max(0.0, min(100.0, (value - lo) / (hi - lo) * 100))


def _inv(v: Sub) -> Sub:
    return None if v is None else 100 - v


def _avg(vals: List[Sub]) -> Sub:
    known = [v for v in vals if v is not None]
    return sum(known) / len(known) if known else None


def _buy_ratio(buys: float, sells: float, min_txns: float) -> Sub:
    total = buys + sells
    return buys / total if total >= min_txns else None


class RiskScore(BaseModel):
    score: float
    level: str                       # Sólido | Moderado | Alto | Extremo
    subscores: Dict[str, float]
    unavailable: List[str]           # subpuntajes sin datos (se usó el valor neutro)
    reasons: List[str]


class PotentialScore(BaseModel):
    score: float
    subscores: Dict[str, float]
    unavailable: List[str]
    note: str


class ScoredEntry(BaseModel):
    entry: RadarEntry
    risk: RiskScore
    potential: PotentialScore
    adjusted: float
    quadrant: bool


def _finish(raw: Dict[str, Sub], neutral: float) -> Tuple[Dict[str, float], List[str]]:
    unavailable = [k for k, v in raw.items() if v is None]
    return {k: round(max(0.0, min(100.0, neutral if v is None else v)), 1) for k, v in raw.items()}, unavailable


# ------------------------------- RIESGO (de mercado) ------------------------------------------------------
def risk_subscores(t: Token, c: Dict[str, Any]) -> Tuple[Dict[str, float], List[str]]:
    r = c["risk"]
    liq_to_mcap = t.liquidity_usd / t.market_cap if (t.liquidity_usd is not None and t.market_cap) else None
    raw: Dict[str, Sub] = {
        "liquidity": _avg([_inv(ramp(t.liquidity_usd, r["liquidity"]["liq_ramp"])),
                           _inv(ramp(liq_to_mcap, r["liquidity"]["liq_to_mcap_ramp"]))]),
        "age": _inv(ramp(t.age_min, r["age"]["age_ramp_min"])),
        "sell_pressure": _avg([ramp(None if (b := _buy_ratio(t.buys.h1, t.sells.h1, c["min_txns_h1"])) is None else 1 - b, r["sell_pressure"]["sell_ratio_ramp"]),
                               ramp(None if (b5 := _buy_ratio(t.buys.m5, t.sells.m5, c["min_txns_m5"])) is None else 1 - b5, r["sell_pressure"]["sell_ratio_ramp"])]),
        "drop": ramp(None if t.price_change.h1 is None else -t.price_change.h1, r["drop"]["drop_ramp_pct"]),
        "contract": None,            # DexScreener no entrega seguridad del contrato
    }
    subs, unavailable = _finish(raw, c["unknown_neutral"])
    subs["contract"] = float(r["contract_unavailable"])
    return subs, unavailable


REASON_TEXT = {
    "liquidity": "Liquidez baja frente al market cap",
    "age": "Par muy reciente (poca historia)",
    "sell_pressure": "Más ventas que compras en la última hora",
    "drop": "Caída fuerte del precio en 1 h",
}


def score_risk(entry: RadarEntry, cfg: Dict[str, Any]) -> RiskScore:
    c = cfg["scoring"]; w = c["risk"]["weights"]
    subs, unavailable = risk_subscores(entry.token, c)
    score = round(sum(subs[k] * w[k] for k in w), 1)
    lv = c["risk"]["levels"]
    level = "Sólido" if score <= lv["solid_max"] else "Moderado" if score <= lv["moderate_max"] \
        else "Alto" if score <= lv["high_max"] else "Extremo"
    reasons = [f"Gate {g.name}: {g.detail}" for g in sorted((g for g in entry.gates if g.status == "fail"), key=lambda g: g.severity != "reject")]
    for k in sorted(REASON_TEXT, key=lambda k: subs[k] * w[k], reverse=True):
        if subs[k] >= 40 and k not in unavailable:
            reasons.append(f"{REASON_TEXT[k]} ({subs[k]:.0f}/100)")
    if not reasons:
        reasons.append("Sin señales de riesgo de mercado relevantes")
    return RiskScore(score=score, level=level, subscores=subs, unavailable=unavailable + ["contract"], reasons=reasons[:3])


# ------------------------------- POTENCIAL ----------------------------------------------------------------
def potential_subscores(t: Token, c: Dict[str, Any]) -> Tuple[Dict[str, float], List[str]]:
    p = c["potential"]
    turnover = t.volume.h1 / t.market_cap if t.market_cap else None
    br = p["buy_sell"]
    h1 = ramp(_buy_ratio(t.buys.h1, t.sells.h1, c["min_txns_h1"]), br["buy_ratio_ramp"])
    m5 = ramp(_buy_ratio(t.buys.m5, t.sells.m5, c["min_txns_m5"]), br["buy_ratio_ramp"])
    if h1 is not None and m5 is not None:
        buy_sell: Sub = h1 * br["h1_weight"] + m5 * br["m5_weight"]
    else:
        buy_sell = h1 if h1 is not None else m5
    raw: Dict[str, Sub] = {
        "liquidity": ramp(t.liquidity_usd, p["liquidity"]["liq_ramp"]),
        "volume": _avg([ramp(turnover, p["volume"]["turnover_ramp"]), ramp(t.volume.h1, p["volume"]["volume_h1_ramp"])]),
        "market_cap": None if not t.market_cap else _inv(ramp(math.log10(t.market_cap), p["market_cap"]["log10_ramp"])),
        "age": _inv(ramp(t.age_min, p["age"]["age_ramp_min"])),
        "buy_sell": buy_sell,
    }
    return _finish(raw, c["unknown_neutral"])


def score_potential(entry: RadarEntry, cfg: Dict[str, Any]) -> PotentialScore:
    c = cfg["scoring"]; w = c["potential"]["weights"]
    subs, unavailable = potential_subscores(entry.token, c)
    return PotentialScore(score=round(sum(subs[k] * w[k] for k in w), 1), subscores=subs, unavailable=unavailable, note=c["disclaimer"])


# ------------------------------- RANKING ------------------------------------------------------------------
def score_entry(entry: RadarEntry, cfg: Dict[str, Any]) -> ScoredEntry:
    c = cfg["scoring"]
    risk, pot = score_risk(entry, cfg), score_potential(entry, cfg)
    rejected = entry.verdict == "rejected"
    adjusted = 0.0 if rejected else round(pot.score * (1 - risk.score / 100 * c["ranking"]["risk_penalty"]), 1)
    q = c["ranking"]["quadrant"]
    quadrant = (not rejected) and pot.score >= q["min_potential"] and risk.score <= q["max_risk"]
    return ScoredEntry(entry=entry, risk=risk, potential=pot, adjusted=adjusted, quadrant=quadrant)
