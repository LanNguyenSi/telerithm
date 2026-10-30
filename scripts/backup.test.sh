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

# A failed mktemp stops the test before anything runs: with an empty SCRATCH,
# `cd ""` stays in the current directory (bash 3.2 and 5.2), so the cleanup
# would delete the directory the test was started from. The path is resolved
# (macOS /tmp and TMPDIR are symlinks) only once it is known to be a directory.
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-backup-test.XXXXXX")" \
  || { echo "FATAL: mktemp failed" >&2; exit 2; }
if [ -z "${SCRATCH}" ] || [ ! -d "${SCRATCH}" ]; then
  echo "FATAL: mktemp did not create a directory: '${SCRATCH}'" >&2
  exit 2
fi
SCRATCH="$(CDPATH='' cd -- "${SCRATCH}" && pwd -P)" \
  || { echo "FATAL: cannot resolve the scratch directory" >&2; exit 2; }
# remove_scratch <dir>: deletes <dir> only when it is a directory made from this
# script's mktemp template (an absolute path whose last component is
# telerithm-backup-test.<suffix>); any other value is left alone. Permissions
# come back first: the retention-failure cases leave directories that cannot
# be removed while they are read-only.
remove_scratch() {
  case "$1" in /*) ;; *) return 0 ;; esac
  case "${1##*/}" in telerithm-backup-test.?*) ;; *) return 0 ;; esac
  chmod -R u+rwx "$1" 2>/dev/null
  rm -rf "$1"
}
trap 'remove_scratch "${SCRATCH}"' EXIT

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
#   STUB_PG_FAIL   non-empty: `exec ... postgres` prints nothing and exits with
#                  this value as its status (the cases below use 1, 2 and 137)
#   STUB_CH_FAIL   non-empty: `exec ... clickhouse` prints some bytes, then exits
#                  with this value as its status
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
    [ -z "${STUB_PG_FAIL:-}" ] || exit "${STUB_PG_FAIL}"
    echo "-- fake pg_dump"
    exit 0 ;;
  *" exec "*clickhouse*)
    echo "fake-native-bytes"
    [ -z "${STUB_CH_FAIL:-}" ] || exit "${STUB_CH_FAIL}"
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

# mk_backup <backup_dir> <name> [touch -t stamp]: a complete backup directory
# (both dumps), its modification time set last when a stamp is given
mk_backup() {
  mkdir -p "$1/$2"
  : > "$1/$2/postgres.sql.gz"
  : > "$1/$2/clickhouse_logs.native.gz"
  if [ -n "${3:-}" ]; then touch -t "$3" "$1/$2"; fi
}

# days_ago <n>: touch -t stamp n days back (BSD date first, then GNU date)
days_ago() { date -v-"$1"d +%Y%m%d%H%M 2>/dev/null || date -d "$1 days ago" +%Y%m%d%H%M; }

# valid_count <dir>: real directories named YYYYMMDD_HHMMSS holding both dumps
valid_count() {
  local n=0 e
  for e in "$1"/*; do
    if [[ "${e##*/}" =~ ^[0-9]{8}_[0-9]{6}$ ]] && [ -d "${e}" ] && [ ! -L "${e}" ] \
      && [ -f "${e}/postgres.sql.gz" ] && [ -f "${e}/clickhouse_logs.native.gz" ]; then
      n=$((n + 1))
    fi
  done
  echo "${n}"
}

# gone <path>...: true when none of the paths exists, not even as a symlink
gone() { local p; for p in "$@"; do if [ -e "${p}" ] || [ -L "${p}" ]; then return 1; fi; done; }
present() { local p; for p in "$@"; do if [ ! -e "${p}" ] && [ ! -L "${p}" ]; then return 1; fi; done; }

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

# --- 4a. every failure other than retention exits 1, whatever its own status ---
# Exit 2 means only that retention failed, so a dump that exits 2, or 137 as
# after a kill, must still make the script exit 1; the step is named and no
# backup directory is left.
for dump_case in "PG 2 PostgreSQL" "PG 137 PostgreSQL" "CH 2 ClickHouse" "CH 137 ClickHouse"; do
  read -r which code label <<< "${dump_case}"
  DX="${SCRATCH}/b4x-${which}-${code}"
  if [ "${which}" = PG ]; then
    STUB_PG_FAIL="${code}" run_backup "pg${code}" "${DX}"
  else
    STUB_CH_FAIL="${code}" run_backup "ch${code}" "${DX}"
  fi
  if [ "${RC}" -eq 1 ] \
    && grep -qF "[backup] ERROR: ${label} dump failed; the incomplete backup directory is removed" <<< "${OUT}" \
    && [ "$(count_dirs "${DX}")" = "0" ] \
    && ! find "${DX}" -name '*.partial' | grep -q .; then
    ok "${label} dump exits ${code}: the script exits 1, names the dump, leaves no directory"
  else bad "${label} dump exits ${code}: rc=${RC} dirs=$(count_dirs "${DX}") out=${OUT}"; fi
done

# a failed rename of a finished dump: a stub mv exits 2 for that one target
MV_STUB="${SCRATCH}/mvstub"
mkdir -p "${MV_STUB}"
cat > "${MV_STUB}/mv" <<'MVSTUB'
#!/usr/bin/env bash
case "${2:-}" in
  */"${STUB_MV_FAIL_ON}") exit 2 ;;
