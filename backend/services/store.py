from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List


def _atomic_write(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


class JsonStore:
    """data/tokens.json  -> último estado de cada token seguido (+ scores).
       data/history.json -> serie de precios/scores por token (base para medir aciertos)."""

    def __init__(self, data_dir: Path, history_interval_s: float, history_max_rows: int):
        self.tokens_path, self.history_path = data_dir / "tokens.json", data_dir / "history.json"
        self.interval, self.max_rows = history_interval_s, history_max_rows
        self.history: List[Dict[str, Any]] = _read(self.history_path, {}).get("entries", [])
        self._last_row: Dict[str, float] = {}
        for row in self.history:
            self._last_row[row["address"]] = row["ts"]

    def load_tracked(self) -> Dict[str, Dict[str, Any]]:
        return _read(self.tokens_path, {}).get("tracked", {})

    def save_tokens(self, ts: float, tracked: Dict[str, Dict[str, Any]], tokens: Dict[str, Dict[str, Any]]) -> None:
        _atomic_write(self.tokens_path, {"updated_at": ts, "tracked": tracked, "tokens": tokens})

    def append_history(self, ts: float, rows: List[Dict[str, Any]]) -> int:
        new = [dict(r, ts=ts) for r in rows if ts - self._last_row.get(r["address"], 0) >= self.interval - 2]
        if not new:
            return 0
        for r in new:
            self._last_row[r["address"]] = ts
        self.history = (self.history + new)[-self.max_rows:]
        _atomic_write(self.history_path, {"entries": self.history})
        return len(new)
