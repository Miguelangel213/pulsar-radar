from __future__ import annotations

import time
from typing import Any, Callable, Dict, List

from .cache import RateLimitError, TTLCache, with_backoff
from .gates import build_entry
from .models import RadarEntry, Stage


class IngestService:
    def __init__(self, adapter, cfg: Dict[str, Any], cache: TTLCache | None = None,
                 clock: Callable[[], float] = time.time, sleep: Callable[[float], None] = time.sleep):
        self.adapter, self.cfg = adapter, cfg
        self.cache = cache or TTLCache(clock)
        self.sleep = sleep

    def fetch_stage(self, stage: Stage) -> List[RadarEntry]:
        key = f"stage:{stage.value}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        try:
            tokens = with_backoff(lambda: self.adapter.fetch(stage), self.cfg["cache"]["backoff"], self.sleep)
        except RateLimitError:
            stale = self.cache.get_stale(key)     # límite agotado: sirve el último dato conocido
            if stale is not None:
                return stale
            raise
        entries = [build_entry(t, self.cfg) for t in tokens]
        self.cache.set(key, entries, self.cfg["cache"]["ttl_seconds"][stage.value])
        return entries

    def fetch_all(self) -> Dict[str, List[RadarEntry]]:
        return {s.value: self.fetch_stage(s) for s in Stage}
