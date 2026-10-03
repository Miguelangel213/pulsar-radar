from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set

from clients.dexscreener_client import DexScreenerClient, DexScreenerError
from radar.config import BACKEND_DIR
from radar.models import PriceChange, Social, Stage, Token, Window
from scoring.gates import build_entry
from scoring.scoring_engine import ScoredEntry, score_entry
from services.db import SqliteStore
from services.store import JsonStore


def _f(v: Any) -> Optional[float]:
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def _window(d: Optional[Dict[str, Any]]) -> Window:
    d = d or {}
    return Window(**{k: float(d.get(k) or 0) for k in ("m5", "h1", "h6", "h24")})


def build_links(templates: Optional[Dict[str, str]], address: str, pair_address: str) -> Dict[str, str]:
    return {k: v.format(address=address, pair_address=pair_address) for k, v in (templates or {}).items()}


def normalize_pair(p: Dict[str, Any], now_ms: float, link_templates: Optional[Dict[str, str]] = None) -> Token:
    info = p.get("info") or {}
    created = p.get("pairCreatedAt")
    txns = p.get("txns") or {}
    webs = info.get("websites") or []
    return Token(
        address=p["baseToken"]["address"], symbol=p["baseToken"].get("symbol") or "?", name=p["baseToken"].get("name") or "?",
        pair_address=p.get("pairAddress", ""), dex_id=p.get("dexId", ""), url=p.get("url", ""), image_url=info.get("imageUrl"),
        price_usd=_f(p.get("priceUsd")), market_cap=_f(p.get("marketCap")) or _f(p.get("fdv")), fdv=_f(p.get("fdv")),
        liquidity_usd=_f((p.get("liquidity") or {}).get("usd")),
        volume=_window(p.get("volume")),
        buys=_window({k: (txns.get(k) or {}).get("buys") for k in ("m5", "h1", "h6", "h24")}),
        sells=_window({k: (txns.get(k) or {}).get("sells") for k in ("m5", "h1", "h6", "h24")}),
        price_change=PriceChange(**{k: _f((p.get("priceChange") or {}).get(k)) for k in ("m5", "h1", "h6", "h24")}),
        pair_created_at=created, age_min=None if created is None else max(0.0, (now_ms - created) / 60000),
        website=(webs[0].get("url") if webs else None),
        socials=[Social(type=s.get("type", "?"), url=s["url"]) for s in (info.get("socials") or []) if s.get("url")],
        boosts_active=int((p.get("boosts") or {}).get("active") or 0),
        links=build_links(link_templates, p["baseToken"]["address"], p.get("pairAddress", "")),
    )


def best_pair_per_token(pairs: List[Dict[str, Any]], chain: str) -> Dict[str, Dict[str, Any]]:
    """Por cada token, el par con más liquidez (desempate por volumen 24 h)."""
    best: Dict[str, Dict[str, Any]] = {}
    for p in pairs:
        if p.get("chainId") != chain or not p.get("baseToken", {}).get("address"):
            continue
        key = (_f((p.get("liquidity") or {}).get("usd")) or 0, _f((p.get("volume") or {}).get("h24")) or 0)
        addr = p["baseToken"]["address"]
        cur = best.get(addr)
        if cur is None or key > cur["_k"]:
            best[addr] = dict(p, _k=key)
    return best


def classify(t: Token, cfg: Dict[str, Any]) -> List[str]:
    s = cfg["stages"]; out: List[str] = []
    if t.age_min is not None and t.age_min <= s["new_creation"]["max_age_min"]:
        out.append(Stage.NEW.value)
    if t.dex_id in s["near_graduation"]["bonding_dex_ids"] and (t.market_cap or 0) >= s["near_graduation"]["min_market_cap_usd"]:
        out.append(Stage.NEAR.value)
    if t.dex_id in s["graduated"]["dex_ids"] and t.age_min is not None and t.age_min <= s["graduated"]["max_age_min"]:
        out.append(Stage.GRADUATED.value)
    if t.boosts_active > 0 or {"boost_latest", "boost_top"} & set(t.sources):
        out.append(Stage.TRENDING.value)
    return out


