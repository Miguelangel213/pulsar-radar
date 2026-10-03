from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from pydantic import BaseModel

from .models import RadarEntry, Token


def ramp(value: Optional[float], bounds: Sequence[float]) -> Optional[float]:
    """Lineal [lo, hi] -> [0, 100]. None se propaga (sin dato)."""
    if value is None:
        return None
    lo, hi = bounds
    return max(0.0, min(100.0, (value - lo) / (hi - lo) * 100))


def _avg(vals: List[Optional[float]], neutral: float) -> float:
    known = [v for v in vals if v is not None]
    return sum(known) / len(known) if known else neutral


def _inv(v: Optional[float]) -> Optional[float]:
    return None if v is None else 100 - v


class RiskScore(BaseModel):
    score: float
    level: str                       # Sólido | Moderado | Alto | Extremo
    subscores: Dict[str, float]
    reasons: List[str]


class PotentialScore(BaseModel):
    score: float
    subscores: Dict[str, float]
    note: str


class ScoredEntry(BaseModel):
    entry: RadarEntry
    risk: RiskScore
    potential: PotentialScore
    adjusted: float
    quadrant: bool


# ------------------------------- RIESGO -------------------------------------
def risk_subscores(t: Token, c: Dict[str, Any]) -> Dict[str, float]:
    n = c["unknown_neutral"]; r = c["risk"]

    k = r["contract"]
    worst = [100.0 if t.is_honeypot else (0.0 if t.is_honeypot is False else None),
             ramp(max([x for x in (t.buy_tax_pct, t.sell_tax_pct) if x is not None], default=None), k["tax_ramp"]),
             ramp(t.rug_ratio, k["rug_ramp"])]
    known = [w for w in worst if w is not None]
    contract = max(known) if known else n
    if t.mint_renounced is False:
        contract += k["mint_points"]
    if t.freeze_renounced is False:
        contract += k["freeze_points"]

    k = r["liquidity"]
    liq = _avg([_inv(ramp(t.liquidity, k["liq_ramp"])),
                _inv(ramp(t.liquidity / t.market_cap if t.market_cap else None, k["liq_to_mcap_ramp"]))], n)

    k = r["holders"]
    holders = _avg([ramp(t.top10_rate, k["top10_ramp"]), ramp(t.bundler_rate, k["bundler_ramp"]),
                    ramp(t.sniper_rate, k["sniper_ramp"]), _inv(ramp(t.holders, k["holders_count_ramp"]))], n)

    k = r["dev"]
    dev_parts = [ramp(t.dev_hold_rate, k["hold_ramp"]), ramp(t.dev_rug_count, k["rugs_ramp"])]
    dev = _avg(dev_parts, n) + (k["sold_points"] if t.dev_sold else 0)

    age = _inv(ramp(t.age_min, r["age"]["age_ramp_min"]))
    out = {"contract": contract, "liquidity": liq, "holders": holders, "dev": dev, "age": age}
    return {k_: round(max(0.0, min(100.0, v)), 1) for k_, v in out.items()}


REASON_TEXT = {
    "contract": "Contrato: honeypot, impuestos, rug ratio o autoridades sin renunciar",
    "liquidity": "Liquidez baja frente al market cap",
    "holders": "Distribución de holders: concentración, bundlers o snipers",
    "dev": "Dev: retiene mucho, vendió o tiene rugs previos",
    "age": "Token muy joven (poca historia)",
}


def score_risk(entry: RadarEntry, cfg: Dict[str, Any]) -> RiskScore:
    c = cfg["scoring"]; w = c["risk"]["weights"]
    subs = risk_subscores(entry.token, c)
    score = round(sum(subs[k] * w[k] for k in w), 1)
    lv = c["risk"]["levels"]
    level = "Sólido" if score <= lv["solid_max"] else "Moderado" if score <= lv["moderate_max"] \
        else "Alto" if score <= lv["high_max"] else "Extremo"

    reasons: List[str] = []
    # 1) gates fallidos (descartes primero)
    for g in sorted((g for g in entry.gates if g.status == "fail"), key=lambda g: g.severity != "reject"):
        reasons.append(f"Gate {g.name}: {g.detail}")
    # 2) subpuntajes con mayor aporte
    for k in sorted(w, key=lambda k: subs[k] * w[k], reverse=True):
        if subs[k] >= 40:
            reasons.append(f"{REASON_TEXT[k]} ({subs[k]:.0f}/100)")
    if not reasons:
        reasons.append("Sin señales de riesgo relevantes")
    return RiskScore(score=score, level=level, subscores=subs, reasons=reasons[:3])


