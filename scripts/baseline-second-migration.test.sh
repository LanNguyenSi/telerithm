#!/usr/bin/env bash
# Tests backend/scripts/migrate.sh against a real Postgres and the real Prisma
# CLI installed in backend/node_modules (npm ci in backend/), for the case the
# stub test scripts/backend-migrate.test.sh cannot show: what the baseline
# comparison does once a SECOND migration exists.
#
# A database from before migrations (tables, no _prisma_migrations) is compared
# with the frozen backend/prisma/baseline.prisma, never with the current
# schema.prisma. The repository holds only the baseline migration today, where
# the two files agree, so the scenarios run the script from a scratch copy of
# backend/ with one extra migration (a nullable column on "User") and a
# schema.prisma extended by the same column. Nothing of it is committed.
#
#   (a) a db-push database at the baseline is baselined, then the extra
#       migration is applied, and its rows are kept
#   (b) a database equal to the EXTENDED schema is refused untouched (no
#       _prisma_migrations table, rows and column kept)
#
# plus a fresh database, a deployed database that picks up the new migration,
# a missing baseline.prisma, the repository's own migrate.sh on a database at
# the baseline, and the byte check that baseline.prisma reproduces the baseline
# migration (the CI job Backend runs the same comparison as its own step).
#
# Needs a Postgres server and either psql or Docker with a running container to
# exec into. Run from anywhere:
#   MIGRATE_TEST_PG            server URL without a database name, with the role
#                              that may create databases (default
#                              postgresql://postgres:postgres@127.0.0.1:5432);
#                              the CI service uses
#                              postgresql://telerithm:telerithm@localhost:5432
#   MIGRATE_TEST_PG_CONTAINER  when psql is not installed: name of a running
#                              Postgres container; SQL then runs through
#                              `docker exec <name> psql -U <MIGRATE_TEST_PG_USER>`
#   MIGRATE_TEST_PG_USER       role for the container (default postgres)
#   MIGRATE_TEST_SH            shell that runs migrate.sh (default sh)
#
# Usage: bash scripts/baseline-second-migration.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND="${REPO_ROOT}/backend"
BASELINE=20261027132152_baseline
SCHEMA=prisma/schema.prisma
BASELINE_SCHEMA=prisma/baseline.prisma
PG="${MIGRATE_TEST_PG:-postgresql://postgres:postgres@127.0.0.1:5432}"
PG="${PG%/}"
PG_CONTAINER="${MIGRATE_TEST_PG_CONTAINER:-}"
PG_USER="${MIGRATE_TEST_PG_USER:-postgres}"
SH_BIN="${MIGRATE_TEST_SH:-sh}"
RUN_ID="bs$$"
PRISMA="${BACKEND}/node_modules/.bin/prisma"

if [ ! -x "${PRISMA}" ]; then
  echo "backend/node_modules/.bin/prisma not found: run npm ci in backend/ first" >&2
  exit 2
fi

# sql <database> <statement>: runs one statement, prints the unaligned result.
sql() {
  if [ -n "${PG_CONTAINER}" ]; then
    docker exec -i "${PG_CONTAINER}" psql -U "${PG_USER}" -d "$1" -v ON_ERROR_STOP=1 -At -c "$2"
  else
    psql "${PG}/$1" -v ON_ERROR_STOP=1 -At -c "$2"
  fi
}

DBS=()
new_db() { # new_db <suffix>: creates the database, sets DB and URL
  DB="${RUN_ID}_$1"
  sql postgres "CREATE DATABASE ${DB}" >/dev/null || { echo "cannot create database ${DB} (is Postgres reachable at ${PG}?)" >&2; exit 2; }
  DBS+=("${DB}")
  URL="${PG}/${DB}"
}
cleanup() {
  local d
  for d in "${DBS[@]:-}"; do
    [ -n "${d}" ] && sql postgres "DROP DATABASE IF EXISTS ${d} WITH (FORCE)" >/dev/null 2>&1
  done
  # WORK_DIR is the exact directory mktemp printed below, holding only this run's files.
  [ -n "${WORK_DIR:-}" ] && [ -d "${WORK_DIR}" ] && rm -rf "${WORK_DIR}"
}
trap cleanup EXIT
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/baseline-second-migration.XXXXXX")" || exit 2
OUT_FILE="${WORK_DIR}/out"
: > "${OUT_FILE}"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; [ -s "${OUT_FILE}" ] && sed 's/^/       | /' "${OUT_FILE}"; }
# check <name> <condition...>: ok when the condition command succeeds.
check() { local name="$1"; shift; if "$@"; then ok "${name}"; else bad "${name}"; fi; }
has_text() { case "${OUT}" in *"$1"*) return 0 ;; *) return 1 ;; esac; }

