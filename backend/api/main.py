from __future__ import annotations

import time
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from clients.dexscreener_client import DexScreenerClient, DexScreenerError
from radar.config import load_config
from radar.models import Stage
from services.alerts import AlertService
from services.radar_service import SORT_KEYS, RadarService
from services.token_scanner import TokenScanner, best_pair_per_token, normalize_pair, classify
from scoring.gates import build_entry
from scoring.scoring_engine import score_entry

SOURCE = "DEXSCREENER"
COVERAGE = ("Fuente: DexScreener (sin API key). No existe un feed oficial de todos los tokens nuevos: el radar descubre tokens por sus boosts "
            "y perfiles publicados. No incluye seguridad del contrato, holders, dev ni smart money.")


def create_app(service: Optional[RadarService] = None, client: Optional[DexScreenerClient] = None) -> FastAPI:
    cfg = load_config()
    if service is None:
        client = client or DexScreenerClient(cfg)
        service = RadarService(TokenScanner(client, cfg), cfg)
    client = client or service.scanner.client
    alerts = AlertService(service, service.cfg)
    app = FastAPI(title="Radar de Memecoins", description="Solo lectura. Datos de DexScreener. Sin órdenes de compra/venta.")
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"], allow_methods=["GET"], allow_headers=["*"])

    @app.get("/health")
    def health():
        sc = service.scanner
        return {"ok": True, "source": SOURCE, "tracked": len(sc.tracked), "last_scan": sc.last_scan, "last_error": sc.last_error, "api_calls": client.calls, "db": sc.db.counts() if sc.db else None}

    @app.get("/radar")
    def radar(stage: Stage = Stage.NEW,
              risk_level: Optional[str] = Query(None, description="Sólido | Moderado | Alto | Extremo"),
              max_age: Optional[float] = Query(None, ge=0, description="edad máxima del par en minutos"),
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
        except DexScreenerError as e:
            raise HTTPException(502, str(e))
        return {"mode": SOURCE, "stage": stage.value, "generated_at": time.time(), "count": len(items),
                "meta": {"quadrant": service.cfg["scoring"]["ranking"]["quadrant"], "coverage": COVERAGE,
                         "last_scan": service.scanner.last_scan, "last_error": service.scanner.last_error},
                "disclaimer": service.cfg["scoring"]["disclaimer"], "items": [i.model_dump() for i in items]}

    @app.get("/search")
    def search(q: str = Query(..., min_length=2)):
        """Busca en DexScreener (solo tokens de la cadena configurada) y los puntúa. No se guardan."""
        try:
            pairs = client.search(q)
        except DexScreenerError as e:
            raise HTTPException(502, str(e))
        now_ms = time.time() * 1000
        out = []
        for addr, pair in best_pair_per_token(pairs, client.chain).items():
            t = normalize_pair(pair, now_ms, service.cfg["links"]); t.stages = classify(t, service.cfg)
            out.append(score_entry(build_entry(t, service.cfg), service.cfg).model_dump())
        out.sort(key=lambda x: -x["adjusted"])
        return {"query": q, "count": len(out), "items": out}

    @app.get("/pairs/{address}")
    def pairs(address: str):
        """Todos los pools de un token (token-pairs/v1)."""
        try:
            return {"address": address, "pairs": client.token_pairs(address)}
        except DexScreenerError as e:
            raise HTTPException(502, str(e))

    @app.get("/tokens/{address}")
    def stored_token(address: str):
        """Token guardado en la base de datos local (último estado conocido)."""
        db = service.scanner.db
        row = db.get_token(address) if db else None
        if row is None:
            raise HTTPException(404, "Token no encontrado en la base de datos")
        return row

    @app.get("/tokens/{address}/history")
    def token_history(address: str, limit: int = Query(500, ge=1, le=5000)):
        """Histórico guardado (precio, market cap, liquidez, volumen, scores) de un token."""
        db = service.scanner.db
        if db is None:
            raise HTTPException(404, "Base de datos no disponible")
        return {"address": address, "rows": db.history(address, limit)}

    @app.get("/alerts")
    def get_alerts(after: Optional[int] = Query(None, ge=0, description="devuelve solo eventos con id mayor")):
        return alerts.events(after)

    return app


app = create_app()
