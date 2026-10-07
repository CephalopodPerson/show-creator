#!/usr/bin/env bash
# ── Promote beta to stable ────────────────────────────────────────────────────
# Merges the beta branch into main and redeploys stable. Run this once beta has
# been tested at a real show and you're happy with it.
#
#   bash deploy/promote-beta.sh
#
# NOTE: beta show data is NOT copied to stable. The two channels keep separate
# shows on purpose. After promoting, stable can read the layered step format,
# so if you want the beta shows live, copy them across:
#   cp -r ~/show-creator-beta/shows/<name> ~/show-creator/shows/

set -euo pipefail

STABLE_DIR="$HOME/show-creator"
cd "$STABLE_DIR"

echo "==> Merging beta into main"
git fetch origin

# Same as update.sh: this folder is a deployment target, so npm install and the
# client build leave package-lock.json and client/dist modified, and the merge
# below refuses to run over them. Discard that churn. shows/, data/ and
# archive/ are gitignored, so they are never touched.
git reset --hard
git clean -fd client/dist 2>/dev/null || true
git checkout main
git pull origin main
git merge origin/beta -m "chore: promote beta to stable"
git push origin main

# The redeploy runs a data migration on startup — keep a copy to roll back to.
BACKUP="$HOME/show-creator-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
if [ -d "$STABLE_DIR/shows" ];   then cp -a "$STABLE_DIR/shows"   "$BACKUP/"; fi
if [ -d "$STABLE_DIR/data" ];    then cp -a "$STABLE_DIR/data"    "$BACKUP/"; fi
if [ -d "$STABLE_DIR/archive" ]; then cp -a "$STABLE_DIR/archive" "$BACKUP/"; fi
echo "==> Backed up stable data to $BACKUP"

echo "==> Redeploying stable"
bash deploy/update.sh stable

echo ""
echo "Beta promoted. Stable is now running the beta feature set."
echo "To bring beta show data across:"
echo "  cp -r ~/show-creator-beta/shows/<show-name> ~/show-creator/shows/"