# The scratch copy of backend/: the script, the frozen baseline schema, the
# baseline migration, one extra migration and a schema.prisma that has its
# column. node_modules is a link to the real one, so the real Prisma CLI runs.
FX="${WORK_DIR}/fx/backend"
mkdir -p "${FX}/scripts" "${FX}/prisma/migrations/20261030000000_extra_note"
cp "${BACKEND}/scripts/migrate.sh" "${FX}/scripts/migrate.sh"
cp "${BACKEND}/${BASELINE_SCHEMA}" "${FX}/${BASELINE_SCHEMA}"
cp -R "${BACKEND}/prisma/migrations/${BASELINE}" "${FX}/prisma/migrations/"
cp "${BACKEND}/prisma/migrations/migration_lock.toml" "${FX}/prisma/migrations/"
awk '/^model User \{/ { inuser = 1 } inuser && /^\}/ { print "  extraNote       String?"; inuser = 0 } { print }' "${BACKEND}/${SCHEMA}" > "${FX}/${SCHEMA}"
echo 'ALTER TABLE "User" ADD COLUMN "extraNote" TEXT;' > "${FX}/prisma/migrations/20261030000000_extra_note/migration.sql"
ln -s "${BACKEND}/node_modules" "${FX}/node_modules"

# run_migrate [backend dir]: runs migrate.sh against $URL from the backend
# directory (default: the repository's own); sets RC and OUT.
run_migrate() {
  (cd "${1:-${BACKEND}}" && DATABASE_URL="${URL}" "${SH_BIN}" scripts/migrate.sh) >"${OUT_FILE}" 2>&1
  RC=$?
  OUT="$(cat "${OUT_FILE}")"
}
finished_rows() { sql "${DB}" "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL"; }
baseline_rows() { sql "${DB}" "SELECT count(*) FROM _prisma_migrations WHERE migration_name = '${BASELINE}' AND finished_at IS NOT NULL"; }
user_rows() { sql "${DB}" 'SELECT count(*) FROM "User"'; }
has_extra_column() { test "$(sql "${DB}" "SELECT count(*) FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'extraNote'")" = 1; }
has_history_table() { sql "${DB}" "SELECT to_regclass('public._prisma_migrations') IS NOT NULL"; }
# schema_matches <backend dir> <schema file>: the database equals the schema file.
schema_matches() { (cd "$1" && "${PRISMA}" migrate diff --from-url "${URL}" --to-schema-datamodel "$2" --exit-code >/dev/null 2>&1); }

# legacy_db <suffix> <backend dir> <schema file>: a database as the releases
# before migrations left it: a schema applied by prisma db push (only these
# fixtures use db push), one User row, no migration history.
legacy_db() {
  new_db "$1"
  (cd "$2" && DATABASE_URL="${URL}" "${PRISMA}" db push --schema "$3" --skip-generate) >"${OUT_FILE}" 2>&1 \
    || { echo "fixture: prisma db push failed" >&2; cat "${OUT_FILE}" >&2; exit 2; }
  sql "${DB}" "INSERT INTO \"User\" (id, email, \"passwordHash\", name, \"updatedAt\") VALUES ('u1', 'ops@example.test', 'x', 'ops', now())" >/dev/null
}

check "fixture: the scratch schema.prisma has the extra column, baseline.prisma does not" \
  test "$(grep -c extraNote "${FX}/${SCHEMA}")$(grep -c extraNote "${FX}/${BASELINE_SCHEMA}")" = 10

# --- (a) a database at the baseline: baselined, then the extra migration -------
legacy_db at_baseline "${FX}" "${BASELINE_SCHEMA}"
check "(a) fixture: tables exist and no migration history yet" test "$(has_history_table)" = f
run_migrate "${FX}"
check "(a) database at the baseline, a second migration exists: exit 0" test "${RC}" -eq 0
check "(a) compares with the baseline schema" has_text "comparing it with the baseline schema ${BASELINE_SCHEMA}"
check "(a) baseline recorded as applied, not run" has_text "recording the baseline migration ${BASELINE} as applied"
check "(a) both migrations finished" test "$(finished_rows)" = 2
check "(a) the baseline row is one of them" test "$(baseline_rows)" = 1
check "(a) the extra column exists" has_extra_column
check "(a) the existing row survived (the baseline SQL was not run)" test "$(user_rows)" = 1
check "(a) the database now equals the extended schema.prisma" schema_matches "${FX}" "${SCHEMA}"
run_migrate "${FX}"
check "(a) second run is the idempotent path" has_text "migration history found"
check "(a) second run keeps two finished rows" test "$(finished_rows)" = 2

