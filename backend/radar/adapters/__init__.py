from __future__ import annotations

from ..config import read_api_key
from .mock import MockAdapter


def get_adapter(cfg):
    """MOCK salvo que exista GMGN_API_KEY. El adaptador real llega en la etapa 8."""
    if read_api_key(cfg):
        # TODO etapa 8: return RealGMGNAdapter(...). Hasta entonces se mantiene MOCK (solo lectura).
        pass
    return MockAdapter(cfg)
