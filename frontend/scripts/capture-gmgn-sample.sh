#!/usr/bin/env bash
# Guarda una muestra REAL (solo datos públicos de mercado) de dos respuestas de GMGN para usarla en los tests.
# La key se lee del archivo .env que le indiques y NUNCA se imprime ni se guarda en la muestra.
#
# Uso:  bash frontend/scripts/capture-gmgn-sample.sh [ruta/al/.env]      (por defecto: ~/.config/gmgn/.env)
set -euo pipefail

ENV_FILE="${1:-$HOME/.config/gmgn/.env}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/tests/fixtures/gmgn"
[ -f "$ENV_FILE" ] || { echo "No existe el archivo de la key: $ENV_FILE"; exit 1; }
set -a; source "$ENV_FILE"; set +a
[ -n "${GMGN_API_KEY:-}" ] || { echo "El archivo no define GMGN_API_KEY"; exit 1; }
mkdir -p "$OUT"
BASE="https://openapi.gmgn.ai"

call() {  # call <nombre> <método> <ruta+query> [cuerpo]
  local name="$1" method="$2" path="$3" body="${4:-}"
  local url="$BASE$path&timestamp=$(date +%s)&client_id=$(uuidgen)"
  local code
  if [ -n "$body" ]; then
    code=$(curl -s -m 40 -o "$OUT/$name.json" -w "%{http_code}" -X "$method" -H "X-APIKEY: $GMGN_API_KEY" -H "Content-Type: application/json" -d "$body" "$url")
  else
    code=$(curl -s -m 40 -o "$OUT/$name.json" -w "%{http_code}" -X "$method" -H "X-APIKEY: $GMGN_API_KEY" "$url")
  fi
  echo "$name -> HTTP $code, $(wc -c < "$OUT/$name.json" | tr -d ' ') bytes"
  if [ "$code" != "200" ]; then echo "   respuesta de GMGN: $(head -c 300 "$OUT/$name.json")"; fi
}

SECTION='{"filters":["offchain","onchain"],"launchpad_platform_v2":true,"limit":30,"quote_address_type":[4,5,3,1,13,0]}'
call rank GET "/v1/market/rank?chain=sol&interval=1h&limit=30&order_by=volume&direction=desc"
sleep 2
call trenches POST "/v1/trenches?chain=sol" "{\"version\":\"v2\",\"new_creation\":$SECTION,\"near_completion\":$SECTION,\"completed\":$SECTION}"

unset GMGN_API_KEY
if grep -q -F "gmgn_" "$OUT"/*.json 2>/dev/null; then echo "AVISO: aparece algo con formato de key en la muestra; revísala antes de subirla a git."; else echo "Muestra sin rastro de la key. Guardada en: $OUT"; fi
