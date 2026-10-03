from __future__ import annotations

import time
from typing import Any, Callable, Dict, Tuple


class RateLimitError(Exception):
    """El adaptador la lanza ante un 429 / límite de tasa."""


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
