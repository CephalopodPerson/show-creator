#!/usr/bin/env bash
# ── Add the /beta location block to the existing nginx site ───────────────────
#
# Why this script instead of "just edit the file": your nginx config is not in
# the repo (it lives in /etc/nginx) and it has been modified on the server —
# certbot rewrites it when issuing SSL certs. Blindly overwriting it would
# break TLS. So this makes a surgical, idempotent insertion instead:
#
#   1. back up the current config
#   2. bail out if the /beta block is already there
#   3. insert /beta ABOVE the first "location /" in each server block
#   4. nginx -t, and roll back automatically if the test fails
#
# Usage:  sudo bash deploy/install-beta-nginx.sh [site-config-path]

set -euo pipefail

SITE="${1:-/etc/nginx/sites-available/show-creator}"

if [ ! -f "$SITE" ]; then
  echo "✗ Config not found: $SITE"
  echo "  Available sites:"
  ls /etc/nginx/sites-available/ 2>/dev/null | sed 's/^/    /'
  echo "  Re-run with the right path, e.g.:"
  echo "    sudo bash deploy/install-beta-nginx.sh /etc/nginx/sites-available/YOURSITE"
  exit 1
fi

if grep -q "location /beta/" "$SITE"; then
  echo "✓ /beta block already present in $SITE — nothing to do."
  exit 0
fi

BACKUP="${SITE}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$SITE" "$BACKUP"
echo "==> Backed up to $BACKUP"

python3 - "$SITE" <<'PY'
import re, sys

path = sys.argv[1]
src  = open(path).read()

BLOCK = """
    # ── Beta channel ──────────────────────────────────────────────────
    # Trailing slash on proxy_pass strips the /beta prefix, so the beta
    # Express app still serves everything at its own root.
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

"""

# Insert above the first bare "location / {" of every server block that
# actually proxies (skip pure http->https redirect blocks).
pattern = re.compile(r'^([ \t]*)location\s+/\s*\{', re.M)

inserted = 0
out, last = [], 0
for m in pattern.finditer(src):
    # Skip if this server block is just a redirect to https
    block_start = src.rfind('server', 0, m.start())
    block = src[block_start:m.start()]
    if 'return 301 https' in block and 'proxy_pass' not in block:
        continue
    out.append(src[last:m.start()])
    out.append(BLOCK.lstrip('\n'))
    last = m.start()
    inserted += 1
    break   # only the first real one

out.append(src[last:])
result = ''.join(out)

if inserted == 0:
    print("!! Could not find a 'location / {' to insert above.")
    sys.exit(2)

open(path, 'w').write(result)
print(f"==> Inserted /beta block ({inserted} location)")
PY

echo "==> Testing nginx config"
if nginx -t; then
  systemctl reload nginx
  echo ""
  echo "✓ Installed and reloaded."
  echo "  Stable:  https://showcreator.upliftseoul.com/"
  echo "  Beta:    https://showcreator.upliftseoul.com/beta/"
  echo ""
  echo "  Verify:  curl -s https://showcreator.upliftseoul.com/beta/api/channel"
  echo "           should print {\"channel\":\"beta\",...}"
else
  echo ""
  echo "✗ nginx test failed — rolling back"
  cp "$BACKUP" "$SITE"
  echo "  Restored from $BACKUP. Nothing was changed."
  exit 1
fi