esac
exec "${STUB_REAL_MV}" "$@"
MVSTUB
chmod +x "${MV_STUB}/mv"
REAL_MV="$(command -v mv)"
for mv_case in "postgres.sql.gz PostgreSQL" "clickhouse_logs.native.gz ClickHouse"; do
  read -r target label <<< "${mv_case}"
  DX="${SCRATCH}/b4y-${label}"
  PATH="${MV_STUB}:${PATH}" STUB_REAL_MV="${REAL_MV}" STUB_MV_FAIL_ON="${target}" run_backup "mv-${label}" "${DX}"
  if [ "${RC}" -eq 1 ] \
    && grep -qF "[backup] ERROR: could not rename the ${label} dump; the incomplete backup directory is removed" <<< "${OUT}" \
    && [ "$(count_dirs "${DX}")" = "0" ]; then
    ok "${label} dump rename exits 2: the script exits 1, names the rename, leaves no directory"
  else bad "${label} dump rename exits 2: rc=${RC} dirs=$(count_dirs "${DX}") out=${OUT}"; fi
done

# any other command that stops the script exits 1 as well: here `ls -lh` of the
# finished backup exits 2 (GNU ls does for a path it cannot access); the
# backup is complete and kept
LS_STUB="${SCRATCH}/lsstub"
mkdir -p "${LS_STUB}"
printf '#!/usr/bin/env bash\nexit 2\n' > "${LS_STUB}/ls"
chmod +x "${LS_STUB}/ls"
DZ="${SCRATCH}/b4z"
PATH="${LS_STUB}:${PATH}" run_backup lsfail "${DZ}"
if [ "${RC}" -eq 1 ] && grep -qF "[backup] ERROR: command failed with exit 2" <<< "${OUT}" \
  && [ "$(valid_count "${DZ}")" = "1" ]; then
  ok "another command exits 2 after the dumps: the script exits 1, the complete backup is kept"
else bad "another command exits 2: rc=${RC} valid=$(valid_count "${DZ}") out=${OUT}"; fi

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

# --- 4c. a dangling symlink at the backup path is not a collision message ------
# `[ -e ]` is false for a dangling symlink, so the "already exists" branch is
# skipped and mkdir (which does not follow the link) fails; the link must stay
# and the message must be the generic one.
D4D="${SCRATCH}/b4d"
mkdir -p "${D4D}"
ln -s "${SCRATCH}/dangling-target" "${D4D}/20990101_000000"
PATH="${DATE_STUB}:${PATH}" run_backup dangling "${D4D}"
if [ "${RC}" -ne 0 ] \
  && grep -q "could not create the backup directory" <<< "${OUT}" \
  && ! grep -q "already exists" <<< "${OUT}" \
  && [ -L "${D4D}/20990101_000000" ] \
  && [ "$(readlink "${D4D}/20990101_000000")" = "${SCRATCH}/dangling-target" ] \
  && [ ! -e "${SCRATCH}/dangling-target" ]; then
  ok "dangling symlink at the backup path: generic mkdir message, link untouched, non-zero"
else bad "dangling symlink at the backup path: rc=${RC} out=${OUT}"; fi

# --- 4d. a run that creates the backup path between the check and the mkdir ----
# The stub mkdir creates the target (with a marker file) just before the real
# mkdir of the script, which then fails. The EXIT trap is installed after that
# mkdir, so the other run's directory and marker must survive.
MKDIR_STUB="${SCRATCH}/mkdirstub"
mkdir -p "${MKDIR_STUB}"
cat > "${MKDIR_STUB}/mkdir" <<'MKDIRSTUB'
#!/usr/bin/env bash
if [ "$#" -eq 1 ] && [ "$1" = "${STUB_RACE_TARGET:-}" ]; then
  "${STUB_REAL_MKDIR}" "$1" && echo marker > "$1/marker"
fi
exec "${STUB_REAL_MKDIR}" "$@"
MKDIRSTUB
chmod +x "${MKDIR_STUB}/mkdir"
REAL_MKDIR="$(command -v mkdir)"
D4E="${SCRATCH}/b4e"
PATH="${MKDIR_STUB}:${DATE_STUB}:${PATH}" STUB_REAL_MKDIR="${REAL_MKDIR}" STUB_RACE_TARGET="${D4E}/20990101_000000" \
  run_backup race "${D4E}"
if [ "${RC}" -ne 0 ] \
  && grep -q "could not create the backup directory" <<< "${OUT}" \
  && ! grep -q "already exists" <<< "${OUT}" \
  && [ -d "${D4E}/20990101_000000" ] \
  && [ -f "${D4E}/20990101_000000/marker" ]; then
  ok "mkdir race: generic message, the other run's directory and marker survive, non-zero"
