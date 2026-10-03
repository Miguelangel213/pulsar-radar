# Radar de Memecoins (Solana)

Solo lectura. Datos reales de **DexScreener** (API pública, sin API key). No compra, vende ni opera.

## Arrancar
```bash
./start.sh                                     # todo en uno -> abre http://localhost:3000/radar
# o por separado:
# terminal 1: backend (puerto 8000)
cd backend && python3 -m uvicorn api.main:app --port 8000
# terminal 2: frontend (puerto 3000)
cd frontend && npm install && npm run dev      # abre http://localhost:3000/radar
cd backend && python3 -m pytest -q             # tests
```

## Estructura del backend
- `clients/dexscreener_client.py`: cliente HTTP con caché TTL, limitador de tasa por grupo y reintentos con backoff.
- `services/token_scanner.py`: descubre tokens (boosts, perfiles, búsquedas), los detalla en lotes de 30, los puntúa y guarda.
- `services/db.py`: SQLite local `data/radar.db` (tabla `tokens` con el último estado y tabla `history` con la serie de precios y scores).
- `services/store.py`: copias legibles `data/tokens.json` y `data/history.json`.
- `scoring/scoring_engine.py` y `scoring/gates.py`: score de potencial, riesgo de mercado y hard gates.
- `services/radar_service.py`, `services/alerts.py`, `api/main.py`: consulta con filtros, alertas y endpoints.
- `config/radar.yaml`: **todos** los umbrales, pesos y límites de tasa.

## Endpoints DexScreener usados
`/token-boosts/latest/v1`, `/token-boosts/top/v1`, `/token-profiles/latest/v1`, `/tokens/v1/solana/{direcciones}`,
`/token-pairs/v1/solana/{direccion}`, `/latest/dex/search?q=`.

## Endpoints propios
`/radar`, `/search?q=`, `/pairs/{address}`, `/tokens/{address}` (guardado en SQLite), `/tokens/{address}/history`, `/alerts`, `/health`.

## Enlaces rápidos por token
Se generan solos desde `links:` en `backend/config/radar.yaml` (DexScreener por `pairAddress`; Solscan y Birdeye por la dirección del contrato).

## Límites que conviene conocer
- DexScreener no tiene un feed de "todos los pares nuevos": el radar solo ve tokens con boost o perfil publicado (y las búsquedas que configures en `scanner.search_queries`).
- No entrega seguridad del contrato, holders, dev ni smart money. El "riesgo" es solo de mercado.
- Los pares en bonding curve de pump.fun llegan sin `liquidity.usd`.
- El potencial es una probabilidad por señales: no predice precio ni recomienda comprar.
