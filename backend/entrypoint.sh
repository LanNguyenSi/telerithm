#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma db push --skip-generate 2>&1

echo "Seeding database..."
node dist/seed.js 2>&1

echo "Starting server..."
exec node dist/server.js
