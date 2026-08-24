#!/usr/bin/env bash
# ── One-time setup: run Show Creator on two channels side by side ─────────────
#
#   stable  → branch main   port 3000   http://<VPS_IP>/
#   beta    → branch beta   port 3001   http://<VPS_IP>:8080/
#
# Each channel is a separate working copy with its own shows directory, so
# editing in beta can never touch live show data. That separation matters:
# beta stores steps in a layered format the stable exporter can't read.
#
# Usage:  bash deploy/setup-channels.sh <VPS_IP_OR_HOST>

set -euo pipefail

HOST="${1:-}"
if [ -z "$HOST" ]; then
  echo "Usage: bash deploy/setup-channels.sh <VPS_IP_OR_HOST>"
  exit 1
fi

STABLE_DIR="$HOME/show-creator"
BETA_DIR="$HOME/show-creator-beta"
REPO_URL="$(git -C "$STABLE_DIR" remote get-url origin)"

echo "==> Stable lives at $STABLE_DIR"
echo "==> Beta will live at $BETA_DIR"

# ── Clone the beta working copy if it doesn't exist ──
if [ ! -d "$BETA_DIR" ]; then
  echo "==> Cloning beta working copy"
  git clone "$REPO_URL" "$BETA_DIR"
fi

cd "$BETA_DIR"
git fetch origin
git checkout beta
git pull origin beta

echo "==> Installing beta dependencies"
npm install
npm install --prefix client
npm run build --prefix client

# ── Seed beta's show data from stable (first run only) ──
if [ ! -d "$BETA_DIR/shows" ] && [ -d "$STABLE_DIR/shows" ]; then
  echo "==> Seeding beta shows from stable"
  cp -r "$STABLE_DIR/shows" "$BETA_DIR/shows"
fi

# ── PM2 processes ──
echo "==> Starting PM2 processes"

pm2 delete show-creator-beta 2>/dev/null || true
CHANNEL=beta \
NODE_ENV=production \
PORT=3001 \
SHOWS_DIR="$BETA_DIR/shows" \
ARCHIVE_DIR="$BETA_DIR/archive" \
OTHER_CHANNEL_URL="http://$HOST/" \
  pm2 start "$BETA_DIR/server/index.js" --name show-creator-beta

# Restart stable so it learns the beta URL for the "Try beta" link
pm2 delete show-creator 2>/dev/null || true
CHANNEL=stable \
NODE_ENV=production \
PORT=3000 \
OTHER_CHANNEL_URL="http://$HOST:8080/" \
  pm2 start "$STABLE_DIR/server/index.js" --name show-creator

pm2 save

# ── nginx: serve beta on 8080 ──
echo "==> Configuring nginx for beta on :8080"
sudo tee /etc/nginx/sites-available/show-creator-beta > /dev/null <<'NGINX'
server {
    listen 8080;
    server_name _;

    client_max_body_size 200M;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/show-creator-beta /etc/nginx/sites-enabled/show-creator-beta
sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "───────────────────────────────────────────────"
echo " Stable:  http://$HOST/"
echo " Beta:    http://$HOST:8080/"
echo "───────────────────────────────────────────────"
echo "Update stable:  bash deploy/update.sh stable"
echo "Update beta:    bash deploy/update.sh beta"
