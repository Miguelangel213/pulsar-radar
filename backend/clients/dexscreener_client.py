from __future__ import annotations

import time
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import quote

import httpx

from radar.cache import RateLimiter, RateLimitError, TTLCache, with_backoff


class DexScreenerError(Exception):
    """DexScreener no respondió (tras reintentos) o rechazó la petición."""


class DexScreenerClient:
    """Cliente de solo lectura de la API pública de DexScreener (sin API key).
    Cada petición pasa por: caché con TTL -> limitador de tasa por grupo -> reintentos con backoff.
    Si se agotan los reintentos, sirve el último dato en caché (aunque esté caducado)."""

    def __init__(self, cfg: Dict[str, Any], http: Optional[httpx.Client] = None,
                 clock: Callable[[], float] = time.time, sleep: Callable[[float], None] = time.sleep):
        d = cfg["dexscreener"]
        self.base, self.chain, self.ttl, self.backoff = d["base_url"].rstrip("/"), d["chain"], d["cache_ttl_s"], d["backoff"]
        self.sleep = sleep
        self.http = http or httpx.Client(timeout=d["timeout_s"], headers={"User-Agent": "radar-memecoins/0.1 (read-only)"})
        self.cache = TTLCache(clock)
        self.limiters = {g: RateLimiter(n, 60.0, sleep=sleep) for g, n in d["rate_limits"].items()}
        self.calls = 0

    def _get(self, group: str, path: str) -> Any:
        hit = self.cache.get(path)
        if hit is not None:
            return hit

        def call():
            self.limiters[group].acquire()
            self.calls += 1
            try:
                r = self.http.get(self.base + path)
            except httpx.TransportError as e:
                raise RateLimitError(str(e))
            if r.status_code == 429 or r.status_code >= 500:
                raise RateLimitError(f"HTTP {r.status_code}")
            if r.status_code >= 400:
                raise DexScreenerError(f"HTTP {r.status_code} en {path}")
            return r.json()

        try:
            data = with_backoff(call, self.backoff, self.sleep)
        except RateLimitError:
            stale = self.cache.get_stale(path)
            if stale is not None:
                return stale
            raise DexScreenerError("DexScreener no responde (límite de tasa o red)")
        self.cache.set(path, data, self.ttl[group])
        return data

    # --- Endpoints ---------------------------------------------------------------------------------------
    def search(self, query: str) -> List[Dict[str, Any]]:
        """GET /latest/dex/search?q={query} -> pares (de todas las cadenas)."""
        return self._get("search", f"/latest/dex/search?q={quote(query)}").get("pairs") or []

    def token_info(self, addresses: List[str]) -> List[Dict[str, Any]]:
        """GET /tokens/v1/{chain}/{a,b,c} (hasta 30 direcciones) -> pares de esos tokens."""
        if not addresses:
            return []
        return self._get("tokens", f"/tokens/v1/{self.chain}/{','.join(addresses)}") or []

    def token_pairs(self, address: str) -> List[Dict[str, Any]]:
        """GET /token-pairs/v1/{chain}/{address} -> todos los pools de un token."""
        return self._get("pairs", f"/token-pairs/v1/{self.chain}/{address}") or []

    def boosts_latest(self) -> List[Dict[str, Any]]:
        """GET /token-boosts/latest/v1"""
        return self._get("boosts", "/token-boosts/latest/v1") or []

    def boosts_top(self) -> List[Dict[str, Any]]:
        """GET /token-boosts/top/v1"""
        return self._get("boosts", "/token-boosts/top/v1") or []

    def profiles_latest(self) -> List[Dict[str, Any]]:
        """GET /token-profiles/latest/v1 (añadido: es la única fuente gratuita de tokens recién publicados)."""
        return self._get("profiles", "/token-profiles/latest/v1") or []
