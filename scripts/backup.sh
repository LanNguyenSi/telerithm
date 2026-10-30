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
# Retention: after a successful backup it keeps the newest 10 backups and removes
# those older than 10 days, but only directories named YYYYMMDD_HHMMSS that hold
# both dumps (the ones this script writes). Anything else in <backup_dir> is left
# alone, with one note saying how many entries. An old backup that cannot be
# removed is a WARNING on stderr and does not stop the run (the loop goes on and
# the off-host hook still runs), but the run then exits 2 after the hook block
# with an ERROR line: housekeeping that silently stops working would fill the
# disk unnoticed. The new backup is complete and kept in that case.
#
# Exit codes: 0 success; 1 any other failure (checks before the dumps, a failed
# dump, a failed off-host hook); 2 only the retention step could not remove old
# backups. When the hook fails as well, 1 wins (the off-host copy is missing,
# which is the worse state); the retention ERROR line is printed before the hook
# runs, so it shows in that case too.
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
#                         directory as its only argument (a relative path is
#                         taken from where this script is started). Unset or empty means
#                         the backup stays local. The dumps hold source API keys
#                         in clear text: encrypt them in the hook before they
#                         leave the host. A hook that fails makes this script
#                         exit 1; the local backup is kept.

# Every `cd` below is prefixed with an empty CDPATH: an exported CDPATH would
# otherwise resolve a relative directory against it (and print it), so the
# paths could differ from the ones the caller named.
SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname "${BASH_SOURCE[0]}")" >/dev/null && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "${SCRIPT_DIR}/.." >/dev/null && pwd)"

COMPOSE_FILE="${BACKUP_COMPOSE_FILE:-${REPO_ROOT}/docker-compose.traefik.yml}"
ENV_FILE="${BACKUP_ENV_FILE:-${REPO_ROOT}/.env.production}"
OFFHOST_HOOK="${BACKUP_OFFHOST_HOOK:-}"

fail() {
  echo "[backup] ERROR: $*" >&2
  exit 1
}

[ -f "${COMPOSE_FILE}" ] || fail "compose file not found: ${COMPOSE_FILE}"
if [ -n "${OFFHOST_HOOK}" ]; then
  if [ ! -f "${OFFHOST_HOOK}" ] || [ ! -x "${OFFHOST_HOOK}" ]; then
    fail "BACKUP_OFFHOST_HOOK is not an executable file: ${OFFHOST_HOOK}"
  fi
  # Made absolute here, before this script changes directory for the retention
  # step, so a relative path resolves against where the script was started.
  OFFHOST_HOOK="$(CDPATH='' cd -- "$(dirname "${OFFHOST_HOOK}")" >/dev/null && pwd)/$(basename "${OFFHOST_HOOK}")"
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
BACKUP_DIR="$(CDPATH='' cd -- "${BACKUP_DIR}" >/dev/null && pwd)"
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"
# No -p: the timestamp has one-second resolution, and a run that reused the
# directory of another run could delete that run's finished backup when it
# cleans up after its own failure.
# The collision message is for a path that exists; any other mkdir failure
# (read-only parent, no space) shows mkdir's own error instead.
if [ -e "${BACKUP_PATH}" ]; then
  fail "backup directory already exists (another run in the same second?): ${BACKUP_PATH}"
fi
mkdir "${BACKUP_PATH}" || fail "could not create the backup directory: ${BACKUP_PATH}"

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

# Retention: keep the newest 10 backups and drop those older than 10 days.
# Only entries this script wrote are candidates: a real directory (not a
# symlink) named YYYYMMDD_HHMMSS that holds both finished dumps. Everything
# else in the backup directory (other applications' directories, files,
# symlinks, a timestamp-named directory without both dumps) is left alone and
# only counted in one note, so pointing the script at a shared directory such
# as /backups instead of /backups/telerithm cannot delete anything unrelated.
# "Newest" is decided by the timestamp in the name; the age rule uses the
# directory's modification time. The backup written by this run is never
# removed.
CDPATH='' cd -- "${BACKUP_DIR}" >/dev/null
# Explicit digit class, not [0-9]: under glibc with a UTF-8 locale a range can
# match other digits (fullwidth ones, for example), so a foreign directory with
# such a name would count as a backup.
TIMESTAMP_RE='^[0123456789]{8}_[0123456789]{6}$'
RETAINABLE=()
LEFT_ALONE=0
RETENTION_FAILED=0
# The three globs cover every name (plain, one dot, two dots) without matching
# . or ..; a glob that matches nothing stays literal and is skipped below.
for entry in "${BACKUP_DIR}"/* "${BACKUP_DIR}"/.[!.]* "${BACKUP_DIR}"/..?*; do
  if [ ! -e "${entry}" ] && [ ! -L "${entry}" ]; then
    continue
  fi
  entry_name="${entry##*/}"
  if [[ "${entry_name}" =~ ${TIMESTAMP_RE} ]] \
    && [ -d "${entry}" ] && [ ! -L "${entry}" ] \
    && [ -f "${entry}/postgres.sql.gz" ] \
    && [ -f "${entry}/clickhouse_logs.native.gz" ]; then
    RETAINABLE+=("${entry_name}")
  else
    LEFT_ALONE=$((LEFT_ALONE + 1))
  fi
done
if [ "${LEFT_ALONE}" -gt 0 ]; then
  NOUN=entries
  if [ "${LEFT_ALONE}" -eq 1 ]; then
    NOUN=entry
  fi
  echo "[backup] Retention left ${LEFT_ALONE} ${NOUN} in ${BACKUP_DIR} alone (not a complete YYYYMMDD_HHMMSS backup directory written by this script)" >&2
fi
if [ "${#RETAINABLE[@]}" -gt 0 ]; then
  RANK=0
  # Newest name first; every name here matched TIMESTAMP_RE, so it holds no
  # newline and no character that could be read as an option or a path.
  while IFS= read -r entry_name; do
    RANK=$((RANK + 1))
    if [ "${entry_name}" = "${TIMESTAMP}" ]; then
      continue
    fi
    entry="${BACKUP_DIR}/${entry_name}"
    if [ "${RANK}" -gt 10 ] || [ -n "$(find "${entry}" -maxdepth 0 -mtime +10 2>/dev/null)" ]; then
      if ! rm -rf -- "${entry}"; then
        echo "[backup] WARNING: could not remove the old backup ${entry}" >&2
        RETENTION_FAILED=$((RETENTION_FAILED + 1))
      fi
    fi
  done < <(printf '%s\n' "${RETAINABLE[@]}" | LC_ALL=C sort -r)
fi
# Reported now, acted on (exit 2) after the off-host hook, so the hook still
# gets the good backup. The EXIT trap keeps it: the dumps are complete.
if [ "${RETENTION_FAILED}" -gt 0 ]; then
  echo "[backup] ERROR: retention could not remove ${RETENTION_FAILED} old backup(s); the backup is complete" >&2
fi

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

if [ "${RETENTION_FAILED}" -gt 0 ]; then
  exit 2
fi
