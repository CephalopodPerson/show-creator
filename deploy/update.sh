#!/usr/bin/env bash
# ── Pull and redeploy one channel ─────────────────────────────────────────────
#   bash deploy/update.sh stable    # main  -> ~/show-creator      (port 3000)
#   bash deploy/update.sh beta      # beta  -> ~/show-creator-beta (port 3001)

set -euo pipefail

CH="${1:-}"
case "$CH" in
  stable) DIR="$HOME/show-creator";      BRANCH=main; PROC=show-creator ;;
  beta)   DIR="$HOME/show-creator-beta"; BRANCH=beta; PROC=show-creator-beta ;;
  *) echo "Usage: bash deploy/update.sh [stable|beta]"; exit 1 ;;
esac

echo "==> Updating $CH ($BRANCH) in $DIR"
cd "$DIR"

git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

npm install
npm install --prefix client
npm run build --prefix client

pm2 restart "$PROC" --update-env
pm2 save

echo "==> $CH updated and restarted"
pm2 status "$PROC"