# ------------------------------ POTENCIAL -----------------------------------
def trending_shares(trending: List[RadarEntry]) -> Dict[str, float]:
    """Proporción de tokens de Tendencias que lleva cada narrativa."""
    if not trending:
        return {}
    counts: Dict[str, int] = {}
    for e in trending:
        for tag in set(e.token.narrative_tags):
            counts[tag] = counts.get(tag, 0) + 1
    return {k: v / len(trending) for k, v in counts.items()}


def potential_subscores(t: Token, c: Dict[str, Any], shares: Dict[str, float]) -> Dict[str, float]:
    n = c["unknown_neutral"]; p = c["potential"]
    age = max(t.age_min, 1.0)

    k = p["velocity"]
    velocity = _avg([ramp(t.curve_progress / age, k["pace_ramp"]), ramp(t.unique_buyers / age, k["buyers_per_min_ramp"])], n)

    k = p["buyers"]
    early = k["early_bonus"] if (t.smart_money_first_entry_min is not None and t.smart_money_first_entry_min <= k["early_entry_max_min"]) else 0
    clean = _inv(_avg([ramp(t.sniper_rate, c["risk"]["holders"]["sniper_ramp"]),
                       ramp(t.bundler_rate, c["risk"]["holders"]["bundler_ramp"])], n))
    buyers = (0.35 * ramp(t.smart_money_buyers, k["smart_money_ramp"]) + 0.20 * ramp(t.kol_buyers, k["kol_ramp"])
              + 0.35 * clean + early)

    k = p["pressure"]
    total = t.buys + t.sells
    pressure = _avg([ramp(t.buys / total if total else None, k["buy_ratio_ramp"]),
                     ramp(t.volume / t.market_cap if t.market_cap else None, k["volume_to_mcap_ramp"])], n)

    k = p["dev"]
    if t.dev_rug_count is None:
        dev = n
    elif t.dev_rug_count > 0:
        dev = 0.0
    else:
        dev = k["clean_base"] + min(k["max_launch_points"], (t.dev_token_count or 0) * k["per_launch_points"])
    if t.dev_sold:
        dev -= k["sold_penalty"]

    share = max([shares.get(tag, 0.0) for tag in t.narrative_tags], default=0.0)
    narrative = ramp(share, p["narrative"]["trending_share_ramp"])

    out = {"velocity": velocity, "buyers": buyers, "pressure": pressure, "dev": dev, "narrative": narrative}
    return {k_: round(max(0.0, min(100.0, v)), 1) for k_, v in out.items()}


def score_potential(entry: RadarEntry, cfg: Dict[str, Any], shares: Dict[str, float]) -> PotentialScore:
    c = cfg["scoring"]; w = c["potential"]["weights"]
    subs = potential_subscores(entry.token, c, shares)
    return PotentialScore(score=round(sum(subs[k] * w[k] for k in w), 1), subscores=subs, note=c["disclaimer"])


# ------------------------------- RANKING ------------------------------------
def score_entry(entry: RadarEntry, cfg: Dict[str, Any], shares: Dict[str, float]) -> ScoredEntry:
    c = cfg["scoring"]
    risk, pot = score_risk(entry, cfg), score_potential(entry, cfg, shares)
    rejected = entry.verdict == "rejected"
    adjusted = 0.0 if rejected else round(pot.score * (1 - risk.score / 100 * c["ranking"]["risk_penalty"]), 1)
    q = c["ranking"]["quadrant"]
    quadrant = (not rejected) and pot.score >= q["min_potential"] and risk.score <= q["max_risk"]
    return ScoredEntry(entry=entry, risk=risk, potential=pot, adjusted=adjusted, quadrant=quadrant)
