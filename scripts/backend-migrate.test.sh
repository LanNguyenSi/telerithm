#!/usr/bin/env bash
# Tests for backend/scripts/migrate.sh and backend/entrypoint.sh: every branch
# of the start-time migration decision. The Prisma CLI is a stub (PRISMA_CLI)
# and `node` is a stub first on PATH, so no database, Prisma engine, seed or
# server is touched. DATABASE_URL points at a closed port, so even a call that
# missed the stubs could not reach a database.
#
# Usage: bash scripts/backend-migrate.test.sh
#
# Every scenario runs under each POSIX shell found here (sh, dash, busybox sh),
# because the image runs busybox ash and CI's sh is dash; a `sh` shim first on
# PATH makes the entrypoint's own `sh scripts/migrate.sh` use the same shell.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND="${REPO_ROOT}/backend"
BASELINE=20261027132152_baseline

# A failed mktemp stops the test before anything runs: with an empty SCRATCH,
# `cd ""` stays in the current directory (bash 3.2 and 5.2), so the cleanup
# would delete the directory the test was started from. The path is resolved
# (macOS /tmp and TMPDIR are symlinks) only once it is known to be a directory.
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-migrate-test.XXXXXX")" \
  || { echo "FATAL: mktemp failed" >&2; exit 2; }
if [ -z "${SCRATCH}" ] || [ ! -d "${SCRATCH}" ]; then
  echo "FATAL: mktemp did not create a directory: '${SCRATCH}'" >&2
  exit 2
fi
SCRATCH="$(CDPATH='' cd -- "${SCRATCH}" && pwd -P)" \
  || { echo "FATAL: cannot resolve the scratch directory" >&2; exit 2; }
# remove_scratch <dir>: deletes <dir> only when it is a directory made from this
# script's mktemp template (an absolute path whose last component is
# telerithm-migrate-test.<suffix>); any other value is left alone.
remove_scratch() {
  case "$1" in /*) ;; *) return 0 ;; esac
  case "${1##*/}" in telerithm-migrate-test.?*) ;; *) return 0 ;; esac
  rm -rf "$1"
}
trap 'remove_scratch "${SCRATCH}"' EXIT

# --- stubs -------------------------------------------------------------------
# The prisma stub answers by the exact command line the script must use, and
# appends one word per call to $STUB_LOG. Behaviour:
#   STUB_HISTORY     present | absent | error: answers of the two db execute
#                    probes (error: both fail, as on a connection error)
#   STUB_EMPTY_RC    exit of `migrate diff --from-empty` (0 empty, 2 not, 1 error)
#   STUB_EQUAL_RC    exit of the diff against the frozen prisma/baseline.prisma
#                    (0 equal, 2 differs, 1 error)
#   STUB_RESOLVE_RC  exit of `migrate resolve` (default 0)
#   STUB_DEPLOY_RC   exit of `migrate deploy` (default 0)
# Any other command line is logged as "unexpected" and exits 95.
STUB_DIR="${SCRATCH}/stubbin"
mkdir -p "${STUB_DIR}"
cat > "${STUB_DIR}/prisma" <<'STUB'
#!/usr/bin/env bash
args="$*"
log() { echo "$1" >> "${STUB_LOG}"; }
case "${args}" in
  "db execute --stdin --schema prisma/schema.prisma")
    sql="$(cat)"
    case "${sql}" in
      *'to_regclass($q$public._prisma_migrations$q$) IS NULL THEN RAISE EXCEPTION'*) probe=present ;;
      *'to_regclass($q$public._prisma_migrations$q$) IS NOT NULL THEN RAISE EXCEPTION'*) probe=absent ;;
      *) log "unexpected-sql"; exit 96 ;;
    esac
    log "probe-${probe}"
    case "${STUB_HISTORY:-unset}" in
      error) echo "Error: P1001 Can't reach database server" >&2; exit 1 ;;
      "${probe}") echo "Script executed successfully."; exit 0 ;;
      present | absent) echo "Error: ERROR: probe raised" >&2; exit 1 ;;
      *) log "STUB_HISTORY-unset"; exit 94 ;;
    esac ;;
  "migrate diff --from-empty --to-schema-datasource prisma/schema.prisma --exit-code")
    log "diff-empty"
    [ "${STUB_EMPTY_RC:-x}" = 2 ] && echo "[+] Added tables"
    [ "${STUB_EMPTY_RC:-x}" = 1 ] && echo "Error: P1001 Can't reach database server" >&2
    exit "${STUB_EMPTY_RC:-94}" ;;
  "migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/baseline.prisma --exit-code")
    log "diff-equal"
    [ "${STUB_EQUAL_RC:-x}" = 2 ] && printf '%s\n' '[*] Changed the `User` table' '  [-] Removed column `legacyNote`'
    [ "${STUB_EQUAL_RC:-x}" = 1 ] && echo "Error: P1001 Can't reach database server" >&2
    exit "${STUB_EQUAL_RC:-94}" ;;
  "migrate resolve --applied "*)
    log "resolve:${args#migrate resolve --applied }"
    exit "${STUB_RESOLVE_RC:-0}" ;;
  "migrate deploy")
    log "deploy"
    [ "${STUB_DEPLOY_RC:-0}" = 0 ] || echo "Error: P3018 A migration failed to apply." >&2
    exit "${STUB_DEPLOY_RC:-0}" ;;
  "db push"*)
    log "db-push"
    exit 0 ;;
