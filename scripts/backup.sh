#!/usr/bin/env bash
set -euo pipefail

# Telerithm Backup Script
# Usage: ./scripts/backup.sh [backup_dir]
# Cron:  0 2 * * * /path/to/telerithm/scripts/backup.sh /backups/telerithm

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"

mkdir -p "${BACKUP_PATH}"

echo "[backup] Starting backup at ${TIMESTAMP}"

# PostgreSQL backup
echo "[backup] Dumping PostgreSQL..."
docker compose exec -T postgres pg_dump -U telerithm telerithm \
  | gzip > "${BACKUP_PATH}/postgres.sql.gz"
echo "[backup] PostgreSQL dump complete"

# ClickHouse backup
echo "[backup] Dumping ClickHouse logs table..."
docker compose exec -T clickhouse clickhouse-client \
  --query "SELECT * FROM logs FORMAT JSONEachRow" \
  | gzip > "${BACKUP_PATH}/clickhouse_logs.json.gz"
echo "[backup] ClickHouse dump complete"

# Cleanup old backups (keep last 7 days)
find "${BACKUP_DIR}" -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \;

echo "[backup] Backup complete: ${BACKUP_PATH}"
ls -lh "${BACKUP_PATH}"
