from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class Stage(str, Enum):
    NEW = "new_creation"
    NEAR = "near_graduation"
    GRADUATED = "graduated"
    TRENDING = "trending"


class Token(BaseModel):
    """Esquema interno PROVISIONAL. El adaptador real (etapa 8) mapeará los campos de GMGN a este modelo."""
    address: str
    symbol: str
    name: str
    stage: Stage
    age_min: float
    price: float
    market_cap: float
    liquidity: float
    volume: float
    holders: int
    curve_progress: float = Field(ge=0, le=1)
    unique_buyers: int = 0
    buys: int = 0
    sells: int = 0
    narrative_tags: List[str] = []

    # Seguridad (None = sin dato)
    is_honeypot: Optional[bool] = None
    buy_tax_pct: Optional[float] = None
    sell_tax_pct: Optional[float] = None
    mint_renounced: Optional[bool] = None
    freeze_renounced: Optional[bool] = None
    rug_ratio: Optional[float] = None
    bundler_rate: Optional[float] = None
    sniper_rate: Optional[float] = None
    top10_rate: Optional[float] = None

    # Dev
    dev_hold_rate: Optional[float] = None
    dev_rug_count: Optional[int] = None
    dev_token_count: Optional[int] = None
    dev_sold: Optional[bool] = None

    # Compradores
    smart_money_buyers: int = 0
    kol_buyers: int = 0
    smart_money_first_entry_min: Optional[float] = None


class GateResult(BaseModel):
    name: str
    status: str            # "pass" | "fail" | "unknown"
    severity: str          # "reject" | "red_flag"
    detail: str


class RadarEntry(BaseModel):
    token: Token
    gates: List[GateResult]
    verdict: str           # "rejected" | "red_flags" | "clean"
    failed: List[str]