esac
log "unexpected:${args}"
exit 95
STUB
cat > "${STUB_DIR}/node" <<'STUB'
#!/usr/bin/env bash
echo "node:$*" >> "${STUB_LOG}"
exit 0
STUB
chmod +x "${STUB_DIR}/prisma" "${STUB_DIR}/node"
export STUB_LOG="${SCRATCH}/calls.log"
export PRISMA_CLI="${STUB_DIR}/prisma"
SAFE_URL="postgresql://stub:stub@127.0.0.1:1/stub"

# --- shells ------------------------------------------------------------------
SHELLS=()
add_shell() { # add_shell <name> <command>: a bin dir whose `sh` runs <command>
  local dir="${SCRATCH}/shell-$1"
  mkdir -p "${dir}"
  if [ "$1" = busybox ]; then
    printf '#!/bin/sh\nexec %s sh "$@"\n' "$2" > "${dir}/sh"
  else
    printf '#!/bin/sh\nexec %s "$@"\n' "$2" > "${dir}/sh"
  fi
  chmod +x "${dir}/sh"
  SHELLS+=("$1")
}
add_shell sh /bin/sh
command -v dash >/dev/null 2>&1 && add_shell dash "$(command -v dash)"
command -v busybox >/dev/null 2>&1 && add_shell busybox "$(command -v busybox)"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

# run_in <dir> <script>: runs `sh <script>` in <dir> under the current shell,
# with the scenario's STUB_* and DATABASE_URL; sets RC, OUT and CALLS (the
# stub log as one space-separated line).
run_in() {
  : > "${STUB_LOG}"
  OUT="$(cd "$1" && export PATH="${SCRATCH}/shell-${CUR_SHELL}:${STUB_DIR}:${PATH}" && sh "$2" 2>&1)"
  RC=$?
  CALLS="$(tr '\n' ' ' < "${STUB_LOG}" | sed 's/ $//')"
}
run_entrypoint() { run_in "${BACKEND}" entrypoint.sh; }

