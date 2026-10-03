from __future__ import annotations

from typing import Any, Dict, List, Optional

from .ingest import IngestService
from .models import Stage
from .scoring import ScoredEntry, score_entry, trending_shares

SORT_KEYS = {
    "adjusted": lambda s: s.adjusted, "potential": lambda s: s.potential.score, "risk": lambda s: s.risk.score,
    "age": lambda s: s.entry.token.age_min, "market_cap": lambda s: s.entry.token.market_cap,
    "liquidity": lambda s: s.entry.token.liquidity, "volume": lambda s: s.entry.token.volume,
    "holders": lambda s: s.entry.token.holders,
}
DEFAULT_ORDER = {"adjusted": "desc", "potential": "desc", "risk": "asc", "age": "asc"}


class RadarService:
    def __init__(self, ingest: IngestService, cfg: Dict[str, Any]):
        self.ingest, self.cfg = ingest, cfg

    def scored(self, stage: Stage) -> List[ScoredEntry]:
        shares = trending_shares(self.ingest.fetch_stage(Stage.TRENDING))
        return [score_entry(e, self.cfg, shares) for e in self.ingest.fetch_stage(stage)]

    def query(self, stage: Stage = Stage.NEW, risk_level: Optional[str] = None, max_age: Optional[float] = None,
              min_liquidity: Optional[float] = None, min_mcap: Optional[float] = None, max_mcap: Optional[float] = None,
              sort: str = "adjusted", order: Optional[str] = None, include_rejected: bool = False) -> List[ScoredEntry]:
        if sort not in SORT_KEYS:
            raise ValueError(f"sort inválido: {sort}")
        items = self.scored(stage)
        out = []
        for s in items:
            t = s.entry.token
            if s.entry.verdict == "rejected" and not include_rejected: continue
            if risk_level and s.risk.level.lower() != risk_level.lower(): continue
            if max_age is not None and t.age_min > max_age: continue
            if min_liquidity is not None and t.liquidity < min_liquidity: continue
            if min_mcap is not None and t.market_cap < min_mcap: continue
            if max_mcap is not None and t.market_cap > max_mcap: continue
            out.append(s)
        desc = (order or DEFAULT_ORDER.get(sort, "desc")) == "desc"
        # los descartados siempre al final
        out.sort(key=lambda s: (s.entry.verdict == "rejected", -SORT_KEYS[sort](s) if desc else SORT_KEYS[sort](s)))
        return out
