#!/usr/bin/env bash
# Arranca backend (8000) y frontend (3000). Detenerlo: Ctrl+C.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/frontend"
[ -d node_modules ] || npm install --no-audit --no-fund
cd "$ROOT/backend"
python3 -m uvicorn api.main:app --port 8000 &
API=$!
cd "$ROOT/frontend"
npm run dev &
WEB=$!
trap 'kill $API $WEB 2>/dev/null' EXIT INT TERM
echo
echo "  ► Abre:  http://localhost:3000/radar"
echo "  (el puerto 8000 es solo la API: allí '/' da 404, es normal)"
echo
wait