# expect <name> <rc: 0 or nonzero> <exact call sequence> [<text the output must contain>...]
expect() {
  local name="[${CUR_SHELL}] $1" want_rc="$2" want_calls="$3"
  shift 3
  local problems=""
  if [ "${want_rc}" = 0 ] && [ "${RC}" -ne 0 ]; then problems+=" exit ${RC}, want 0;"; fi
  if [ "${want_rc}" = nonzero ] && [ "${RC}" -eq 0 ]; then problems+=" exit 0, want non-zero;"; fi
  if [ "${CALLS}" != "${want_calls}" ]; then problems+=" calls [${CALLS}], want [${want_calls}];"; fi
  case " ${CALLS} " in *" db-push "*) problems+=" ran prisma db push;" ;; esac
  local text
  for text in "$@"; do
    case "${OUT}" in *"${text}"*) ;; *) problems+=" output lacks '${text}';" ;; esac
  done
  if [ -z "${problems}" ]; then ok "${name}"; else bad "${name}:${problems}"; printf '%s\n' "${OUT}" | sed 's/^/       | /'; fi
}

SERVER="node:dist/seed.js node:dist/server.js"
NOT_STARTED="the server is not started"

scenarios() {
  export DATABASE_URL="${SAFE_URL}"
  unset STUB_HISTORY STUB_EMPTY_RC STUB_EQUAL_RC STUB_RESOLVE_RC STUB_DEPLOY_RC

  # --- the four database states ---------------------------------------------
  STUB_HISTORY=present run_entrypoint
  expect "history present: deploy only, then seed and server" 0 "probe-present deploy ${SERVER}" "migration history found"

  STUB_HISTORY=absent STUB_EMPTY_RC=0 run_entrypoint
  expect "no history, empty database: deploy only" 0 "probe-present probe-absent diff-empty deploy ${SERVER}" "empty database"

  STUB_HISTORY=absent STUB_EMPTY_RC=2 STUB_EQUAL_RC=0 run_entrypoint
  expect "no history, not empty, schema equal: resolve the baseline, then deploy" 0 \
    "probe-present probe-absent diff-empty diff-equal resolve:${BASELINE} deploy ${SERVER}" "recording the baseline migration ${BASELINE} as applied"

  STUB_HISTORY=absent STUB_EMPTY_RC=2 STUB_EQUAL_RC=2 run_entrypoint
  expect "no history, not empty, schema differs: abort, no resolve, no deploy, no server" nonzero \
    "probe-present probe-absent diff-empty diff-equal" \
    "differs from the baseline schema prisma/baseline.prisma" "not with the current prisma/schema.prisma" 'Removed column `legacyNote`' "scripts/backup.sh" \
    'DEPLOYMENT.md, "Database migrations"' "migrate resolve --applied ${BASELINE}" "Do not run prisma db push" "${NOT_STARTED}"

  # --- errors while checking --------------------------------------------------
  STUB_HISTORY=error run_entrypoint
  expect "history probes both fail: abort before any other check" nonzero "probe-present probe-absent" \
    "could not tell whether the database has a migration history" "P1001" "${NOT_STARTED}"

  STUB_HISTORY=absent STUB_EMPTY_RC=1 run_entrypoint
  expect "emptiness check errors: abort" nonzero "probe-present probe-absent diff-empty" \
    "could not tell whether the database is empty" "P1001" "${NOT_STARTED}"

  STUB_HISTORY=absent STUB_EMPTY_RC=3 run_entrypoint
  expect "emptiness check returns an unknown code: abort" nonzero "probe-present probe-absent diff-empty" \
    "could not tell whether the database is empty (prisma migrate diff exit 3" "${NOT_STARTED}"

  STUB_HISTORY=absent STUB_EMPTY_RC=2 STUB_EQUAL_RC=1 run_entrypoint
  expect "equality check errors: abort, no resolve" nonzero "probe-present probe-absent diff-empty diff-equal" \
    "could not compare the database with prisma/baseline.prisma" "P1001" "${NOT_STARTED}"

  STUB_HISTORY=absent STUB_EMPTY_RC=2 STUB_EQUAL_RC=3 run_entrypoint
  expect "equality check returns an unknown code: abort, no resolve" nonzero "probe-present probe-absent diff-empty diff-equal" \
    "could not compare the database with prisma/baseline.prisma (prisma migrate diff exit 3" "${NOT_STARTED}"

  STUB_HISTORY=absent STUB_EMPTY_RC=2 STUB_EQUAL_RC=0 STUB_RESOLVE_RC=1 run_entrypoint
  expect "resolve fails: abort, no deploy" nonzero "probe-present probe-absent diff-empty diff-equal resolve:${BASELINE}" \
    "prisma migrate resolve failed" "${NOT_STARTED}"

  # --- a failing deploy never starts the server, on each of the three paths ---
  STUB_HISTORY=present STUB_DEPLOY_RC=1 run_entrypoint
  expect "deploy fails (history present): non-zero, no seed, no server" nonzero "probe-present deploy" \
    "prisma migrate deploy failed (exit 1)" "${NOT_STARTED}"

  STUB_HISTORY=absent STUB_EMPTY_RC=0 STUB_DEPLOY_RC=1 run_entrypoint
  expect "deploy fails (empty database): non-zero, no seed, no server" nonzero "probe-present probe-absent diff-empty deploy" \
    "prisma migrate deploy failed (exit 1)" "${NOT_STARTED}"

  STUB_HISTORY=absent STUB_EMPTY_RC=2 STUB_EQUAL_RC=0 STUB_DEPLOY_RC=1 run_entrypoint
  expect "deploy fails (after the baseline resolve): non-zero, no seed, no server" nonzero \
    "probe-present probe-absent diff-empty diff-equal resolve:${BASELINE} deploy" "prisma migrate deploy failed (exit 1)" "${NOT_STARTED}"

  # --- DATABASE_URL schema parameter: one case per form -----------------------
  # Not set or empty: the script does not read it (Prisma reads it, or .env).
  unset DATABASE_URL
  STUB_HISTORY=present run_entrypoint
  export DATABASE_URL="${SAFE_URL}"
  expect "DATABASE_URL unset: proceeds" 0 "probe-present deploy ${SERVER}"
  DATABASE_URL="" STUB_HISTORY=present run_entrypoint
  expect "DATABASE_URL empty: proceeds" 0 "probe-present deploy ${SERVER}"
  DATABASE_URL="postgresql://u:p@db:5432/telerithm?connection_limit=20&pool_timeout=10" STUB_HISTORY=present run_entrypoint
  expect "production URL (no schema parameter): proceeds" 0 "probe-present deploy ${SERVER}"
  DATABASE_URL="postgresql://u:p@db:5432/telerithm?schema=public" STUB_HISTORY=present run_entrypoint
  expect "?schema=public: proceeds" 0 "probe-present deploy ${SERVER}"
  DATABASE_URL="postgresql://u:p@db:5432/telerithm?schema=public&connection_limit=5" STUB_HISTORY=present run_entrypoint
  expect "?schema=public&...: proceeds" 0 "probe-present deploy ${SERVER}"
  DATABASE_URL="postgresql://u:p@db:5432/telerithm?connection_limit=5&schema=public" STUB_HISTORY=present run_entrypoint
  expect "...&schema=public: proceeds" 0 "probe-present deploy ${SERVER}"
  DATABASE_URL="postgresql://u:p@db:5432/telerithm?schema=tenant" STUB_HISTORY=present run_entrypoint
  expect "?schema=tenant: abort before any prisma call" nonzero "" "selects a schema other than public" "${NOT_STARTED}"
  DATABASE_URL="postgresql://u:p@db:5432/telerithm?connection_limit=5&schema=tenant" STUB_HISTORY=present run_entrypoint
  expect "...&schema=tenant: abort before any prisma call" nonzero "" "selects a schema other than public"
  DATABASE_URL="postgresql://u:p@db:5432/telerithm?schema=publicx" STUB_HISTORY=present run_entrypoint
  expect "?schema=publicx: abort (not public)" nonzero "" "selects a schema other than public"

  # --- PRISMA_CLI: set (every scenario above), unset or empty (default path) --
  local plain="${SCRATCH}/plain-${CUR_SHELL}"
  rm -rf "${plain}"
  mkdir -p "${plain}/node_modules/.bin" "${plain}/scripts"
  cp "${BACKEND}/scripts/migrate.sh" "${plain}/scripts/"
  cp "${STUB_DIR}/prisma" "${plain}/node_modules/.bin/prisma"
  unset PRISMA_CLI
  STUB_HISTORY=present run_in "${plain}" scripts/migrate.sh
  export PRISMA_CLI="${STUB_DIR}/prisma"
  expect "PRISMA_CLI unset: node_modules/.bin/prisma is used" 0 "probe-present deploy"
  PRISMA_CLI="" STUB_HISTORY=present run_in "${plain}" scripts/migrate.sh
  expect "PRISMA_CLI empty: node_modules/.bin/prisma is used" 0 "probe-present deploy"
  rm "${plain}/node_modules/.bin/prisma"
  unset PRISMA_CLI
  STUB_HISTORY=present run_in "${plain}" scripts/migrate.sh
  export PRISMA_CLI="${STUB_DIR}/prisma"
  expect "PRISMA_CLI unset, no local CLI: abort (no npx download)" nonzero "" "could not tell whether the database has a migration history"

  # --- prisma/baseline.prisma missing: refuse before the comparison ----------
  # The scratch copy has the script and no prisma/baseline.prisma. A database
  # from before migrations stops after the emptiness check: no comparison, no
  # resolve, no deploy.
  STUB_HISTORY=absent STUB_EMPTY_RC=2 STUB_EQUAL_RC=0 run_in "${plain}" scripts/migrate.sh
  expect "baseline.prisma missing, database with tables and no history: abort before the comparison" nonzero \
    "probe-present probe-absent diff-empty" "prisma/baseline.prisma is missing" "Nothing was changed"
  # The same scratch copy with the file present takes the normal path, so the
  # case above is about the file and not about the scratch layout.
  mkdir -p "${plain}/prisma"
  : > "${plain}/prisma/baseline.prisma"
  STUB_HISTORY=absent STUB_EMPTY_RC=2 STUB_EQUAL_RC=0 run_in "${plain}" scripts/migrate.sh
  expect "baseline.prisma present in the same scratch copy: resolve the baseline, then deploy" 0 \
    "probe-present probe-absent diff-empty diff-equal resolve:${BASELINE} deploy"
  rm -rf "${plain}/prisma"
  # The file is read only on the branch that compares: other states need no file.
  STUB_HISTORY=present run_in "${plain}" scripts/migrate.sh
  expect "baseline.prisma missing, history present: deploy only" 0 "probe-present deploy"
  STUB_HISTORY=absent STUB_EMPTY_RC=0 run_in "${plain}" scripts/migrate.sh
  expect "baseline.prisma missing, empty database: deploy only" 0 "probe-present probe-absent diff-empty deploy"
}

