from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable, Dict, Optional

log = logging.getLogger("radar.background")


class BackgroundScanner:
    """Hilo de fondo que ejecuta `tick` cada `interval_s` segundos mientras el backend esté vivo.
    Así el histórico se guarda aunque no haya ninguna pestaña del navegador abierta."""

    def __init__(self, tick: Callable[[], None], interval_s: float):
        self.tick, self.interval = tick, interval_s
        self.ticks = 0
        self.last_tick: Optional[float] = None
        self.last_error: Optional[str] = None
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="radar-background-scan", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while True:
            try:
                self.tick()
                self.last_error = None
            except Exception as e:            # un fallo puntual (red, API) no debe matar el hilo
                self.last_error = f"{type(e).__name__}: {e}"
                log.warning("tick falló: %s", self.last_error)
            self.ticks += 1
            self.last_tick = time.time()
            if self._stop.wait(self.interval):
                return

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout)

    def status(self) -> Dict[str, Any]:
        return {"running": bool(self._thread and self._thread.is_alive()), "interval_s": self.interval,
                "ticks": self.ticks, "last_tick": self.last_tick, "last_error": self.last_error}