# --- (b) a database equal to the EXTENDED schema is refused untouched ----------
legacy_db extended "${FX}" "${SCHEMA}"
run_migrate "${FX}"
check "(b) no-history database equal to the extended schema: exit 1" test "${RC}" -eq 1
check "(b) says it differs from the baseline schema" has_text "differs from the baseline schema ${BASELINE_SCHEMA}"
check "(b) says the comparison is with the baseline, not the current schema" has_text "not with the current ${SCHEMA}"
check "(b) shows the extra column as the difference" has_text "extraNote"
check "(b) no migration history created" test "$(has_history_table)" = f
check "(b) row and column untouched" test "$(user_rows)$(has_extra_column && echo c)" = 1c

# --- fresh database and an upgrade ---------------------------------------------
new_db fresh
run_migrate "${FX}"
check "fresh database, two migrations: exit 0" test "${RC}" -eq 0
check "fresh database: both migrations finished" test "$(finished_rows)" = 2
check "fresh database: equals the extended schema.prisma" schema_matches "${FX}" "${SCHEMA}"

# A deployed database whose history holds only the baseline picks up the new migration.
new_db upgrade
run_migrate
check "upgrade: the repository's own migrations apply the baseline alone" test "$(finished_rows)" = 1
run_migrate "${FX}"
check "upgrade: exit 0" test "${RC}" -eq 0
check "upgrade: takes the migration-history path" has_text "migration history found"
check "upgrade: the extra migration is applied" test "$(finished_rows)$(has_extra_column && echo c)" = 2c

# --- baseline.prisma missing ---------------------------------------------------
legacy_db no_baseline_file "${FX}" "${BASELINE_SCHEMA}"
mv "${FX}/${BASELINE_SCHEMA}" "${FX}/${BASELINE_SCHEMA}.off"
run_migrate "${FX}"
mv "${FX}/${BASELINE_SCHEMA}.off" "${FX}/${BASELINE_SCHEMA}"
check "baseline.prisma missing: exit 1" test "${RC}" -eq 1
check "baseline.prisma missing: names the file" has_text "${BASELINE_SCHEMA} is missing"
check "baseline.prisma missing: database untouched (no history, row kept)" test "$(has_history_table)$(user_rows)" = f1

# --- the repository's own script and migrations --------------------------------
legacy_db repo_baseline "${BACKEND}" "${BASELINE_SCHEMA}"
run_migrate
check "repository, database at the baseline: exit 0" test "${RC}" -eq 0
check "repository, database at the baseline: baseline recorded as applied" has_text "recording the baseline migration ${BASELINE} as applied"
check "repository, database at the baseline: one finished row, data kept" test "$(finished_rows)$(user_rows)" = 11
check "repository, database at the baseline: equals schema.prisma" schema_matches "${BACKEND}" "${SCHEMA}"

# --- the baseline schema file matches the baseline migration -------------------
# `prisma migrate diff --from-empty --script` prints a leading `CREATE SCHEMA IF
# NOT EXISTS "public"` block (three lines) and a trailing blank line that the
# committed migration omits (see CHANGELOG.md); both are cut, nothing else. The
# CI job Backend runs the same comparison as its own step.
(cd "${BACKEND}" && "${PRISMA}" migrate diff --from-empty --to-schema-datamodel "${BASELINE_SCHEMA}" --script 2>"${OUT_FILE}") | sed '1,3d;$d' > "${WORK_DIR}/baseline-from-schema.sql"
if cmp -s "${WORK_DIR}/baseline-from-schema.sql" "${BACKEND}/prisma/migrations/${BASELINE}/migration.sql"; then
  ok "baseline.prisma produces ${BASELINE}/migration.sql byte for byte"
else
  bad "baseline.prisma no longer produces ${BASELINE}/migration.sql byte for byte (the frozen file drifted)"
fi

echo
echo "passed=${PASS} failed=${FAIL}"
[ "${FAIL}" -eq 0 ]
