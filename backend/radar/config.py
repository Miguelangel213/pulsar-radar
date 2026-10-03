from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import yaml

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_PATH = BACKEND_DIR / "config" / "radar.yaml"


def load_config(path: Path | str | None = None) -> Dict[str, Any]:
    with open(path or DEFAULT_PATH, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)
