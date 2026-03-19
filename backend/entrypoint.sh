#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma db push --skip-generate 2>&1 || echo "Warning: prisma db push failed, tables may already exist"

echo "Seeding database..."
node dist/seed.js 2>&1 || echo "Warning: seed failed or already seeded"

echo "Starting server..."
exec node dist/server.js