else bad "mkdir race: rc=${RC} out=${OUT} files=$(find "${D4E}" 2>/dev/null)"; fi

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
for i in 01 02 03 04 05 06 07 08 09 10 11 12; do mk_backup "${D9}" "202001${i}_000000" "202001${i}0000"; done
( cd "${SCRATCH}" && : > "${STUB_LOG}" && bash "${BACKUP_SH}" "b9" > "${SCRATCH}/rel.out" 2>&1 ); RC=$?
if [ "${RC}" -eq 0 ] && [ "$(count_dirs "${D9}")" = "1" ]; then
  ok "relative backup dir: exit 0, old backups pruned, new one kept"
else bad "relative backup dir: rc=${RC} dirs=$(count_dirs "${D9}") out=$(cat "${SCRATCH}/rel.out")"; fi
if ! grep -q "Retention left" "${SCRATCH}/rel.out"; then
  ok "retention: a directory holding only backups prints no note"
else bad "retention: note printed for a clean backup dir: $(cat "${SCRATCH}/rel.out")"; fi

# --- 6b. retention touches only complete YYYYMMDD_HHMMSS directories ------------
# A shared directory (/backups instead of /backups/telerithm): everything that
# is not a complete backup of this script survives, however old, next to 12
# valid old backups that are pruned. The foreign timestamp-like entries have
# names below every valid one, so a filter that lets them through would rank
# them last and remove them by the count rule as well as by the age rule.
D14="${SCRATCH}/b14"
OUTSIDE="${SCRATCH}/outside-target"
mkdir -p "${D14}" "${OUTSIDE}"
: > "${OUTSIDE}/postgres.sql.gz"
: > "${OUTSIDE}/clickhouse_logs.native.gz"
echo precious > "${OUTSIDE}/sentinel.txt"
for i in 01 02 03 04 05 06 07 08 09 10 11 12; do mk_backup "${D14}" "202001${i}_000000" "202001${i}0000"; done
FOREIGN_DIRS=("other-app" "manual_snapshot" "20200101_000000_keep" "20200101_000000.bak" "-rf" "a b" ".hidden" "..dots" $'line\nbreak'
  "20190201_000000" "20190202_000000" "20190203_000000")
for name in "${FOREIGN_DIRS[@]}"; do
  mkdir -p "${D14}/${name}"
  echo data > "${D14}/${name}/data.txt"
done
# complete dumps behind a name that is not a timestamp, or behind a longer one
for name in manual_snapshot 20200101_000000_keep 20200101_000000.bak; do
  : > "${D14}/${name}/postgres.sql.gz"
  : > "${D14}/${name}/clickhouse_logs.native.gz"
done
# timestamp-named but incomplete: empty (20190201), only one dump (the other two)
: > "${D14}/20190202_000000/postgres.sql.gz"
: > "${D14}/20190203_000000/clickhouse_logs.native.gz"
ln -s "${OUTSIDE}" "${D14}/20190204_000000"                      # symlink to a directory holding both dumps
ln -s "${SCRATCH}/no-such-dir" "${D14}/20190205_000000"           # dangling symlink
echo notes > "${D14}/notes.txt"
echo file > "${D14}/20190206_000000"                              # regular file named like a timestamp
for name in "${FOREIGN_DIRS[@]}"; do touch -t 201901010000 "${D14}/${name}"; done
FOREIGN_ALL=("${FOREIGN_DIRS[@]}" "20190204_000000" "20190205_000000" "notes.txt" "20190206_000000")
run_backup foreign "${D14}"
ALL_PRESENT=1
for name in "${FOREIGN_ALL[@]}"; do present "${D14}/${name}" || ALL_PRESENT=0; done
if [ "${RC}" -eq 0 ] && [ "${ALL_PRESENT}" -eq 1 ] \
  && [ "$(valid_count "${D14}")" = "1" ]; then
  ok "retention: foreign entries survive, the 12 old valid backups are pruned, exit 0"
else bad "retention foreign: rc=${RC} present=${ALL_PRESENT} valid=$(valid_count "${D14}") out=${OUT}"; fi
if [ -L "${D14}/20190204_000000" ] && [ -f "${OUTSIDE}/sentinel.txt" ] \
  && [ -f "${OUTSIDE}/postgres.sql.gz" ] && [ -f "${OUTSIDE}/clickhouse_logs.native.gz" ] \
  && [ "$(cat "${D14}/other-app/data.txt")" = "data" ]; then
  ok "retention: a timestamp-named symlink survives and its target is untouched"
else bad "retention symlink: link=$(ls -l "${D14}/20190204_000000" 2>&1) outside=$(find "${OUTSIDE}")"; fi
if gone "${D14}/20200101_000000" "${D14}/20200112_000000"; then
  ok "retention: the pruned backups are gone"
else bad "retention: old valid backups remain: $(find "${D14}" -maxdepth 1 -name '2020*')"; fi
if grep -qF "Retention left ${#FOREIGN_ALL[@]} entries in ${D14} alone" <<< "${OUT}"; then
  ok "retention: one note names how many entries were left alone"
else bad "retention note: expected ${#FOREIGN_ALL[@]} entries, out=${OUT}"; fi
if [ "$(grep -c 'Retention left' <<< "${OUT}")" = "1" ]; then ok "retention: the note is a single line"; else bad "retention note count: ${OUT}"; fi

