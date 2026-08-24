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
git checkout main
git pull origin main
git merge origin/beta -m "chore: promote beta to stable"
git push origin main

echo "==> Redeploying stable"
bash deploy/update.sh stable

echo ""
echo "Beta promoted. Stable is now running the beta feature set."
echo "To bring beta show data across:"
echo "  cp -r ~/show-creator-beta/shows/<show-name> ~/show-creator/shows/"
