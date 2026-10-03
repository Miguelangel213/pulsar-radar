from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel


class Stage(str, Enum):
    NEW = "new_creation"
    NEAR = "near_graduation"
    GRADUATED = "graduated"
    TRENDING = "trending"


class Window(BaseModel):
    """Valores por ventana de tiempo de DexScreener."""
    m5: float = 0
    h1: float = 0
    h6: float = 0
    h24: float = 0


class PriceChange(BaseModel):
    m5: Optional[float] = None
    h1: Optional[float] = None
    h6: Optional[float] = None
    h24: Optional[float] = None


class Social(BaseModel):
    type: str
    url: str


class Token(BaseModel):
    """Token normalizado desde un par de DexScreener (se elige el par con más liquidez)."""
    address: str
    symbol: str
    name: str
    pair_address: str
    dex_id: str
    url: str                                   # página del par en DexScreener
    image_url: Optional[str] = None
    price_usd: Optional[float] = None
    market_cap: Optional[float] = None
    fdv: Optional[float] = None
    liquidity_usd: Optional[float] = None      # None en pares de bonding curve (pump.fun)
    volume: Window = Window()
    buys: Window = Window()
    sells: Window = Window()
    price_change: PriceChange = PriceChange()
    pair_created_at: Optional[int] = None      # ms epoch
    age_min: Optional[float] = None
    website: Optional[str] = None
    socials: List[Social] = []
    boosts_active: int = 0
    sources: List[str] = []                    # cómo se descubrió: boost_latest, boost_top, profile, search
    stages: List[str] = []                     # etapas a las que pertenece ahora
    first_seen: Optional[float] = None


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