# a second run (a second later, the timestamp has one-second resolution) changes
# nothing more: the foreign entries are stable
sleep 1
run_backup foreign2 "${D14}"
ALL_PRESENT=1
for name in "${FOREIGN_ALL[@]}"; do present "${D14}/${name}" || ALL_PRESENT=0; done
if [ "${RC}" -eq 0 ] && [ "${ALL_PRESENT}" -eq 1 ] && grep -q "Retention left ${#FOREIGN_ALL[@]} entries" <<< "${OUT}"; then
  ok "retention: a repeated run keeps the foreign entries and repeats the note"
else bad "retention repeat: rc=${RC} present=${ALL_PRESENT} out=${OUT}"; fi

# only foreign entries and no valid backup besides the new one
D14B="${SCRATCH}/b14b"
mkdir -p "${D14B}/other-app"
touch -t 201901010000 "${D14B}/other-app"
run_backup onlyforeign "${D14B}"
if [ "${RC}" -eq 0 ] && [ -d "${D14B}/other-app" ] && [ "$(valid_count "${D14B}")" = "1" ] \
  && grep -qF "Retention left 1 entry in ${D14B} alone" <<< "${OUT}"; then
  ok "retention: only a foreign directory present: kept, note says 1 entry"
else bad "retention only foreign: rc=${RC} out=${OUT}"; fi

# --- 6c. the count rule ranks by the timestamp in the name, not by mtime --------
# 13 valid backups within the last 10 days; the 4 oldest by name carry the
# newest mtime. With the new backup that is 14: the 4 oldest names go, the 9
# newest stay with the new one. An mtime ordering would keep the wrong 4.
D15="${SCRATCH}/b15"
mkdir -p "${D15}"
NEWEST_MTIME="$(days_ago 1)"
OLDER_MTIME="$(days_ago 5)"
for i in 01 02 03 04; do mk_backup "${D15}" "200101${i}_000000" "${NEWEST_MTIME}"; done
for i in 05 06 07 08 09 10 11 12 13; do mk_backup "${D15}" "200101${i}_000000" "${OLDER_MTIME}"; done
run_backup count "${D15}"
KEPT=1
for i in 05 06 07 08 09 10 11 12 13; do present "${D15}/200101${i}_000000" || KEPT=0; done
if [ "${RC}" -eq 0 ] && [ "${KEPT}" -eq 1 ] && [ "$(valid_count "${D15}")" = "10" ] \
  && gone "${D15}/20010101_000000" "${D15}/20010102_000000" "${D15}/20010103_000000" "${D15}/20010104_000000"; then
  ok "count rule: newest 10 by name kept (new one included), the 4 oldest by name removed"
else bad "count rule: rc=${RC} kept=${KEPT} valid=$(valid_count "${D15}") out=${OUT}"; fi
if ! grep -q "Retention left" <<< "${OUT}"; then ok "count rule: no note when everything is a backup"; else bad "count rule: unexpected note: ${OUT}"; fi

# exactly 10 with the new one: nothing is removed
D16="${SCRATCH}/b16"
mkdir -p "${D16}"
for i in 01 02 03 04 05 06 07 08 09; do mk_backup "${D16}" "200101${i}_000000" "${OLDER_MTIME}"; done
run_backup tenkept "${D16}"
if [ "${RC}" -eq 0 ] && [ "$(valid_count "${D16}")" = "10" ]; then
  ok "count rule: 9 recent backups plus the new one are all kept"
else bad "count rule boundary: rc=${RC} valid=$(valid_count "${D16}") out=${OUT}"; fi

# --- 6d. the age rule ------------------------------------------------------------
# Fewer than 10 backups: only the one older than 10 days (by mtime) is removed.
D17="${SCRATCH}/b17"
mkdir -p "${D17}"
mk_backup "${D17}" 20010101_000000 202001010000
mk_backup "${D17}" 20010102_000000 "${OLDER_MTIME}"
mk_backup "${D17}" 20010103_000000
run_backup age "${D17}"
if [ "${RC}" -eq 0 ] && gone "${D17}/20010101_000000" && present "${D17}/20010102_000000" "${D17}/20010103_000000" \
  && [ "$(valid_count "${D17}")" = "3" ]; then
  ok "age rule: the backup older than 10 days is removed, recent ones stay"
else bad "age rule: rc=${RC} valid=$(valid_count "${D17}") out=${OUT}"; fi

# The age boundary: `-mtime +10` means at least 11 whole days. Stamps are taken
# from the epoch in hours (not calendar days), so a DST change cannot move them.
# hours_ago <n>: touch -t stamp n hours back (BSD date first, then GNU date)
hours_ago() {
  local t=$(( $(date +%s) - $1 * 3600 ))
  date -r "${t}" +%Y%m%d%H%M 2>/dev/null || date -d "@${t}" +%Y%m%d%H%M
}
D17B="${SCRATCH}/b17b"
mkdir -p "${D17B}"
mk_backup "${D17B}" 20010101_000000 "$(hours_ago 276)"
mk_backup "${D17B}" 20010102_000000 "$(hours_ago 252)"
run_backup ageboundary "${D17B}"
if [ "${RC}" -eq 0 ] && gone "${D17B}/20010101_000000" && present "${D17B}/20010102_000000"; then
  ok "age rule boundary: 11.5 days old is removed, 10.5 days old stays"
