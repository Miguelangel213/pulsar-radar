"""Datos de PRUEBA (solo para tests, nunca se usan en la app): pares con la forma real de DexScreener."""
from __future__ import annotations

import copy
from typing import Any, Dict, List

NOW = 1_800_000_000.0   # segundos


def pair(addr="TOKA", symbol="AAA", dex="pumpswap", age_min=20, liq=30000.0, mcap=50000.0, vol_h1=20000.0,
         buys_h1=120, sells_h1=60, buys_m5=15, sells_m5=6, chg_h1=12.0, boosts=0, chain="solana") -> Dict[str, Any]:
    return {
        "chainId": chain, "dexId": dex, "url": f"https://dexscreener.com/{chain}/pair{addr}", "pairAddress": f"pair{addr}",
        "baseToken": {"address": addr, "name": f"{symbol} coin", "symbol": symbol},
        "quoteToken": {"address": "So11111111111111111111111111111111111111112", "name": "Wrapped SOL", "symbol": "SOL"},
        "priceNative": "0.000001", "priceUsd": "0.00005",
        "txns": {"m5": {"buys": buys_m5, "sells": sells_m5}, "h1": {"buys": buys_h1, "sells": sells_h1},
                 "h6": {"buys": buys_h1 * 4, "sells": sells_h1 * 4}, "h24": {"buys": buys_h1 * 10, "sells": sells_h1 * 10}},
        "volume": {"h24": vol_h1 * 8, "h6": vol_h1 * 4, "h1": vol_h1, "m5": vol_h1 / 12},
        "priceChange": {"m5": 1.0, "h1": chg_h1, "h6": 5.0, "h24": -3.0},
        "liquidity": ({"usd": liq, "base": 1, "quote": 1} if liq is not None else None),
        "fdv": mcap, "marketCap": mcap, "pairCreatedAt": int((NOW - age_min * 60) * 1000),
        "info": {"imageUrl": "https://img/x.png", "websites": [{"url": "https://site.example", "label": "Website"}],
                 "socials": [{"url": "https://x.com/aaa", "type": "twitter"}]},
        "boosts": {"active": boosts},
    }


class FakeClient:
    """Cliente DexScreener falso con la misma interfaz, para probar el escáner sin red."""
    chain = "solana"

    def __init__(self, pairs: List[Dict[str, Any]] = (), boosts_latest=(), boosts_top=(), profiles=()):
        self.pairs = list(pairs)
        self._bl, self._bt, self._pr = list(boosts_latest), list(boosts_top), list(profiles)
        self.calls = 0
        self.token_info_calls: List[List[str]] = []
        self.fail = False

    def _row(self, addr, chain="solana"):
        return {"chainId": chain, "tokenAddress": addr}

    def boosts_latest(self): self.calls += 1; return [self._row(a, c) if isinstance(a, tuple) is False else self._row(*a) for a, c in [(x, "solana") if isinstance(x, str) else x for x in self._bl]]
    def boosts_top(self): self.calls += 1; return [self._row(a, c) for a, c in [(x, "solana") if isinstance(x, str) else x for x in self._bt]]
    def profiles_latest(self): self.calls += 1; return [self._row(a, c) for a, c in [(x, "solana") if isinstance(x, str) else x for x in self._pr]]
    def search(self, q): self.calls += 1; return copy.deepcopy(self.pairs)

    def token_info(self, addrs):
        from clients.dexscreener_client import DexScreenerError
        self.calls += 1; self.token_info_calls.append(list(addrs))
        if self.fail:
            raise DexScreenerError("caído")
        return copy.deepcopy([p for p in self.pairs if p["baseToken"]["address"] in addrs])

    def token_pairs(self, addr): self.calls += 1; return [p for p in self.pairs if p["baseToken"]["address"] == addr]
