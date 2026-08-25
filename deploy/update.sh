#!/usr/bin/env bash
# ── Pull and redeploy one channel ─────────────────────────────────────────────
#   bash deploy/update.sh stable    # main  -> ~/show-creator      (port 3000)
#   bash deploy/update.sh beta      # beta  -> ~/show-creator-beta (port 3001)

set -euo pipefail

CH="${1:-}"
case "$CH" in
  stable) DIR="$HOME/show-creator";      BRANCH=main; PROC=show-creator;      BASE=/      ;;
  beta)   DIR="$HOME/show-creator-beta"; BRANCH=beta; PROC=show-creator-beta; BASE=/beta/ ;;
  *) echo "Usage: bash deploy/update.sh [stable|beta]"; exit 1 ;;
esac

echo "==> Updating $CH ($BRANCH) in $DIR  [base $BASE]"
cd "$DIR"

# These directories are deployment targets, not working copies — nothing in
# them is hand-authored. npm install rewrites package-lock.json on every run,
# which then blocks the next pull with "commit your changes before merge".
# Resetting to the remote makes the update idempotent instead.
#
# Safe because shows/, archive/ and data/ are all gitignored, so songs, audio,
# the archive and settings are never touched by this.
git fetch origin

# Order matters. `git checkout` refuses to run on a dirty tree, so it must not
# come first — it would abort with "commit your changes" before the reset ever
# had a chance to clean up, which is exactly the failure this was meant to fix.
# Discard local churn, THEN switch, then pin to the remote.
git reset --hard
git checkout -f -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd client/dist 2>/dev/null || true

npm install
npm install --prefix client
# The base path must match where nginx serves this channel, or the browser will
# request assets from the wrong instance.
BASE_PATH="$BASE" npm run build --prefix client

pm2 restart "$PROC" --update-env
pm2 save

echo "==> $CH updated and restarted"
pm2 status "$PROC"
