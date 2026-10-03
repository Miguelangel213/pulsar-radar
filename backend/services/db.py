from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS tokens (
  token_address TEXT PRIMARY KEY, pair_address TEXT, symbol TEXT, name TEXT, dex_id TEXT,
  market_cap REAL, liquidity_usd REAL, volume_24h REAL, fdv REAL, price_usd REAL,
  pair_created_at INTEGER, buys_24h INTEGER, sells_24h INTEGER, socials TEXT, website TEXT,
  boosts_active INTEGER, potential REAL, risk REAL, risk_level TEXT, first_seen REAL, last_seen REAL, updated_at REAL
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, token_address TEXT NOT NULL, pair_address TEXT,
  price_usd REAL, market_cap REAL, liquidity_usd REAL, volume_24h REAL, fdv REAL,
  buys_24h INTEGER, sells_24h INTEGER, potential REAL, risk REAL
);
CREATE INDEX IF NOT EXISTS idx_history_token_ts ON history(token_address, ts);
"""


class SqliteStore:
    """Base de datos local (SQLite, sin servidor ni coste): último estado de cada token + histórico."""

    def __init__(self, path: Path, history_interval_s: float):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.interval = history_interval_s
        self._lock = threading.Lock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self._last: Dict[str, float] = {r["token_address"]: r["m"] for r in self.conn.execute("SELECT token_address, MAX(ts) AS m FROM history GROUP BY token_address")}

    def save_entries(self, ts: float, entries: List[Any], tracked: Dict[str, Dict[str, Any]]) -> int:
        """Actualiza la fila de cada token y añade una fila de histórico (como máximo una por intervalo y token)."""
        added = 0
        with self._lock, self.conn:
            for e in entries:
                t = e.entry.token
                meta = tracked.get(t.address, {})
                self.conn.execute(
                    """INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(token_address) DO UPDATE SET pair_address=excluded.pair_address, symbol=excluded.symbol, name=excluded.name,
                         dex_id=excluded.dex_id, market_cap=excluded.market_cap, liquidity_usd=excluded.liquidity_usd, volume_24h=excluded.volume_24h,
                         fdv=excluded.fdv, price_usd=excluded.price_usd, pair_created_at=excluded.pair_created_at, buys_24h=excluded.buys_24h,
                         sells_24h=excluded.sells_24h, socials=excluded.socials, website=excluded.website, boosts_active=excluded.boosts_active,
                         potential=excluded.potential, risk=excluded.risk, risk_level=excluded.risk_level, last_seen=excluded.last_seen, updated_at=excluded.updated_at""",
                    (t.address, t.pair_address, t.symbol, t.name, t.dex_id, t.market_cap, t.liquidity_usd, t.volume.h24, t.fdv, t.price_usd,
                     t.pair_created_at, int(t.buys.h24), int(t.sells.h24), json.dumps([s.model_dump() for s in t.socials]), t.website,
                     t.boosts_active, e.potential.score, e.risk.score, e.risk.level, meta.get("first_seen", ts), meta.get("last_seen", ts), ts))
                if ts - self._last.get(t.address, 0) >= self.interval:
                    self.conn.execute(
                        "INSERT INTO history (ts, token_address, pair_address, price_usd, market_cap, liquidity_usd, volume_24h, fdv, buys_24h, sells_24h, potential, risk) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                        (ts, t.address, t.pair_address, t.price_usd, t.market_cap, t.liquidity_usd, t.volume.h24, t.fdv, int(t.buys.h24), int(t.sells.h24), e.potential.score, e.risk.score))
                    self._last[t.address] = ts
                    added += 1
        return added

    @staticmethod
    def _token_row(r: sqlite3.Row) -> Dict[str, Any]:
        d = dict(r)
        d["socials"] = json.loads(d["socials"] or "[]")
        return d

    def get_token(self, address: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            r = self.conn.execute("SELECT * FROM tokens WHERE token_address=?", (address,)).fetchone()
        return self._token_row(r) if r else None

    def history(self, address: str, limit: int = 500) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self.conn.execute("SELECT * FROM (SELECT * FROM history WHERE token_address=? ORDER BY ts DESC LIMIT ?) ORDER BY ts", (address, limit)).fetchall()
        return [dict(r) for r in rows]

    def counts(self) -> Dict[str, int]:
        with self._lock:
            return {"tokens": self.conn.execute("SELECT COUNT(*) FROM tokens").fetchone()[0], "history": self.conn.execute("SELECT COUNT(*) FROM history").fetchone()[0]}
