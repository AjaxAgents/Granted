#!/usr/bin/env bash
# Builds granted-azure.zip: everything the Azure Function App needs to run Granted
# (the API, the web app it serves at "/", the database migrations and the migrate tool).
#
#   bash setup/package-azure.sh            # writes ./granted-azure.zip
#
# Used by the Release workflow (.github/workflows/release.yml), the Deploy workflow, and by
# setup/azure-setup.sh when no ready-made release can be downloaded. Needs Node.js 22.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/granted-azure.zip}"
cd "$ROOT"

echo "Building Granted for Azure..."
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build -w apps/api
VITE_API_BASE=/api npm run build -w apps/web

PKG="$(mktemp -d)"
trap 'rm -rf "$PKG"' EXIT
cp -r apps/api/dist apps/api/host.json "$PKG/"
mkdir -p "$PKG/www" "$PKG/migrations" "$PKG/tools"
cp -r apps/web/dist/. "$PKG/www/"
rm -f "$PKG/www/staticwebapp.config.json"
cp db/migrations/*.sql "$PKG/migrations/"
cp apps/api/tools/migrate.mjs "$PKG/tools/"
node -e "const p=require('./apps/api/package.json');delete p.devDependencies;p.scripts={};require('fs').writeFileSync(process.argv[1],JSON.stringify(p,null,2))" "$PKG/package.json"
(cd "$PKG" && npm install --omit=dev --no-package-lock --no-audit --no-fund --loglevel=error)

rm -f "$OUT"
(cd "$PKG" && zip -qr -X "$OUT" .)
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
