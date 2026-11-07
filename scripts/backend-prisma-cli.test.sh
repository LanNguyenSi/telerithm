#!/usr/bin/env bash
# The backend runtime image runs `npm ci --omit=dev` and then starts
# node_modules/.bin/prisma (backend/scripts/migrate.sh). This check does the same
# production install in a scratch copy of package.json and package-lock.json
# and fails when the Prisma CLI is not there. A static check that prisma is a
# key of dependencies runs first. No docker, no scripts run.
#
# Usage: bash scripts/backend-prisma-cli.test.sh [backend-dir]
set -euo pipefail

backend="${1:-$(cd "$(dirname "$0")/.." && pwd)/backend}"
for f in package.json package-lock.json; do
  [ -f "$backend/$f" ] || { echo "FAIL: $backend/$f not found" >&2; exit 2; }
done

# Static check first: the install below keeps prisma through the optional peer of
# @prisma/client, so it alone does not notice prisma sitting in devDependencies.
if ! node -e '
const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
process.exit(p.dependencies && Object.prototype.hasOwnProperty.call(p.dependencies, "prisma") ? 0 : 1);
' "$backend/package.json"; then
  echo "FAIL: prisma is not a key of dependencies in $backend/package.json." >&2
  echo "      backend/scripts/migrate.sh runs the CLI in the production image, so it" >&2
  echo "      must not depend on the optional peer of @prisma/client." >&2
  exit 1
fi

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
cp "$backend/package.json" "$backend/package-lock.json" "$scratch/"

(cd "$scratch" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)

if [ ! -e "$scratch/node_modules/.bin/prisma" ]; then
  echo "FAIL: node_modules/.bin/prisma is absent after 'npm ci --omit=dev'." >&2
  echo "      prisma must be in dependencies of backend/package.json, because" >&2
  echo "      backend/scripts/migrate.sh runs it in the production image." >&2
  exit 1
fi
echo "ok: node_modules/.bin/prisma present after a production install"
