#!/usr/bin/env bash
# Prima installazione su un server Ubuntu 24.04 (es. EC2 su AWS). Da lanciare UNA volta, come utente "ubuntu".
#   curl -fsSL https://raw.githubusercontent.com/Magnetico-Associazione-Culturale/voto-magnetico/main/scripts/installa-server.sh | bash
set -euo pipefail

echo "== Aggiornamento del sistema e aggiornamenti di sicurezza automatici"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git fail2ban unattended-upgrades ca-certificates curl

echo "== Installazione di Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "== Download del codice"
if [ ! -d "$HOME/voto-magnetico" ]; then
  git clone https://github.com/Magnetico-Associazione-Culturale/voto-magnetico.git "$HOME/voto-magnetico"
fi

cd "$HOME/voto-magnetico"
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
fi

cat <<'EOF'

Fatto. Prossimi passi:
  1. Esci e rientra via SSH (per usare Docker senza sudo).
  2. cd ~/voto-magnetico && nano .env      (dominio e server email)
  3. ./scripts/deploy.sh                      (avvia la piattaforma)
  4. ./scripts/crea-admin.sh <nome>           (crea un amministratore)
EOF
