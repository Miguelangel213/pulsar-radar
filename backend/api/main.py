from __future__ import annotations

import time
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from radar.adapters import get_adapter
from radar.config import load_config
from radar.ingest import IngestService
from radar.models import Stage
from radar.service import SORT_KEYS, RadarService


def create_app(service: Optional[RadarService] = None) -> FastAPI:
    cfg = load_config()
    if service is None:
        adapter = get_adapter(cfg)
        service = RadarService(IngestService(adapter, cfg), cfg)
    app = FastAPI(title="Radar de Memecoins", description="Solo lectura. Sin órdenes de compra/venta.")
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                       allow_methods=["GET"], allow_headers=["*"])

    @app.get("/health")
    def health():
        return {"ok": True, "mode": service.ingest.adapter.mode}

    @app.get("/radar")
    def radar(stage: Stage = Stage.NEW,
              risk_level: Optional[str] = Query(None, description="Sólido | Moderado | Alto | Extremo"),
              max_age: Optional[float] = Query(None, ge=0, description="edad máxima en minutos"),
              min_liquidity: Optional[float] = Query(None, ge=0),
              min_mcap: Optional[float] = Query(None, ge=0),
              max_mcap: Optional[float] = Query(None, ge=0),
              sort: str = Query("adjusted", description=" | ".join(SORT_KEYS)),
              order: Optional[str] = Query(None, pattern="^(asc|desc)$"),
              include_rejected: bool = False):
        if risk_level and risk_level.lower() not in {"sólido", "moderado", "alto", "extremo"}:
            raise HTTPException(422, "risk_level inválido")
        try:
            items = service.query(stage, risk_level, max_age, min_liquidity, min_mcap, max_mcap, sort, order, include_rejected)
        except ValueError as e:
            raise HTTPException(422, str(e))
        return {"mode": service.ingest.adapter.mode, "stage": stage.value, "generated_at": time.time(),
                "count": len(items),
                "meta": {"quadrant": service.cfg["scoring"]["ranking"]["quadrant"], "gmgn_token_url": service.cfg["links"]["gmgn_token_url"]},
                "disclaimer": service.cfg["scoring"]["disclaimer"],
                "items": [i.model_dump() for i in items]}

    return app


app = create_app()
