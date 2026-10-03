from __future__ import annotations

from typing import Any, Dict, List, Optional

from radar.models import Stage
from scoring.scoring_engine import ScoredEntry
from services.token_scanner import TokenScanner

SORT_KEYS = {
    "adjusted": lambda s: s.adjusted, "potential": lambda s: s.potential.score, "risk": lambda s: s.risk.score,
    "age": lambda s: s.entry.token.age_min if s.entry.token.age_min is not None else 1e12,
    "market_cap": lambda s: s.entry.token.market_cap or 0, "liquidity": lambda s: s.entry.token.liquidity_usd or 0,
    "volume": lambda s: s.entry.token.volume.h1, "txns": lambda s: s.entry.token.buys.h1 + s.entry.token.sells.h1,
    "change": lambda s: s.entry.token.price_change.h1 if s.entry.token.price_change.h1 is not None else -1e9,
}
DEFAULT_ORDER = {"adjusted": "desc", "potential": "desc", "risk": "asc", "age": "asc"}


class RadarService:
    def __init__(self, scanner: TokenScanner, cfg: Dict[str, Any]):
        self.scanner, self.cfg = scanner, cfg

    def scored(self, stage: Stage) -> List[ScoredEntry]:
        return [s for s in self.scanner.scan() if stage.value in s.entry.token.stages]

    def query(self, stage: Stage = Stage.NEW, risk_level: Optional[str] = None, max_age: Optional[float] = None,
              min_liquidity: Optional[float] = None, min_mcap: Optional[float] = None, max_mcap: Optional[float] = None,
              sort: str = "adjusted", order: Optional[str] = None, include_rejected: bool = False) -> List[ScoredEntry]:
        if sort not in SORT_KEYS:
            raise ValueError(f"sort inválido: {sort}")
        out = []
        for s in self.scored(stage):
            t = s.entry.token
            if s.entry.verdict == "rejected" and not include_rejected: continue
            if risk_level and s.risk.level.lower() != risk_level.lower(): continue
            if max_age is not None and (t.age_min is None or t.age_min > max_age): continue
            if min_liquidity is not None and t.liquidity_usd is not None and t.liquidity_usd < min_liquidity: continue   # liquidez desconocida (bonding curve) no se descarta
            if min_mcap is not None and (t.market_cap or 0) < min_mcap: continue
            if max_mcap is not None and (t.market_cap or 0) > max_mcap: continue
            out.append(s)
        desc = (order or DEFAULT_ORDER.get(sort, "desc")) == "desc"
        out.sort(key=lambda s: (s.entry.verdict == "rejected", -SORT_KEYS[sort](s) if desc else SORT_KEYS[sort](s)))   # descartados al final
        return out
