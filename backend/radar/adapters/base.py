from __future__ import annotations

from typing import List, Protocol

from ..models import Stage, Token


class RadarAdapter(Protocol):
    mode: str   # "MOCK" | "REAL"

    def fetch(self, stage: Stage) -> List[Token]: ...