else bad "age rule boundary: rc=${RC} valid=$(valid_count "${D17B}") out=${OUT}"; fi

# --- 6e. the backup written by this run is never removed ------------------------
# A clock that is far behind the existing names makes the new backup the oldest
# by name (rank 13 of 13): the count rule would remove it.
DATE_STUB_OLD="${SCRATCH}/datestub-old"
mkdir -p "${DATE_STUB_OLD}"
cat > "${DATE_STUB_OLD}/date" <<'DATESTUB'
#!/usr/bin/env bash
echo 20000101_000000
DATESTUB
chmod +x "${DATE_STUB_OLD}/date"
D18="${SCRATCH}/b18"
mkdir -p "${D18}"
for i in 01 02 03 04 05 06 07 08 09 10 11 12; do mk_backup "${D18}" "202001${i}_000000"; done
PATH="${DATE_STUB_OLD}:${PATH}" run_backup oldclock "${D18}"
if [ "${RC}" -eq 0 ] \
  && [ -s "${D18}/20000101_000000/postgres.sql.gz" ] && [ -s "${D18}/20000101_000000/clickhouse_logs.native.gz" ] \
  && gone "${D18}/20200101_000000" "${D18}/20200102_000000" \
  && present "${D18}/20200103_000000" "${D18}/20200112_000000" \
  && [ "$(valid_count "${D18}")" = "11" ]; then
  ok "new backup is never pruned, even when the clock ranks it oldest; the two oldest others go"
else bad "old clock: rc=${RC} valid=$(valid_count "${D18}") out=${OUT}"; fi

# --- 6f. a failed removal of an old backup ---------------------------------------
# A complete old backup that rm cannot remove: a read-only subdirectory with a
# file in it (unlinking the file needs write permission on the subdirectory).
# Expected: a WARNING per entry, the loop goes on, the off-host hook still gets
# the good backup, then exit 2 with an ERROR line. Skipped as root, for whom
# permissions do not stop rm.
# mk_stuck <backup_dir> <name> [touch -t stamp]: complete backup that rm -rf cannot remove
mk_stuck() {
  mk_backup "$1" "$2"
  mkdir "$1/$2/locked"
  echo x > "$1/$2/locked/file"
  chmod 555 "$1/$2/locked"
  if [ -n "${3:-}" ]; then touch -t "$3" "$1/$2"; fi
}
# hook_ran_on <dir>: the hook ran once, on a backup directory inside <dir> that holds both dumps
hook_ran_on() {
  local line path
  [ "$(grep -c '^hook called with:' "${HOOK_LOG}")" = "1" ] || return 1
  line="$(grep '^hook called with:' "${HOOK_LOG}")"
  path="${line#hook called with: }"
  [ "$(dirname "${path}")" = "$1" ] && [ -s "${path}/postgres.sql.gz" ] && [ -s "${path}/clickhouse_logs.native.gz" ]
}
PROBE="${SCRATCH}/probe-locked"
mkdir -p "${PROBE}/locked"
chmod 555 "${PROBE}/locked"
if [ "$(id -u)" = "0" ] || [ -w "${PROBE}/locked" ]; then
  echo "skip - retention removal failure cases (running as root or the directory stays writable)"
