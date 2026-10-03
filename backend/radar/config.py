from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

import yaml

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "config" / "radar.yaml"


def load_config(path: Path | str | None = None) -> Dict[str, Any]:
    with open(path or DEFAULT_PATH, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def read_api_key(cfg: Dict[str, Any]) -> str | None:
    """Lee GMGN_API_KEY de la variable de entorno o del archivo env configurado."""
    key = os.environ.get("GMGN_API_KEY")
    if key:
        return key
    env_file = Path(os.path.expanduser(cfg["mode"]["env_file"]))
    if not env_file.is_file():
        return None
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("GMGN_API_KEY="):
            return line.split("=", 1)[1].strip().strip("\"'") or None
    return None
