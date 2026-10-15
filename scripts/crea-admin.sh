#!/usr/bin/env bash
# Crea un amministratore sul server. Uso: ./scripts/crea-admin.sh <nome>
# Altri comandi: ./scripts/crea-admin.sh --cmd reset-password <nome> | reset-2fa <nome> | lista-admin
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--cmd" ]; then
  shift
  docker compose -f docker-compose.prod.yml exec app node --disable-warning=ExperimentalWarning src/cli.js "$@"
else
  docker compose -f docker-compose.prod.yml exec app node --disable-warning=ExperimentalWarning src/cli.js crea-admin "${1:?Specifica il nome utente}"
fi