else
  OLD_STAMP=202001010000
  # age path: 20010102 (stuck) is processed before 20010101 (removable), so the
  # loop must go on after the failure; both are older than 10 days, fewer than 10 backups
  mk_age_fixture() { # <dir> <stuck 0|1>
    mkdir -p "$1"
    mk_backup "$1" 20010101_000000 "${OLD_STAMP}"
    if [ "$2" = "1" ]; then mk_stuck "$1" 20010102_000000 "${OLD_STAMP}"; else mk_backup "$1" 20010102_000000 "${OLD_STAMP}"; fi
  }

  # prune ok / hook ok: exit 0
  DF1="${SCRATCH}/b19a"; mk_age_fixture "${DF1}" 0; : > "${HOOK_LOG}"
  BACKUP_OFFHOST_HOOK="${HOOK}" run_backup pruneok_hookok "${DF1}"
  if [ "${RC}" -eq 0 ] && gone "${DF1}/20010101_000000" "${DF1}/20010102_000000" && hook_ran_on "${DF1}" \
    && ! grep -q "ERROR" <<< "${OUT}" && ! grep -q "WARNING" <<< "${OUT}"; then
    ok "retention removal: prune ok / hook ok: exit 0, no warning, hook ran"
  else bad "prune ok / hook ok: rc=${RC} out=${OUT}"; fi

  # prune fail / hook ok: exit 2, warning for the entry, the removable one still gone, hook ran
  DF2="${SCRATCH}/b19b"; mk_age_fixture "${DF2}" 1; : > "${HOOK_LOG}"
  BACKUP_OFFHOST_HOOK="${HOOK}" run_backup prunefail_hookok "${DF2}"
  if [ "${RC}" -eq 2 ] \
    && grep -qF "WARNING: could not remove the old backup ${DF2}/20010102_000000" <<< "${OUT}" \
    && grep -qF "ERROR: retention could not remove 1 old backup(s); the backup is complete" <<< "${OUT}" \
    && [ "$(grep -c 'WARNING' <<< "${OUT}")" = "1" ] \
    && gone "${DF2}/20010101_000000" && present "${DF2}/20010102_000000" \
    && hook_ran_on "${DF2}" && grep -q "Off-host hook complete" <<< "${OUT}"; then
    ok "retention removal (age): prune fail / hook ok: warning, loop goes on, hook runs, exit 2, new backup kept"
  else bad "prune fail / hook ok: rc=${RC} out=${OUT} hooklog=$(cat "${HOOK_LOG}")"; fi

  # prune ok / hook fail: exit 1 (the hook failure), no retention error
  DF3="${SCRATCH}/b19c"; mk_age_fixture "${DF3}" 0; : > "${HOOK_LOG}"
  HOOK_FAIL=1 BACKUP_OFFHOST_HOOK="${HOOK}" run_backup pruneok_hookfail "${DF3}"
  if [ "${RC}" -eq 1 ] && grep -q "off-host hook failed" <<< "${OUT}" && ! grep -q "retention could not remove" <<< "${OUT}" \
    && hook_ran_on "${DF3}"; then
    ok "retention removal: prune ok / hook fail: exit 1, hook failure reported, backup kept"
  else bad "prune ok / hook fail: rc=${RC} out=${OUT}"; fi

  # prune fail / hook fail: exit 1 wins, both reported, backup kept
  DF4="${SCRATCH}/b19d"; mk_age_fixture "${DF4}" 1; : > "${HOOK_LOG}"
  HOOK_FAIL=1 BACKUP_OFFHOST_HOOK="${HOOK}" run_backup prunefail_hookfail "${DF4}"
  # the hook got the new backup, and after the run it is still the one complete
  # backup with real dumps (the fixtures' dumps are empty files)
  if [ "${RC}" -eq 1 ] && grep -q "off-host hook failed" <<< "${OUT}" \
    && grep -qF "ERROR: retention could not remove 1 old backup(s)" <<< "${OUT}" \
    && hook_ran_on "${DF4}" \
    && [ "$(find "${DF4}" -mindepth 2 -maxdepth 2 -name postgres.sql.gz -size +0 | wc -l | tr -d ' ')" = "1" ] \
    && [ "$(find "${DF4}" -mindepth 2 -maxdepth 2 -name clickhouse_logs.native.gz -size +0 | wc -l | tr -d ' ')" = "1" ]; then
    ok "retention removal: prune fail / hook fail: exit 1 wins, both errors printed, backup kept"
  else bad "prune fail / hook fail: rc=${RC} out=${OUT} files=$(find "${DF4}" -type f)"; fi

  # prune fail, no hook configured: exit 2, says the backup stays local
  DF5="${SCRATCH}/b19e"; mk_age_fixture "${DF5}" 1; : > "${HOOK_LOG}"
  run_backup prunefail_nohook "${DF5}"
  if [ "${RC}" -eq 2 ] && grep -q "stays on this host only" <<< "${OUT}" \
    && grep -qF "ERROR: retention could not remove 1 old backup(s); the backup is complete" <<< "${OUT}" \
    && [ ! -s "${HOOK_LOG}" ] && [ "$(valid_count "${DF5}")" -ge 1 ] \
    && [ "$(find "${DF5}" -mindepth 2 -maxdepth 2 -name postgres.sql.gz -size +0 | wc -l | tr -d ' ')" = "1" ]; then
    ok "retention removal: prune fail, no hook: exit 2, backup kept"
  else bad "prune fail, no hook: rc=${RC} out=${OUT}"; fi

  # The next run: rm removed the stuck backup's dumps but not its locked
  # subdirectory, so the entry is no longer a complete backup. It is left alone
  # and only the note reports it; the run exits 0 (the exit 2 came only from the
  # run whose removal failed).
  sleep 1
  run_backup prunefail_nextrun "${DF5}"
  if [ "${RC}" -eq 0 ] \
    && grep -qF "Retention left 1 entry in ${DF5} alone" <<< "${OUT}" \
    && ! grep -q "WARNING" <<< "${OUT}" && ! grep -q "ERROR" <<< "${OUT}" \
    && [ -f "${DF5}/20010102_000000/locked/file" ] \
    && gone "${DF5}/20010102_000000/postgres.sql.gz" "${DF5}/20010102_000000/clickhouse_logs.native.gz" \
    && [ "$(find "${DF5}" -mindepth 2 -maxdepth 2 -name postgres.sql.gz -size +0 | wc -l | tr -d ' ')" = "2" ]; then
    ok "retention removal: the run after a partial removal exits 0, the half-removed entry shows only in the note"
  else bad "run after a partial removal: rc=${RC} out=${OUT} files=$(find "${DF5}")"; fi

  # count path: 12 recent backups plus the new one; ranks 11 to 13 (names 03, 02, 01) are over the
  # limit, 02 is stuck, 03 and 01 are removed around it. A second case below has two stuck entries.
  DC="${SCRATCH}/b20"
  mkdir -p "${DC}"
  RECENT="$(days_ago 1)"
  for i in 01 03 04 05 06 07 08 09 10 11 12; do mk_backup "${DC}" "200101${i}_000000" "${RECENT}"; done
  mk_stuck "${DC}" 20010102_000000 "${RECENT}"
  : > "${HOOK_LOG}"
  BACKUP_OFFHOST_HOOK="${HOOK}" run_backup count_prunefail "${DC}"
  if [ "${RC}" -eq 2 ] \
    && grep -qF "WARNING: could not remove the old backup ${DC}/20010102_000000" <<< "${OUT}" \
    && grep -qF "ERROR: retention could not remove 1 old backup(s); the backup is complete" <<< "${OUT}" \
    && gone "${DC}/20010101_000000" "${DC}/20010103_000000" && present "${DC}/20010102_000000" "${DC}/20010104_000000" \
    && hook_ran_on "${DC}"; then
    ok "retention removal (count): prune fail / hook ok: warning, entries around it removed, hook runs, exit 2"
  else bad "count path prune fail: rc=${RC} out=${OUT}"; fi
  DC2="${SCRATCH}/b21"
  mkdir -p "${DC2}"
  for i in 03 04 05 06 07 08 09 10 11 12; do mk_backup "${DC2}" "200101${i}_000000" "${RECENT}"; done
  mk_stuck "${DC2}" 20010102_000000 "${RECENT}"
  mk_stuck "${DC2}" 20010101_000000 "${RECENT}"
  run_backup count_prunefail2 "${DC2}"
  if [ "${RC}" -eq 2 ] && grep -qF "ERROR: retention could not remove 2 old backup(s)" <<< "${OUT}" \
    && [ "$(grep -c 'WARNING' <<< "${OUT}")" = "2" ]; then
    ok "retention removal: two failures are counted as 2, one warning each"
  else bad "two failures: rc=${RC} out=${OUT}"; fi
