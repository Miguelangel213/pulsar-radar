from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, List, Optional, Set

from pydantic import BaseModel

from radar.models import Stage


class AlertEvent(BaseModel):
    id: int
    type: str                  # "quadrant"
    ts: float
    address: str
    symbol: str
    stage: str
    message: str
    potential: float
    risk: float
    age_min: float


class AlertService:
    """Detecta eventos comparando cada escaneo con el anterior. El primer escaneo solo fija la línea base.
    (La alerta de smart money se retiró: DexScreener no entrega datos de smart money.)"""

    def __init__(self, service, cfg: Dict[str, Any], clock: Callable[[], float] = time.time):
        self.service, self.cfg, self.clock = service, cfg, clock
        self._events: List[AlertEvent] = []
        self._fired: Set[str] = set()
        self._in_quadrant: Set[str] = set()
        self._baseline_done = False
        self._next_id = 1
        self._lock = threading.Lock()

    def scan(self) -> None:
        a = self.cfg["alerts"]
        now_quadrant: Set[str] = set()
        pending = []
        queued: Set[str] = set()
        for st in a["stages"]:
            for s in self.service.scored(Stage(st)):
                t = s.entry.token
                if s.entry.verdict == "rejected" or not s.quadrant:
                    continue
                now_quadrant.add(t.address)
                if a["quadrant_entry"] and t.address not in self._in_quadrant and t.address not in self._fired and t.address not in queued:
                    queued.add(t.address)   # un token puede estar en varias etapas: una sola alerta
                    pending.append(s)
        if self._baseline_done:
            for s in pending:
                t = s.entry.token
                self._events.append(AlertEvent(id=self._next_id, type="quadrant", ts=self.clock(), address=t.address, symbol=t.symbol,
                                               stage=next((x for x in a["stages"] if x in t.stages), t.stages[0] if t.stages else ""),
                                               message=f"{t.symbol} entró a alto potencial, bajo riesgo (potencial {s.potential.score:.0f}, riesgo {s.risk.score:.0f})",
                                               potential=s.potential.score, risk=s.risk.score, age_min=t.age_min or 0))
                self._next_id += 1
            self._events = self._events[-a["max_stored"]:]
        self._fired.update(s.entry.token.address for s in pending)
        self._in_quadrant = now_quadrant
        self._baseline_done = True

    def events(self, after: Optional[int] = None) -> Dict[str, Any]:
        with self._lock:
            self.scan()
            evs = [e for e in self._events if after is None or e.id > after]
            if after is None:
                evs = evs[-20:]
            return {"events": [e.model_dump() for e in evs], "last_id": self._next_id - 1,
                    "config": {"sound": self.cfg["alerts"]["sound"]}}
