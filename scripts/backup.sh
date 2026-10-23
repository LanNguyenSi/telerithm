#!/usr/bin/env bash
set -euo pipefail

# Telerithm Backup Script
#
# Usage: ./scripts/backup.sh [backup_dir]
# Cron:  0 2 * * * /path/to/telerithm/scripts/backup.sh /backups/telerithm
#
# Backs up the stack DEPLOYMENT.md deploys: docker-compose.traefik.yml in the
# repository root, with .env.production when that file exists. It exits non-zero
# before writing anything when the compose file is missing or the postgres and
# clickhouse services of that stack are not running, so a cron job cannot report
# success for a stack that is not the one in production.
#
# Output (in <backup_dir>/<timestamp>/):
#   postgres.sql.gz            pg_dump, restore with psql (DEPLOYMENT.md, Backup)
#   clickhouse_logs.native.gz  logs table in Native format, restore with
#                              INSERT INTO logs FORMAT Native (gunzip first)
#
# Environment:
#   BACKUP_COMPOSE_FILE   compose file of the stack to back up
#                         (default: <repo root>/docker-compose.traefik.yml)
#   BACKUP_ENV_FILE       env file passed to compose
#                         (default: <repo root>/.env.production, skipped if absent)
#   BACKUP_OFFHOST_HOOK   optional path of an executable that copies the finished
#                         backup off this host. It is called with the backup
#                         directory as its only argument. Unset or empty means
#                         the backup stays local. The dumps hold source API keys
#                         in clear text: encrypt them in the hook before they
#                         leave the host. A hook that fails makes this script
#                         exit non-zero; the local backup is kept.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE="${BACKUP_COMPOSE_FILE:-${REPO_ROOT}/docker-compose.traefik.yml}"
ENV_FILE="${BACKUP_ENV_FILE:-${REPO_ROOT}/.env.production}"
OFFHOST_HOOK="${BACKUP_OFFHOST_HOOK:-}"

fail() {
  echo "[backup] ERROR: $*" >&2
  exit 1
}

[ -f "${COMPOSE_FILE}" ] || fail "compose file not found: ${COMPOSE_FILE}"
if [ -n "${OFFHOST_HOOK}" ] && [ ! -x "${OFFHOST_HOOK}" ]; then
  fail "BACKUP_OFFHOST_HOOK is not an executable file: ${OFFHOST_HOOK}"
fi

COMPOSE=(docker compose -f "${COMPOSE_FILE}")
if [ -f "${ENV_FILE}" ]; then
  COMPOSE+=(--env-file "${ENV_FILE}")
fi

# Both datastores of the stack must be running; a stack that is down, or a
# different stack than the one in COMPOSE_FILE, has no such containers.
RUNNING="$("${COMPOSE[@]}" ps --status running --services)" \
  || fail "docker compose could not list the services of ${COMPOSE_FILE}"
for service in postgres clickhouse; do
  grep -qx "${service}" <<< "${RUNNING}" \
    || fail "service '${service}' is not running in ${COMPOSE_FILE}; start the production stack first"
done

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "${BACKUP_DIR}"
BACKUP_DIR="$(cd "${BACKUP_DIR}" && pwd)"
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"
mkdir -p "${BACKUP_PATH}"

# A run that dies before both dumps are complete removes its own directory, so
# a half-written backup neither looks like a backup nor counts toward the
# retention below.
DUMPS_COMPLETE=0
cleanup_incomplete() {
  if [ "${DUMPS_COMPLETE}" -eq 0 ]; then
    rm -rf "${BACKUP_PATH}"
  fi
}
trap cleanup_incomplete EXIT

echo "[backup] Starting backup at ${TIMESTAMP} (stack: ${COMPOSE_FILE})"

# Each dump is written under a .partial name and renamed once the whole
# pipeline succeeded, so a failed dump never leaves a file that looks complete.

# PostgreSQL backup
echo "[backup] Dumping PostgreSQL..."
"${COMPOSE[@]}" exec -T postgres pg_dump -U telerithm telerithm \
  | gzip > "${BACKUP_PATH}/postgres.sql.gz.partial"
mv "${BACKUP_PATH}/postgres.sql.gz.partial" "${BACKUP_PATH}/postgres.sql.gz"
echo "[backup] PostgreSQL dump complete"

# ClickHouse backup (Native format, the format DEPLOYMENT.md restores from)
echo "[backup] Dumping ClickHouse logs table..."
"${COMPOSE[@]}" exec -T clickhouse clickhouse-client \
  --query "SELECT * FROM logs FORMAT Native" \
  | gzip > "${BACKUP_PATH}/clickhouse_logs.native.gz.partial"
mv "${BACKUP_PATH}/clickhouse_logs.native.gz.partial" "${BACKUP_PATH}/clickhouse_logs.native.gz"
echo "[backup] ClickHouse dump complete"
DUMPS_COMPLETE=1

# Cleanup old backups (keep last 10 by count, max 10 days)
cd "${BACKUP_DIR}"
BACKUP_COUNT=$(ls -d */ 2>/dev/null | wc -l)
if [ "${BACKUP_COUNT}" -gt 10 ]; then
  ls -dt */ | tail -n +11 | xargs rm -rf
fi
# Also remove anything older than 10 days
find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -mtime +10 -exec rm -rf {} \;

echo "[backup] Backup complete: ${BACKUP_PATH}"
ls -lh "${BACKUP_PATH}"

if [ -n "${OFFHOST_HOOK}" ]; then
  echo "[backup] Running off-host hook: ${OFFHOST_HOOK}"
  "${OFFHOST_HOOK}" "${BACKUP_PATH}" \
    || fail "off-host hook failed; the local backup is kept at ${BACKUP_PATH}"
  echo "[backup] Off-host hook complete"
else
  echo "[backup] BACKUP_OFFHOST_HOOK not set: backup stays on this host only"
fi