fi
chmod -R u+rwx "${SCRATCH}" 2>/dev/null

# --- 6g. the timestamp pattern accepts ASCII digits only -------------------------
# Under glibc with a UTF-8 locale [0-9] also matches other digits, so a foreign
# directory named with fullwidth digits that holds both dumps would be pruned.
D22="${SCRATCH}/b22"
mkdir -p "${D22}"
# UTF-8 bytes of U+FF10..U+FF19 spelled out, so the name does not depend on the locale
FULLWIDTH=$'\xef\xbc\x92\xef\xbc\x90\xef\xbc\x90\xef\xbc\x91\xef\xbc\x90\xef\xbc\x91\xef\xbc\x90\xef\xbc\x91_\xef\xbc\x90\xef\xbc\x90\xef\xbc\x90\xef\xbc\x90\xef\xbc\x90\xef\xbc\x90'
mk_backup "${D22}" "${FULLWIDTH}" 201901010000
# The locale case proves something only in a locale where [0-9] does match a
# fullwidth digit (not every UTF-8 locale does: C.UTF-8 on glibc and the macOS
# locales do not), so each installed candidate is probed with the bash that
# runs backup.sh, and the case is skipped when none matches.
UTF8_LOCALE=""
FULLWIDTH_TWO=$'\xef\xbc\x92'
# captured first: `grep -q` closing the pipe early would fail the pipeline under pipefail
INSTALLED_LOCALES="$(locale -a 2>/dev/null)"
for cand in en_US.UTF-8 en_US.utf8 C.UTF-8 C.utf8; do
  grep -qxF "${cand}" <<< "${INSTALLED_LOCALES}" || continue
  if LC_ALL="${cand}" bash -c '[[ "$1" =~ ^[0-9]$ ]]' probe "${FULLWIDTH_TWO}" 2>/dev/null; then
    UTF8_LOCALE="${cand}"
    break
  fi
done
run_backup fullwidth_default "${D22}"
if [ "${RC}" -eq 0 ] && present "${D22}/${FULLWIDTH}/postgres.sql.gz" "${D22}/${FULLWIDTH}/clickhouse_logs.native.gz" \
  && grep -qF "Retention left 1 entry" <<< "${OUT}"; then
  ok "fullwidth-digit directory with both dumps survives (default locale) and is counted as left alone"
else bad "fullwidth digits, default locale: rc=${RC} out=${OUT}"; fi
if [ -n "${UTF8_LOCALE}" ]; then
  sleep 1
  LC_ALL="${UTF8_LOCALE}" run_backup fullwidth_utf8 "${D22}"
  if [ "${RC}" -eq 0 ] && present "${D22}/${FULLWIDTH}/postgres.sql.gz" "${D22}/${FULLWIDTH}/clickhouse_logs.native.gz" \
    && grep -qF "Retention left 1 entry" <<< "${OUT}"; then
    ok "fullwidth-digit directory with both dumps survives under ${UTF8_LOCALE}"
  else bad "fullwidth digits under ${UTF8_LOCALE}: rc=${RC} out=${OUT}"; fi
else
  echo "skip - fullwidth digits under a UTF-8 locale (no installed en_US.UTF-8 or C.UTF-8 locale in which [0-9] matches a fullwidth digit)"
fi

# --- 7. mkdir failures other than a collision -----------------------------------
# A backup path that exists gets the collision message (covered in 4b). Any other
# mkdir failure shows mkdir's own error and must not claim a collision.
D11="${SCRATCH}/b11"
mkdir -p "${D11}"
chmod 555 "${D11}"
if [ "$(id -u)" = "0" ] || [ -w "${D11}" ]; then
  echo "skip - read-only backup directory (running as root or the directory stays writable)"
