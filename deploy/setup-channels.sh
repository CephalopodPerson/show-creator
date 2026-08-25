#!/usr/bin/env bash
# ── One-time setup: run Show Creator on two channels behind one domain ────────
#
#   stable  → branch main   port 3000   https://showcreator.upliftseoul.com/
#   beta    → branch beta   port 3001   https://showcreator.upliftseoul.com/beta/
#
# Each channel is a separate working copy with its own shows directory, so
# editing in beta can never touch live show data. That separation matters:
# beta stores steps in a layered format the stable exporter cannot read.
#
# The beta client is built with BASE_PATH=/beta/ so its asset and API URLs are
# prefixed. nginx strips the /beta prefix before proxying, so the beta Express
# app still serves everything at its own root.
#
# Usage:  bash deploy/setup-channels.sh [domain]

set -euo pipefail

DOMAIN="${1:-showcreator.upliftseoul.com}"
STABLE_DIR="$HOME/show-creator"
BETA_DIR="$HOME/show-creator-beta"
REPO_URL="$(git -C "$STABLE_DIR" remote get-url origin)"

echo "==> Domain:  $DOMAIN"
echo "==> Stable:  $STABLE_DIR  (port 3000, /)"
echo "==> Beta:    $BETA_DIR  (port 3001, /beta/)"

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
BASE_PATH=/beta/ npm run build --prefix client

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
OTHER_CHANNEL_URL="https://$DOMAIN/" \
  pm2 start "$BETA_DIR/server/index.js" --name show-creator-beta

# Restart stable so it learns the beta URL for the "Try beta" link
pm2 delete show-creator 2>/dev/null || true
CHANNEL=stable \
NODE_ENV=production \
PORT=3000 \
OTHER_CHANNEL_URL="https://$DOMAIN/beta/" \
  pm2 start "$STABLE_DIR/server/index.js" --name show-creator

pm2 save

echo ""
echo "───────────────────────────────────────────────────────────"
echo " PM2 is running both channels."
echo ""
echo " Now add this /beta block to your existing nginx server"
echo " block for $DOMAIN, ABOVE the existing 'location /':"
echo "───────────────────────────────────────────────────────────"
cat <<'NGINX'

    # Beta channel — trailing slash on proxy_pass strips the /beta prefix
    location /beta/ {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        'upgrade';
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 200M;
    }

    # Redirect /beta -> /beta/ so relative asset URLs resolve
    location = /beta {
        return 301 /beta/;
    }

NGINX
echo "───────────────────────────────────────────────────────────"
echo " Edit:   sudo nano /etc/nginx/sites-available/show-creator"
echo " Test:   sudo nginx -t"
echo " Apply:  sudo systemctl reload nginx"
echo ""
echo " Then:   https://$DOMAIN/       (stable)"
echo "         https://$DOMAIN/beta/  (beta)"
echo "───────────────────────────────────────────────────────────"
