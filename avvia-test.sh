#!/usr/bin/env bash
# Avvia la piattaforma in modalità PROVA sul Mac, raggiungibile dai telefoni sulla stessa rete Wi-Fi.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker non trovato. Installa Docker Desktop per Mac da https://www.docker.com/products/docker-desktop/ e riprova."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop non è avviato: aprilo dalle Applicazioni, attendi che sia pronto e riprova."
  exit 1
fi

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$IP" ]; then
  echo "Non trovo l'indirizzo IP del Mac sulla rete Wi-Fi: il QR code funzionerà solo da questo computer."
  IP="localhost"
fi
export PUBLIC_URL="http://${IP}:3000"

if [ "${1:-}" = "--reset" ]; then
  echo "Cancello i dati di prova…"
  docker compose down -v
fi

cat <<EOF

  ────────────────────────────────────────────────────────────
   Piattaforma di voto — MODALITÀ PROVA
   Pannello:        ${PUBLIC_URL}/admin
   Accesso:         admin / prova1234
   Email (finte):   http://localhost:8025
   Telefono:        stessa rete Wi-Fi del Mac, inquadra il QR
   Per fermare:     Ctrl+C
   Per ripartire da zero:  ./avvia-test.sh --reset
  ────────────────────────────────────────────────────────────

EOF

docker compose up --build
