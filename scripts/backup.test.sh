#!/usr/bin/env bash
# Tests for scripts/backup.sh. Runs the script against a stub `docker` placed
# first on PATH, so no real Docker daemon, compose file or datastore is touched.
#
# Usage: bash scripts/backup.test.sh
#
# Every scenario runs with HOME pointing into a fresh scratch directory; the
# test aborts before running anything else if it cannot establish that.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SH="${SCRIPT_DIR}/backup.sh"

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-backup-test.XXXXXX")"
SCRATCH="$(cd "${SCRATCH}" && pwd -P)"
trap 'rm -rf "${SCRATCH}"' EXIT

export HOME="${SCRATCH}/home"
mkdir -p "${HOME}"
case "${HOME}" in
  "${SCRATCH}"/*) ;;
  *) echo "FATAL: HOME is not inside the scratch directory" >&2; exit 2 ;;
esac
unset CLAUDE_CONFIG_DIR CODEX_HOME BACKUP_COMPOSE_FILE BACKUP_ENV_FILE BACKUP_OFFHOST_HOOK

# --- stub docker -------------------------------------------------------------
# Behaviour is steered by environment variables:
#   STUB_RUNNING   services `ps --status running --services` lists (newline separated)
#   STUB_PS_FAIL   non-empty: `ps` exits 1
#   STUB_PG_FAIL   non-empty: `exec ... postgres` exits 1 after printing nothing
#   STUB_CH_FAIL   non-empty: `exec ... clickhouse` prints some bytes, then exits 1
# Every invocation is appended to $STUB_LOG.
STUB_DIR="${SCRATCH}/stubbin"
mkdir -p "${STUB_DIR}"
cat > "${STUB_DIR}/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "${STUB_LOG}"
args=("$@")
if [ "${args[0]:-}" != "compose" ]; then exit 99; fi
case " $* " in
  *" ps "*)
    [ -z "${STUB_PS_FAIL:-}" ] || exit 1
    printf '%b' "${STUB_RUNNING:-}"
    exit 0 ;;
  *" exec "*postgres*)
    [ -z "${STUB_PG_FAIL:-}" ] || exit 1
    echo "-- fake pg_dump"
    exit 0 ;;
  *" exec "*clickhouse*)
    echo "fake-native-bytes"
    [ -z "${STUB_CH_FAIL:-}" ] || exit 1
    exit 0 ;;
esac
exit 98
STUB
chmod +x "${STUB_DIR}/docker"
export PATH="${STUB_DIR}:${PATH}"
export STUB_LOG="${SCRATCH}/docker.log"

COMPOSE_FILE="${SCRATCH}/stack/docker-compose.traefik.yml"
mkdir -p "${SCRATCH}/stack"
echo "services: {}" > "${COMPOSE_FILE}"
export BACKUP_COMPOSE_FILE="${COMPOSE_FILE}"
export BACKUP_ENV_FILE="${SCRATCH}/stack/.env.production"
echo "POSTGRES_PASSWORD=dummy" > "${BACKUP_ENV_FILE}"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

# run_backup <name> <backup_dir>: runs backup.sh, leaves status in RC, output in OUT
run_backup() {
  : > "${STUB_LOG}"
  OUT="$(bash "${BACKUP_SH}" "$2" 2>&1)"
  RC=$?
}

count_dirs() { find "$1" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' '; }

# --- 1. success path ---------------------------------------------------------
export STUB_RUNNING=$'postgres\nclickhouse\nredis\n'
D1="${SCRATCH}/b1"
run_backup success "${D1}"
if [ "${RC}" -eq 0 ]; then ok "success: exit 0"; else bad "success: exit ${RC}: ${OUT}"; fi
BK="$(find "${D1}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [ -s "${BK}/postgres.sql.gz" ] && gzip -dc "${BK}/postgres.sql.gz" | grep -q "fake pg_dump"; then
  ok "success: postgres dump written and gzipped"
else bad "success: postgres dump missing"; fi
if [ -s "${BK}/clickhouse_logs.native.gz" ] && gzip -dc "${BK}/clickhouse_logs.native.gz" | grep -q "fake-native-bytes"; then
  ok "success: clickhouse dump written as .native.gz"
else bad "success: clickhouse native dump missing"; fi
if ! find "${BK}" -name '*.partial' | grep -q .; then ok "success: no .partial files left"; else bad "success: .partial left behind"; fi
if grep -q "exec -T clickhouse clickhouse-client --query SELECT \* FROM logs FORMAT Native" "${STUB_LOG}"; then
  ok "success: clickhouse dump uses FORMAT Native"
else bad "success: clickhouse dump format not Native: $(cat "${STUB_LOG}")"; fi
# every compose call targets the configured file and env file
if ! grep -v "^docker compose -f ${COMPOSE_FILE} --env-file ${BACKUP_ENV_FILE} " "${STUB_LOG}" | grep -q .; then
  ok "success: every compose call uses the configured -f and --env-file"
else bad "success: a compose call missed -f/--env-file: $(cat "${STUB_LOG}")"; fi

# --- 2. env file is optional ---------------------------------------------------
D2="${SCRATCH}/b2"
BACKUP_ENV_FILE="${SCRATCH}/stack/absent.env" run_backup noenv "${D2}"
if [ "${RC}" -eq 0 ] && ! grep -q -- "--env-file" "${STUB_LOG}"; then
  ok "env file absent: runs without --env-file"
else bad "env file absent: rc=${RC} log=$(cat "${STUB_LOG}")"; fi

# --- 3. wrong / missing stack ------------------------------------------------
D3="${SCRATCH}/b3"
BACKUP_COMPOSE_FILE="${SCRATCH}/stack/nope.yml" run_backup missingfile "${D3}"
if [ "${RC}" -ne 0 ] && grep -q "compose file not found" <<< "${OUT}" && [ ! -d "${D3}" ]; then
  ok "missing compose file: non-zero, message, nothing created"
else bad "missing compose file: rc=${RC} out=${OUT}"; fi

STUB_RUNNING=$'redis\n' run_backup stopped "${D3}"
if [ "${RC}" -ne 0 ] && grep -q "service 'postgres' is not running" <<< "${OUT}" && [ ! -d "${D3}" ]; then
  ok "postgres not running: non-zero, message, nothing created"
else bad "postgres not running: rc=${RC} out=${OUT}"; fi

STUB_RUNNING=$'postgres\n' run_backup halfstack "${D3}"
if [ "${RC}" -ne 0 ] && grep -q "service 'clickhouse' is not running" <<< "${OUT}" && [ ! -d "${D3}" ]; then
  ok "clickhouse not running: non-zero, message, nothing created"
else bad "clickhouse not running: rc=${RC} out=${OUT}"; fi

# a service whose name only contains 'postgres' must not count
STUB_RUNNING=$'postgres-exporter\nclickhouse\n' run_backup lookalike "${D3}"
if [ "${RC}" -ne 0 ]; then ok "service name match is exact"; else bad "lookalike service accepted"; fi

STUB_RUNNING="" run_backup nothing "${D3}"
if [ "${RC}" -ne 0 ]; then ok "empty stack: non-zero"; else bad "empty stack accepted"; fi

STUB_PS_FAIL=1 run_backup psfail "${D3}"
if [ "${RC}" -ne 0 ] && grep -q "could not list the services" <<< "${OUT}"; then
  ok "compose ps failure: non-zero, message"
else bad "compose ps failure: rc=${RC} out=${OUT}"; fi

# --- 4. failed dump leaves no backup directory ---------------------------------
D4="${SCRATCH}/b4"
STUB_PG_FAIL=1 run_backup pgfail "${D4}"
if [ "${RC}" -ne 0 ] && [ "$(count_dirs "${D4}")" = "0" ]; then
  ok "failed pg_dump: non-zero and the half-written directory is removed"
else bad "failed pg_dump: rc=${RC} dirs=$(count_dirs "${D4}")"; fi

# a ClickHouse failure after a finished PostgreSQL dump leaves nothing behind:
# no timestamp directory (so no postgres-only "backup") and no .partial file
D4B="${SCRATCH}/b4b"
STUB_CH_FAIL=1 run_backup chfail "${D4B}"
if [ "${RC}" -ne 0 ] \
  && [ "$(count_dirs "${D4B}")" = "0" ] \
  && ! find "${D4B}" -name '*.partial' | grep -q .; then
  ok "failed clickhouse dump: non-zero, no directory and no .partial file remain"
else bad "failed clickhouse dump: rc=${RC} dirs=$(count_dirs "${D4B}") files=$(find "${D4B}" -type f 2>/dev/null)"; fi

# --- 4b. two runs in the same second: the second must not delete the first
DATE_STUB="${SCRATCH}/datestub"
mkdir -p "${DATE_STUB}"
cat > "${DATE_STUB}/date" <<'DATESTUB'
#!/usr/bin/env bash
echo 20990101_000000
DATESTUB
chmod +x "${DATE_STUB}/date"
D4C="${SCRATCH}/b4c"
PATH="${DATE_STUB}:${PATH}" run_backup firstrun "${D4C}"
if [ "${RC}" -eq 0 ] && [ -s "${D4C}/20990101_000000/postgres.sql.gz" ]; then
  ok "same-second: first run succeeds"
else bad "same-second: first run rc=${RC} out=${OUT}"; fi
PATH="${DATE_STUB}:${PATH}" STUB_PG_FAIL=1 run_backup secondrun "${D4C}"
if [ "${RC}" -ne 0 ] \
  && grep -q "already exists" <<< "${OUT}" \
  && [ -s "${D4C}/20990101_000000/postgres.sql.gz" ] \
  && [ -s "${D4C}/20990101_000000/clickhouse_logs.native.gz" ]; then
  ok "same-second: second run is refused and the first backup is untouched"
else bad "same-second: second run rc=${RC} out=${OUT} files=$(find "${D4C}" -type f)"; fi
PATH="${DATE_STUB}:${PATH}" run_backup thirdrun "${D4C}"
if [ "${RC}" -ne 0 ] && [ -s "${D4C}/20990101_000000/postgres.sql.gz" ]; then
  ok "same-second: a second run that would succeed is refused too, first backup kept"
else bad "same-second: third run rc=${RC} out=${OUT}"; fi

# --- 5. off-host hook ----------------------------------------------------------
HOOK="${SCRATCH}/hook.sh"
HOOK_LOG="${SCRATCH}/hook.log"
cat > "${HOOK}" <<'HOOKEOF'
#!/usr/bin/env bash
echo "hook called with: $*" >> "${HOOK_LOG}"
ls "$1" >> "${HOOK_LOG}"
[ -z "${HOOK_FAIL:-}" ]
HOOKEOF
chmod +x "${HOOK}"
export HOOK_LOG

# 5a. unset: local only, hook never runs
D5="${SCRATCH}/b5"
: > "${HOOK_LOG}"
run_backup nohook "${D5}"
if [ "${RC}" -eq 0 ] && [ ! -s "${HOOK_LOG}" ] && grep -q "stays on this host only" <<< "${OUT}"; then
  ok "hook unset: local only, says so"
else bad "hook unset: rc=${RC} hooklog=$(cat "${HOOK_LOG}") out=${OUT}"; fi

# 5b. empty string counts as unset
: > "${HOOK_LOG}"
BACKUP_OFFHOST_HOOK="" run_backup emptyhook "${SCRATCH}/b5b"
if [ "${RC}" -eq 0 ] && [ ! -s "${HOOK_LOG}" ]; then ok "hook empty: treated as unset"; else bad "hook empty: rc=${RC}"; fi

# 5c. set: called once with the finished backup directory containing both dumps
D6="${SCRATCH}/b6"
: > "${HOOK_LOG}"
BACKUP_OFFHOST_HOOK="${HOOK}" run_backup withhook "${D6}"
BK6="$(find "${D6}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [ "${RC}" -eq 0 ] \
  && [ "$(grep -c '^hook called with:' "${HOOK_LOG}")" = "1" ] \
  && grep -qxF "hook called with: ${BK6}" "${HOOK_LOG}" \
  && grep -q "postgres.sql.gz" "${HOOK_LOG}" && grep -q "clickhouse_logs.native.gz" "${HOOK_LOG}"; then
  ok "hook set: called once with the backup directory holding both dumps"
else bad "hook set: rc=${RC} hooklog=$(cat "${HOOK_LOG}")"; fi

# 5d. set but failing: non-zero exit, local backup kept
D7="${SCRATCH}/b7"
HOOK_FAIL=1 BACKUP_OFFHOST_HOOK="${HOOK}" run_backup failinghook "${D7}"
if [ "${RC}" -ne 0 ] && [ "$(count_dirs "${D7}")" = "1" ] && grep -q "off-host hook failed" <<< "${OUT}"; then
  ok "hook fails: non-zero, local backup kept"
else bad "hook fails: rc=${RC} dirs=$(count_dirs "${D7}") out=${OUT}"; fi

# 5e. set but not executable: refused before any dump
D8="${SCRATCH}/b8"
BACKUP_OFFHOST_HOOK="${SCRATCH}/no-such-hook" run_backup badhook "${D8}"
if [ "${RC}" -ne 0 ] && [ ! -d "${D8}" ] && grep -q "not an executable file" <<< "${OUT}"; then
  ok "hook not executable: refused before any dump"
else bad "hook not executable: rc=${RC} out=${OUT}"; fi

# 5e2. a relative hook path is resolved before the script changes into the
# backup directory: started from the directory holding the hook, with a backup
# directory elsewhere, the hook still runs and gets an absolute argument
D8B="${SCRATCH}/b8b"
: > "${HOOK_LOG}"
( cd "${SCRATCH}" && BACKUP_OFFHOST_HOOK="./hook.sh" bash "${BACKUP_SH}" "${D8B}" > "${SCRATCH}/relhook.out" 2>&1 ); RC=$?
BK8B="$(find "${D8B}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [ "${RC}" -eq 0 ] && grep -qxF "hook called with: ${BK8B}" "${HOOK_LOG}"; then
  ok "hook relative path (./hook.sh): runs, called with the absolute backup directory"
else bad "hook relative path: rc=${RC} hooklog=$(cat "${HOOK_LOG}") out=$(cat "${SCRATCH}/relhook.out")"; fi

# a bare file name (no slash) in the start directory resolves the same way
D8C="${SCRATCH}/b8c"
: > "${HOOK_LOG}"
( cd "${SCRATCH}" && BACKUP_OFFHOST_HOOK="hook.sh" bash "${BACKUP_SH}" "${D8C}" > "${SCRATCH}/relhook2.out" 2>&1 ); RC=$?
if [ "${RC}" -eq 0 ] && [ "$(grep -c '^hook called with:' "${HOOK_LOG}")" = "1" ]; then
  ok "hook bare file name: runs from the start directory"
else bad "hook bare file name: rc=${RC} out=$(cat "${SCRATCH}/relhook2.out")"; fi

# a directory is not a hook
D8D="${SCRATCH}/b8d"
BACKUP_OFFHOST_HOOK="${SCRATCH}/stubbin" run_backup dirhook "${D8D}"
if [ "${RC}" -ne 0 ] && [ ! -d "${D8D}" ] && grep -q "not an executable file" <<< "${OUT}"; then
  ok "hook is a directory: refused before any dump"
else bad "hook is a directory: rc=${RC} out=${OUT}"; fi

# --- 5f. defaults: without BACKUP_COMPOSE_FILE / BACKUP_ENV_FILE the script uses
# docker-compose.traefik.yml and .env.production of the repository it lives in
REPO2="${SCRATCH}/repo2"
mkdir -p "${REPO2}/scripts"
cp "${BACKUP_SH}" "${REPO2}/scripts/backup.sh"
echo "services: {}" > "${REPO2}/docker-compose.traefik.yml"
echo "services: {}" > "${REPO2}/docker-compose.yml"
echo "POSTGRES_PASSWORD=dummy" > "${REPO2}/.env.production"
: > "${STUB_LOG}"
OUT="$(env -u BACKUP_COMPOSE_FILE -u BACKUP_ENV_FILE bash "${REPO2}/scripts/backup.sh" "${SCRATCH}/b10" 2>&1)"
RC=$?
if [ "${RC}" -eq 0 ] \
  && ! grep -v "^docker compose -f ${REPO2}/docker-compose.traefik.yml --env-file ${REPO2}/.env.production " "${STUB_LOG}" | grep -q .; then
  ok "defaults: targets docker-compose.traefik.yml and .env.production next to scripts/"
else bad "defaults: rc=${RC} calls=$(cat "${STUB_LOG}") out=${OUT}"; fi

# --- 6. relative backup dir and retention --------------------------------------
D9="${SCRATCH}/b9"
mkdir -p "${D9}"
for i in 01 02 03 04 05 06 07 08 09 10 11 12; do mkdir -p "${D9}/old_${i}"; touch -t "202001${i}0000" "${D9}/old_${i}"; done
( cd "${SCRATCH}" && : > "${STUB_LOG}" && bash "${BACKUP_SH}" "b9" > "${SCRATCH}/rel.out" 2>&1 ); RC=$?
if [ "${RC}" -eq 0 ] && [ "$(count_dirs "${D9}")" = "1" ]; then
  ok "relative backup dir: exit 0, old backups pruned, new one kept"
else bad "relative backup dir: rc=${RC} dirs=$(count_dirs "${D9}") out=$(cat "${SCRATCH}/rel.out")"; fi

echo
echo "passed: ${PASS}, failed: ${FAIL}"
[ "${FAIL}" -eq 0 ]