for CUR_SHELL in "${SHELLS[@]}"; do
  scenarios
done

# --- contracts with the repository -------------------------------------------
script_baseline="$(sed -n 's/^BASELINE_MIGRATION=//p' "${BACKEND}/scripts/migrate.sh")"
first_migration="$(find "${BACKEND}/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | LC_ALL=C sort | head -n 1)"
if [ "${script_baseline}" = "${BASELINE}" ] && [ "${first_migration}" = "${BASELINE}" ] && [ -s "${BACKEND}/prisma/migrations/${BASELINE}/migration.sql" ]; then
  ok "BASELINE_MIGRATION names the first committed migration, which has a migration.sql"
else
  bad "BASELINE_MIGRATION is '${script_baseline}', the first migration directory is '${first_migration}', this test expects '${BASELINE}' with a migration.sql"
fi
if grep -qx 'provider = "postgresql"' "${BACKEND}/prisma/migrations/migration_lock.toml" 2>/dev/null; then
  ok "migration_lock.toml pins the postgresql provider"
else
  bad "backend/prisma/migrations/migration_lock.toml is missing or not postgresql"
fi
if awk '/^FROM .* AS runtime/{r=1} r && /^COPY scripts \.\/scripts$/{f=1} END{exit !f}' "${BACKEND}/Dockerfile"; then
  ok "the runtime image copies backend/scripts (the entrypoint runs scripts/migrate.sh)"
