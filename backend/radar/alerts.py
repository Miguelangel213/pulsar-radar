from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel

from .models import Stage


class AlertEvent(BaseModel):
    id: int
    type: str                  # "quadrant" | "smart_money"
    ts: float
    address: str
    symbol: str
    stage: str
    message: str
    potential: float
    risk: float
    age_min: float


class AlertService:
    """Detecta eventos comparando cada escaneo con el anterior.
    El primer escaneo solo fija la línea base: lo que ya estaba ahí no cuenta como 'entrada'."""

    def __init__(self, service, cfg: Dict[str, Any], clock: Callable[[], float] = time.time):
        self.service, self.cfg, self.clock = service, cfg, clock
        self._events: List[AlertEvent] = []
        self._fired: Set[Tuple[str, str]] = set()
        self._in_quadrant: Set[str] = set()
        self._baseline_done = False
        self._next_id = 1
        self._lock = threading.Lock()

    def _emit(self, type_: str, s, message: str) -> None:
        t = s.entry.token
        self._events.append(AlertEvent(id=self._next_id, type=type_, ts=self.clock(), address=t.address, symbol=t.symbol,
                                       stage=t.stage.value, message=message, potential=s.potential.score,
                                       risk=s.risk.score, age_min=t.age_min))
        self._next_id += 1
        self._events = self._events[-self.cfg["alerts"]["max_stored"]:]

    def scan(self) -> None:
        a = self.cfg["alerts"]
        now_quadrant: Set[str] = set()
        pending: List[Tuple[str, Any, str]] = []
        for st in a["stages"]:
            for s in self.service.scored(Stage(st)):
                t = s.entry.token
                if s.entry.verdict == "rejected":
                    continue
                if s.quadrant:
                    now_quadrant.add(t.address)
                    if a["quadrant_entry"] and t.address not in self._in_quadrant and ("quadrant", t.address) not in self._fired:
                        pending.append(("quadrant", s, f"{t.symbol} entró a alto potencial, bajo riesgo "
                                                         f"(potencial {s.potential.score:.0f}, riesgo {s.risk.score:.0f})"))
                sm = a["smart_money"]
                if sm["enabled"] and t.smart_money_buyers >= sm["min_buyers"] and t.age_min <= sm["max_age_min"] \
                        and ("smart_money", t.address) not in self._fired:
                    pending.append(("smart_money", s, f"Smart money entró a {t.symbol} con {'menos de 1 min' if t.age_min < 1 else f'{t.age_min:.0f} min'} de vida "
                                                      f"({t.smart_money_buyers} wallet{'s' if t.smart_money_buyers > 1 else ''})"))
        if self._baseline_done:
            for type_, s, msg in pending:
                self._emit(type_, s, msg)
        self._fired.update((type_, s.entry.token.address) for type_, s, _ in pending)
        self._in_quadrant = now_quadrant
        self._baseline_done = True

    def events(self, after: Optional[int] = None) -> Dict[str, Any]:
        with self._lock:
            self.scan()
            evs = [e for e in self._events if after is None or e.id > after]
            if after is None:
                evs = evs[-20:]
            return {"events": [e.model_dump() for e in evs], "last_id": self._next_id - 1,
                    "config": {"smart_money_max_age_min": self.cfg["alerts"]["smart_money"]["max_age_min"],
                               "sound": self.cfg["alerts"]["sound"]}}
