#!/usr/bin/env bash
# Copia il database dal server in ./backup/ (da lanciare a voto chiuso).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backup
FILE="backup/voto-$(date +%Y%m%d-%H%M%S).sqlite"
docker compose -f docker-compose.prod.yml cp app:/data/voto.sqlite "$FILE"
chmod 600 "$FILE"
echo "Backup salvato in $FILE"
echo "Per scaricarlo sul Mac:  scp ubuntu@<indirizzo-del-server>:voto-magnetico/$FILE ."