else
  bad "backend/Dockerfile's runtime stage does not COPY scripts ./scripts"
fi

# The runtime image copies prisma/ whole, so prisma/baseline.prisma is in the
# image the entrypoint runs migrate.sh from. A narrower COPY would leave the
# file out and every database from before migrations would be refused.
if awk '/^FROM .* AS runtime/{r=1} r && /^COPY prisma \.\/prisma$/{f=1} END{exit !f}' "${BACKEND}/Dockerfile"; then
  ok "the runtime image copies backend/prisma whole (prisma/baseline.prisma ships with migrate.sh)"
else
  bad "backend/Dockerfile's runtime stage does not COPY prisma ./prisma, so prisma/baseline.prisma would be missing from the image"
fi
if [ -s "${BACKEND}/prisma/baseline.prisma" ]; then
  ok "backend/prisma/baseline.prisma exists"
else
  bad "backend/prisma/baseline.prisma is missing or empty"
fi

# baseline.prisma reproduces the baseline migration's SQL. `prisma migrate
# diff --from-empty --script` needs the CLI from node_modules (npm ci in
# backend/) but no database. Prisma adds a leading `CREATE SCHEMA IF NOT EXISTS
# "public"` block (three lines) and a trailing blank line that the committed
# migration omits (see CHANGELOG.md); both are cut, nothing else.
if [ -x "${BACKEND}/node_modules/.bin/prisma" ]; then
  generated="${SCRATCH}/baseline-from-schema.sql"
  if (cd "${BACKEND}" && node_modules/.bin/prisma migrate diff --from-empty --to-schema-datamodel prisma/baseline.prisma --script 2>/dev/null) | sed '1,3d;$d' > "${generated}" \
    && cmp -s "${generated}" "${BACKEND}/prisma/migrations/${BASELINE}/migration.sql"; then
    ok "baseline.prisma produces ${BASELINE}/migration.sql byte for byte"
  else
    bad "baseline.prisma no longer produces ${BASELINE}/migration.sql byte for byte (the frozen file drifted)"
  fi