else
  run_backup readonly "${D11}"
  if [ "${RC}" -ne 0 ] \
    && grep -qi "permission denied" <<< "${OUT}" \
    && ! grep -q "already exists" <<< "${OUT}" \
    && [ "$(count_dirs "${D11}")" = "0" ]; then
    ok "read-only backup dir: mkdir's own error, no collision message"
  else bad "read-only backup dir: rc=${RC} out=${OUT}"; fi
fi
chmod 755 "${D11}"

# --- 8. CDPATH must not redirect any resolved path -----------------------------
# The decoy tree holds a directory of the same relative name for each cd the
# script makes, so a cd that honours CDPATH lands in the decoy instead.
DECOY="${SCRATCH}/decoy"
mkdir -p "${DECOY}/bk" "${DECOY}/hooks" "${DECOY}/scripts"
CWD8="${SCRATCH}/cwd8"
mkdir -p "${CWD8}/hooks"
cp "${HOOK}" "${CWD8}/hooks/hook.sh"
: > "${HOOK_LOG}"
( cd "${CWD8}" && CDPATH="${DECOY}" BACKUP_OFFHOST_HOOK="hooks/hook.sh" bash "${BACKUP_SH}" "bk" > "${SCRATCH}/cdpath.out" 2>&1 ); RC=$?
BK8="$(find "${CWD8}/bk" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n 1)"
if [ "${RC}" -eq 0 ] && [ -n "${BK8}" ] \
  && [ "$(count_dirs "${DECOY}/bk")" = "0" ] \
  && grep -qxF "hook called with: ${BK8}" "${HOOK_LOG}" \
  && ! grep -q "${DECOY}" "${SCRATCH}/cdpath.out"; then
  ok "CDPATH set: backup dir resolves to the caller's path, not the decoy"
else bad "CDPATH set: rc=${RC} bk=${BK8} decoy=$(find "${DECOY}" -type f) hooklog=$(cat "${HOOK_LOG}") out=$(cat "${SCRATCH}/cdpath.out")"; fi

# the off-host hook path is resolved without CDPATH too: the hook exists only at
# ./hooks/hook.sh, and the decoy hooks/ directory has none, so a captured
# resolution would put the decoy directory in front of the file name
: > "${HOOK_LOG}"
( cd "${CWD8}" && CDPATH="${DECOY}" BACKUP_OFFHOST_HOOK="hooks/hook.sh" bash "${BACKUP_SH}" "${SCRATCH}/b12" > "${SCRATCH}/cdpath2.out" 2>&1 ); RC=$?
if [ "${RC}" -eq 0 ] && [ "$(grep -c '^hook called with:' "${HOOK_LOG}")" = "1" ]; then
  ok "CDPATH set: relative off-host hook path still resolves"
else bad "CDPATH set, hook: rc=${RC} out=$(cat "${SCRATCH}/cdpath2.out")"; fi

# the script's own directory: started as scripts/backup.sh, with a decoy scripts/
# directory on CDPATH, the default compose file is still the repository's
( cd "${REPO2}" && env -u BACKUP_COMPOSE_FILE -u BACKUP_ENV_FILE CDPATH="${DECOY}" bash scripts/backup.sh "${SCRATCH}/b13" > "${SCRATCH}/cdpath3.out" 2>&1 ); RC=$?
if [ "${RC}" -eq 0 ]; then ok "CDPATH set: script directory resolves to the repository's scripts/"
else bad "CDPATH set, script dir: rc=${RC} out=$(cat "${SCRATCH}/cdpath3.out")"; fi

# --- 9. the scratch cleanup removes only a directory made from its template ----
# (scripts/test-scratch-safety.test.sh covers the failed mktemp itself)
CLEAN="${SCRATCH}/cleanup"
mkdir -p "${CLEAN}/cwd-decoy" "${CLEAN}/rel/telerithm-backup-test.rel" "${CLEAN}/telerithm-backup-test.own"
for d in "${CLEAN}/cwd-decoy" "${CLEAN}/rel/telerithm-backup-test.rel" "${CLEAN}/telerithm-backup-test.own"; do echo keep > "${d}/canary"; done
remove_scratch "${CLEAN}/cwd-decoy"
( cd "${CLEAN}/rel" && remove_scratch "telerithm-backup-test.rel" )
remove_scratch ""
if present "${CLEAN}/cwd-decoy/canary" "${CLEAN}/rel/telerithm-backup-test.rel/canary"; then
  ok "scratch cleanup: a directory with another name, or a relative path, is left alone"
else bad "scratch cleanup removed a directory that is not its own: $(find "${CLEAN}")"; fi
remove_scratch "${CLEAN}/telerithm-backup-test.own"
if gone "${CLEAN}/telerithm-backup-test.own"; then
  ok "scratch cleanup: a directory made from the template is removed"
else bad "scratch cleanup left its own directory: $(find "${CLEAN}")"; fi

echo
echo "passed: ${PASS}, failed: ${FAIL}"
[ "${FAIL}" -eq 0 ]
