#!/usr/bin/env bash
# Aggiorna e avvia la piattaforma sul server.
#   ./scripts/deploy.sh                 ultima versione del ramo main
#   ./scripts/deploy.sh v1.0-assemblea  una versione precisa (etichetta Git), es. dopo il congelamento
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Manca il file .env: copia .env.example in .env e compilalo."; exit 1; }

git fetch --tags origin
if [ -n "${1:-}" ]; then
  git checkout --quiet "$1"
else
  git checkout --quiet main
  git pull --quiet --ff-only
fi

export APP_VERSION="$(git describe --tags --always)"
echo "== Avvio della versione ${APP_VERSION} ($(git rev-parse HEAD))"
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f >/dev/null
sleep 3
docker compose -f docker-compose.prod.yml ps
echo "Versione in esecuzione: ${APP_VERSION}"
