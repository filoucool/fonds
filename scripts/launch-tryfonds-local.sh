#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT/../fonds-demo/data}"
LANDING_DIR="$ROOT/sites/tryfonds"

if [[ ! -d "$DATA_DIR/app" ]]; then
  echo "Missing demo data at $DATA_DIR — seed fonds-demo first."
  exit 1
fi

fuser -k 8080/tcp 8081/tcp 2>/dev/null || true
sleep 1

(cd "$LANDING_DIR" && python3 -m http.server 8080 --bind 127.0.0.1) &
LANDING_PID=$!

cd "$ROOT"
DATA_DIR="$DATA_DIR" HOST=127.0.0.1 PORT=8081 node apps/api/dist/main.js &
DEMO_PID=$!

echo "Landing:  http://127.0.0.1:8080"
echo "Demo app: http://127.0.0.1:8081"
echo "PIDs: landing=$LANDING_PID demo=$DEMO_PID"
wait