#!/usr/bin/env bash
# ── Roll stable back to an earlier release ────────────────────────────────────
#   bash deploy/rollback.sh <tag-or-commit>                 # code only
#   bash deploy/rollback.sh <tag-or-commit> <backup-dir>    # code + data
#
# Example, undoing the show-codes promotion:
#   bash deploy/rollback.sh stable-pre-show-codes
#   bash deploy/rollback.sh stable-pre-show-codes ~/show-creator-backups/20261007-153000
#
# Code only is usually enough: older versions ignore fields they don't know
# (like a show's editCode). Restore data too when you need the old admin PIN
# back — setting an admin password removes the saved PIN from settings.json —
# or if a newer version damaged show files.
#
# Before restoring data, the current shows/, data/ and archive/ are copied to
# ~/show-creator-backups/before-rollback-<time>, so a rollback can be undone.
#
# Stable is left on a detached checkout of <ref>. Running deploy/update.sh
# stable afterwards redeploys origin/main — i.e. undoes the rollback.

set -euo pipefail

REF="${1:-}"
BACKUP="${2:-}"
if [ -z "$REF" ]; then
  echo "Usage: bash deploy/rollback.sh <tag-or-commit> [backup-dir]"
  exit 1
fi

DIR="$HOME/show-creator"
PROC=show-creator
BASE=/

cd "$DIR"
git fetch origin --tags

if ! git rev-parse --verify --quiet "$REF^{commit}" >/dev/null; then
  echo "Unknown tag or commit: $REF"
  exit 1
fi
if [ -n "$BACKUP" ] && [ ! -d "$BACKUP" ]; then
  echo "Backup directory not found: $BACKUP"
  exit 1
fi

echo "==> Rolling stable back to $REF"
pm2 stop "$PROC"

if [ -n "$BACKUP" ]; then
  SAFETY="$HOME/show-creator-backups/before-rollback-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$SAFETY"
  for d in shows data archive; do
    if [ -d "$DIR/$d" ]; then cp -a "$DIR/$d" "$SAFETY/"; fi
  done
  echo "==> Current data saved to $SAFETY"

  for d in shows data archive; do
    if [ -d "$BACKUP/$d" ]; then
      rm -rf "${DIR:?}/$d"
      cp -a "$BACKUP/$d" "$DIR/$d"
      echo "==> Restored $d/ from $BACKUP"
    fi
  done
fi

# Same clean-tree dance as update.sh: these dirs are deployment targets.
git reset --hard
git checkout -f --detach "$REF"
git clean -fd client/dist 2>/dev/null || true

npm install
npm install --prefix client
BASE_PATH="$BASE" npm run build --prefix client

pm2 restart "$PROC" --update-env
pm2 save

echo ""
echo "==> Stable is now running $REF"
echo "    To return to the latest release: bash deploy/update.sh stable"
pm2 status "$PROC"
