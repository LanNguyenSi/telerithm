#!/usr/bin/env bash
# Controls for scripts/clickhouse-config-guard.sh: the guard must pass on a copy
# of the shipped files and must fail, with the message of its own branch, for
# each mutation below. A bare non-zero exit is not enough (the guard would also
# "fail" if it broke for another reason), so every case greps the message.
#
# Usage: scripts/clickhouse-config-guard.test.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
guard="$repo/scripts/clickhouse-config-guard.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=0

fresh_copy() {
  rm -rf "$work/tree"
  mkdir -p "$work/tree/backend"
  cp "$repo/docker-compose.prod.yml" "$repo/docker-compose.traefik.yml" "$work/tree/"
  cp -R "$repo/backend/clickhouse" "$work/tree/backend/clickhouse"
}

# replace <file> <old> <new>: exact, single replacement; fails the test run if
# <old> is not in the file, so a mutation can never silently turn into a no-op.
replace() {
  python3 - "$work/tree/$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1:4]
text = open(path).read()
if text.count(old) != 1:
    sys.exit(f"mutation target {old!r} found {text.count(old)} times in {path}, expected once")
open(path, "w").write(text.replace(old, new))
PY
}

# expect_fail <name> <message fragment>: runs the guard on the mutated copy.
expect_fail() {
  local name="$1" fragment="$2" out
  if out="$(bash "$guard" "$work/tree" 2>&1)"; then
    echo "FAIL $name: guard passed but must fail"
    failed=1
    return
  fi
  if ! grep -qF -- "$fragment" <<<"$out"; then
    echo "FAIL $name: guard failed for another reason (wanted: $fragment)"
    echo "$out"
    failed=1
    return
  fi
  echo "ok   $name"
}

users_mount='./backend/clickhouse/users.d:/etc/clickhouse-server/users.d:ro'
skip_env='CLICKHOUSE_SKIP_USER_SETUP: "1"'

fresh_copy
if ! out="$(bash "$guard" "$work/tree" 2>&1)"; then
  echo "FAIL baseline: guard failed on the shipped files"
  echo "$out"
  failed=1
else
  echo "ok   baseline passes"
fi

fresh_copy
replace docker-compose.prod.yml "      - $users_mount
" ""
expect_fail "users.d mount dropped (prod)" "docker-compose.prod.yml: clickhouse service does not mount backend/clickhouse/users.d"

fresh_copy
replace docker-compose.traefik.yml "      - $users_mount
" ""
expect_fail "users.d mount dropped (traefik)" "docker-compose.traefik.yml: clickhouse service does not mount backend/clickhouse/users.d"

fresh_copy
replace docker-compose.traefik.yml "$users_mount" "./backend/clickhouse/users.d:/etc/clickhouse-server/users.d"
expect_fail "users.d mounted read-write (traefik)" "/etc/clickhouse-server/users.d is not mounted read-only"

fresh_copy
replace docker-compose.prod.yml "./backend/clickhouse/config.d:/etc/clickhouse-server/config.d:ro" "./backend/clickhouse/config.d:/etc/clickhouse-server/config.d"
expect_fail "config.d mounted read-write (prod)" "/etc/clickhouse-server/config.d is not mounted read-only"

fresh_copy
replace docker-compose.prod.yml "- chdata:/var/lib/clickhouse" "- chdata:/var/lib/clickhouse
      - ./backend/clickhouse/init.sql:/tmp/extra.sql:ro"
expect_fail "volumes differ between the composes" "clickhouse volumes differ between docker-compose.prod.yml and docker-compose.traefik.yml"

fresh_copy
printf '<users><default/></users>\n' >"$work/tree/backend/clickhouse/users.d/bad-root.xml"
expect_fail "users.d file with <users> root" "backend/clickhouse/users.d/bad-root.xml: root element is <users>"

fresh_copy
printf '<clickhouse><a></clickhouse>\n' >"$work/tree/backend/clickhouse/config.d/broken.xml"
expect_fail "malformed XML in config.d" "backend/clickhouse/config.d/broken.xml: malformed XML"

fresh_copy
printf '<clickhouse><profiles><default/></profiles></clickhouse>\n' >"$work/tree/backend/clickhouse/config.d/profile.xml"
expect_fail "profiles block in config.d" "backend/clickhouse/config.d/profile.xml: <profiles> in config.d is ignored"

for var in CLICKHOUSE_USER CLICKHOUSE_PASSWORD CLICKHOUSE_PASSWORD_FILE CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT; do
  fresh_copy
  replace docker-compose.traefik.yml "$skip_env" "$skip_env
      $var: x"
  expect_fail "$var set on the service (traefik)" "docker-compose.traefik.yml: clickhouse service sets $var"
done

fresh_copy
replace docker-compose.prod.yml "$skip_env" 'CLICKHOUSE_UNRELATED: "1"'
expect_fail "CLICKHOUSE_SKIP_USER_SETUP removed (prod)" "docker-compose.prod.yml: clickhouse service must set CLICKHOUSE_SKIP_USER_SETUP=1"

fresh_copy
replace docker-compose.traefik.yml "$skip_env" 'CLICKHOUSE_SKIP_USER_SETUP: "0"'
expect_fail "CLICKHOUSE_SKIP_USER_SETUP=0 (traefik)" "docker-compose.traefik.yml: clickhouse service must set CLICKHOUSE_SKIP_USER_SETUP=1"

fresh_copy
replace docker-compose.prod.yml "name: telerithm-standalone
" ""
expect_fail "prod compose has no top-level name" "docker-compose.prod.yml: no top-level name:"

fresh_copy
replace docker-compose.prod.yml "name: telerithm-standalone" "name: telerithm"
expect_fail "prod compose takes the production project name" "share the project name 'telerithm'"

fresh_copy
replace docker-compose.traefik.yml "name: telerithm
" "name: telerithm-live
"
expect_fail "traefik compose project name changed" "docker-compose.traefik.yml: project name is 'telerithm-live', must stay 'telerithm'"

fresh_copy
replace docker-compose.prod.yml "  pgdata:
" "  pgdata:
    name: telerithm_pgdata
"
expect_fail "prod compose reuses a production volume" "share the volumes ['telerithm_pgdata']"

fresh_copy
replace docker-compose.traefik.yml "  pgdata:
    driver: local" "  pgdata:
    name: telerithm_pgdata_renamed
    driver: local"
expect_fail "traefik compose volume renamed" "docker-compose.traefik.yml: volume names are"

fresh_copy
printf 'networks:\n  default:\n    name: telerithm_telerithm-internal\n' >>"$work/tree/docker-compose.prod.yml"
expect_fail "prod compose reuses the production network" "share the networks ['telerithm_telerithm-internal']"

exit "$failed"
