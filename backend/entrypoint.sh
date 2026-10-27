#!/bin/sh
set -e

echo "Applying database migrations..."
if ! sh scripts/migrate.sh; then
  echo "Database migrations did not complete; the server is not started." >&2
  exit 1
fi

echo "Seeding database..."
node dist/seed.js 2>&1

echo "Starting server..."
exec node dist/server.js