class TokenScanner:
    """Descubre tokens (boosts, perfiles, búsquedas), los detalla en lotes, los puntúa y los guarda en JSON."""

    def __init__(self, client: DexScreenerClient, cfg: Dict[str, Any], store: Optional[JsonStore] = None,
                 clock: Callable[[], float] = time.time, db: Optional[SqliteStore] = None):
        self.client, self.cfg, self.clock = client, cfg, clock
        sc = cfg["scanner"]
        data_dir = Path(sc["data_dir"]); data_dir = data_dir if data_dir.is_absolute() else BACKEND_DIR / data_dir
        self.store = store or JsonStore(data_dir, sc["history_interval_s"], sc["history_max_rows"])
        if db is None and store is None:       # con un store inyectado (tests) no se toca la base real
            db_path = Path(sc["db_path"]); db = SqliteStore(db_path if db_path.is_absolute() else BACKEND_DIR / db_path, sc["history_interval_s"])
        self.db = db
        self.tracked: Dict[str, Dict[str, Any]] = self.store.load_tracked()
        self.entries: List[ScoredEntry] = []
        self.last_scan: Optional[float] = None
        self.last_error: Optional[str] = None
        self._lock = threading.Lock()

    # --- descubrimiento ----------------------------------------------------------------------------------
    def _discover(self) -> Dict[str, Set[str]]:
        chain = self.client.chain
        found: Dict[str, Set[str]] = {}
        feeds = (("boost_latest", self.client.boosts_latest), ("boost_top", self.client.boosts_top), ("profile", self.client.profiles_latest))
        for source, fn in feeds:
            try:
                for row in fn():
                    if row.get("chainId") == chain and row.get("tokenAddress"):
                        found.setdefault(row["tokenAddress"], set()).add(source)
            except DexScreenerError as e:
                self.last_error = str(e)
        for q in self.cfg["scanner"]["search_queries"]:
            try:
                for p in self.client.search(q):
                    if p.get("chainId") == chain and p.get("baseToken", {}).get("address"):
                        found.setdefault(p["baseToken"]["address"], set()).add("search")
            except DexScreenerError as e:
                self.last_error = str(e)
        return found

    def _update_tracked(self, found: Dict[str, Set[str]], now: float) -> None:
        sc = self.cfg["scanner"]
        for addr, srcs in found.items():
            cur = self.tracked.setdefault(addr, {"first_seen": now, "sources": []})
            cur["last_seen"] = now
            cur["sources"] = sorted(set(cur["sources"]) | srcs)
        cutoff = now - sc["track_hours"] * 3600
        self.tracked = {a: v for a, v in self.tracked.items() if v["last_seen"] >= cutoff}
        if len(self.tracked) > sc["max_tracked"]:   # conserva los vistos más recientemente
            keep = sorted(self.tracked, key=lambda a: self.tracked[a]["last_seen"], reverse=True)[:sc["max_tracked"]]
            self.tracked = {a: self.tracked[a] for a in keep}

    # --- escaneo -----------------------------------------------------------------------------------------
    def scan(self, force: bool = False) -> List[ScoredEntry]:
        with self._lock:
            now = self.clock()
            if not force and self.last_scan is not None and now - self.last_scan < self.cfg["scanner"]["scan_interval_s"]:
                return self.entries
            self.last_error = None
            self._update_tracked(self._discover(), now)
            addrs = list(self.tracked)
            size = self.cfg["scanner"]["batch_size"]
            pairs: List[Dict[str, Any]] = []
            for i in range(0, len(addrs), size):
                try:
                    pairs += self.client.token_info(addrs[i:i + size])
                except DexScreenerError as e:
                    self.last_error = str(e)
            if not pairs and self.entries:
                return self.entries                 # sin respuesta: se conserva el último estado bueno
            entries: List[ScoredEntry] = []
            for addr, pair in best_pair_per_token(pairs, self.client.chain).items():
                t = normalize_pair(pair, now * 1000, self.cfg["links"])
                meta = self.tracked.get(addr, {})
                t.sources, t.first_seen = meta.get("sources", []), meta.get("first_seen")
                t.stages = classify(t, self.cfg)
                entries.append(score_entry(build_entry(t, self.cfg), self.cfg))
            self.entries, self.last_scan = entries, now
            self._persist(now)
            return self.entries

    def _persist(self, now: float) -> None:
        if self.db:
            self.db.save_entries(now, self.entries, self.tracked)
        self.store.save_tokens(now, self.tracked, {e.entry.token.address: dict(e.entry.token.model_dump(), potential=e.potential.score, risk=e.risk.score, level=e.risk.level) for e in self.entries})
        self.store.append_history(now, [{"address": e.entry.token.address, "symbol": e.entry.token.symbol, "price_usd": e.entry.token.price_usd,
                                         "market_cap": e.entry.token.market_cap, "liquidity_usd": e.entry.token.liquidity_usd,
                                         "volume_h24": e.entry.token.volume.h24, "potential": e.potential.score, "risk": e.risk.score,
                                         "stages": e.entry.token.stages} for e in self.entries])