else
  echo "skip - baseline.prisma vs ${BASELINE}/migration.sql: backend/node_modules/.bin/prisma not installed (the CI job Backend runs this check)"
fi

# the scratch cleanup removes only a directory made from its template
# (scripts/test-scratch-safety.test.sh covers the failed mktemp itself)
CLEAN="${SCRATCH}/cleanup"
mkdir -p "${CLEAN}/cwd-decoy" "${CLEAN}/rel/telerithm-migrate-test.rel" "${CLEAN}/telerithm-migrate-test.own"
for d in "${CLEAN}/cwd-decoy" "${CLEAN}/rel/telerithm-migrate-test.rel" "${CLEAN}/telerithm-migrate-test.own"; do echo keep > "${d}/canary"; done
remove_scratch "${CLEAN}/cwd-decoy"
( cd "${CLEAN}/rel" && remove_scratch "telerithm-migrate-test.rel" )
if [ -f "${CLEAN}/cwd-decoy/canary" ] && [ -f "${CLEAN}/rel/telerithm-migrate-test.rel/canary" ]; then
  ok "scratch cleanup: a directory with another name, or a relative path, is left alone"
else bad "scratch cleanup removed a directory that is not its own: $(find "${CLEAN}")"; fi
remove_scratch "${CLEAN}/telerithm-migrate-test.own"
if [ ! -e "${CLEAN}/telerithm-migrate-test.own" ]; then
  ok "scratch cleanup: a directory made from the template is removed"
else bad "scratch cleanup left its own directory: $(find "${CLEAN}")"; fi

echo
echo "shells: ${SHELLS[*]}"
echo "passed=${PASS} failed=${FAIL}"
[ "${FAIL}" -eq 0 ]
