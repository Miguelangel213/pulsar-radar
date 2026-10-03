from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any, Callable, Deque, Dict, Tuple


class RateLimitError(Exception):
    """Límite de tasa (429), error 5xx o fallo de red: se reintenta con espera exponencial."""


class TTLCache:
    def __init__(self, clock: Callable[[], float] = time.time):
        self._clock = clock
        self._data: Dict[str, Tuple[float, Any]] = {}

    def get(self, key: str):
        item = self._data.get(key)
        if item and item[0] > self._clock():
            return item[1]
        return None

    def get_stale(self, key: str):
        item = self._data.get(key)
        return item[1] if item else None

    def set(self, key: str, value: Any, ttl: float) -> None:
        self._data[key] = (self._clock() + ttl, value)


class RateLimiter:
    """Ventana deslizante: como máximo `max_calls` por `per_seconds`; si se llena, espera."""

    def __init__(self, max_calls: int, per_seconds: float = 60.0,
                 clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep):
        self.max_calls, self.per, self.clock, self.sleep = max_calls, per_seconds, clock, sleep
        self._calls: Deque[float] = deque()
        self._lock = threading.Lock()

    def acquire(self) -> float:
        """Bloquea hasta poder llamar. Devuelve los segundos esperados."""
        waited = 0.0
        with self._lock:
            while True:
                now = self.clock()
                while self._calls and now - self._calls[0] >= self.per:
                    self._calls.popleft()
                if len(self._calls) < self.max_calls:
                    self._calls.append(now)
                    return waited
                delay = self.per - (now - self._calls[0])
                self.sleep(delay)
                waited += delay


def with_backoff(fn: Callable[[], Any], cfg: Dict[str, Any], sleep: Callable[[float], None] = time.sleep):
    """Reintenta ante RateLimitError con espera exponencial."""
    delay = cfg["base_delay_s"]
    for attempt in range(cfg["max_retries"] + 1):
        try:
            return fn()
        except RateLimitError:
            if attempt == cfg["max_retries"]:
                raise
            sleep(delay)
            delay = min(delay * cfg["factor"], cfg["max_delay_s"])
