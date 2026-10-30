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

# A failed mktemp stops the run before the cleanup trap exists: with an empty
# work, the trap would delete the caller's directory (the guard's own
# test-scratch-safety coverage requires the fail-closed pattern).
work="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-clickhouse-guard-test.XXXXXX")" \
  || { echo "FATAL: mktemp failed" >&2; exit 2; }
if [ -z "$work" ] || [ ! -d "$work" ]; then
  echo "FATAL: mktemp did not create a directory: '$work'" >&2
  exit 2
fi
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

# Logging, limits and healthchecks of every service, and their mirroring.
# The anchors below are unique within the file they are replaced in.
fe_probe_head='    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('"'"'http://127.0.0.1:3000/'"'"
fe_test_block=$(cat <<'EOF_BLOCK'
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3000/', {redirect: 'manual', signal: AbortSignal.timeout(5000)}).then(r => process.exit(r.status < 400 ? 0 : 1)).catch(() => process.exit(1))",
        ]
EOF_BLOCK
)
fe_limits_traefik='          memory: 256M
          cpus: "0.5"
    labels:'
fe_limits_prod='          memory: 256M
          cpus: "0.5"

volumes:'
be_probe="fetch('http://127.0.0.1:4000/api/v1/health')"
be_localhost="fetch('http://localhost:4000/api/v1/health')"

fresh_copy
replace docker-compose.prod.yml 'max-size: "10m"' 'max-size: "20m"'
expect_fail "logging max-size differs (prod only)" "logging of service postgres differs between docker-compose.prod.yml and docker-compose.traefik.yml"

fresh_copy
replace docker-compose.traefik.yml '    logging: *default-logging
    environment:
      INTERNAL_API_BASE_URL' '    environment:
      INTERNAL_API_BASE_URL'
expect_fail "frontend has no logging (traefik)" "docker-compose.traefik.yml: service frontend has no bounded log"

fresh_copy
replace docker-compose.prod.yml '    max-file: "3"
' ''
replace docker-compose.traefik.yml '    max-file: "3"
' ''
expect_fail "log not bounded by max-file in both composes" "docker-compose.prod.yml: service postgres has no bounded log"

fresh_copy
replace docker-compose.prod.yml '  driver: json-file
  options:' '  driver: local
  options:'
replace docker-compose.traefik.yml '  driver: json-file
  options:' '  driver: local
  options:'
expect_fail "log driver is not json-file in both composes" "docker-compose.traefik.yml: service postgres has no bounded log"

fresh_copy
replace docker-compose.traefik.yml "$fe_limits_traefik" '          memory: 512M
          cpus: "0.5"
    labels:'
expect_fail "memory limit differs (traefik only)" "deploy.resources.limits.memory of service frontend differs between docker-compose.prod.yml and docker-compose.traefik.yml"

fresh_copy
replace docker-compose.prod.yml "$fe_limits_prod" '          memory: 256M
          cpus: "1.5"

volumes:'
expect_fail "cpus limit differs (prod only)" "deploy.resources.limits.cpus of service frontend differs between docker-compose.prod.yml and docker-compose.traefik.yml"

fresh_copy
replace docker-compose.prod.yml "    deploy:
      resources:
        limits:
$fe_limits_prod" '
volumes:'
expect_fail "limits block removed from frontend (prod)" "docker-compose.prod.yml: service frontend has no deploy.resources.limits.memory"

fresh_copy
replace docker-compose.traefik.yml "$fe_limits_traefik" '          memory: 256M
    labels:'
expect_fail "cpus limit removed from frontend (traefik)" "docker-compose.traefik.yml: service frontend has no deploy.resources.limits.cpus"

fresh_copy
replace docker-compose.prod.yml "$fe_probe_head" "$(printf '%s' "$fe_probe_head" | sed 's/healthcheck:/x-healthcheck-removed:/')"
expect_fail "frontend healthcheck removed (prod)" "docker-compose.prod.yml: service frontend has no healthcheck"

fresh_copy
replace docker-compose.traefik.yml "$fe_probe_head" "$(printf '%s' "$fe_probe_head" | sed 's/healthcheck:/x-healthcheck-removed:/')"
expect_fail "frontend healthcheck removed (traefik)" "docker-compose.traefik.yml: service frontend has no healthcheck"

fresh_copy
replace docker-compose.traefik.yml '      start_period: 30s
    networks:' '      start_period: 30s
      disable: true
    networks:'
expect_fail "frontend healthcheck disabled (traefik)" "docker-compose.traefik.yml: service frontend has no healthcheck"

fresh_copy
replace docker-compose.traefik.yml "$fe_test_block" '      test: ["NONE"]'
expect_fail "frontend healthcheck test is NONE (traefik)" "docker-compose.traefik.yml: service frontend has no healthcheck"

fresh_copy
replace docker-compose.prod.yml "$fe_test_block" '      test: ["NONE"]'
expect_fail "frontend healthcheck test is NONE (prod)" "docker-compose.prod.yml: service frontend has no healthcheck"

fresh_copy
replace docker-compose.traefik.yml "fetch('http://127.0.0.1:3000/'," "fetch('http://127.0.0.1:3000/health',"
expect_fail "frontend probe path differs (traefik only)" "healthcheck of service frontend differs between docker-compose.prod.yml and docker-compose.traefik.yml"

fresh_copy
replace docker-compose.traefik.yml '      start_period: 30s
    networks:' '      start_period: 60s
    networks:'
expect_fail "frontend start_period differs (traefik only)" "healthcheck of service frontend differs between docker-compose.prod.yml and docker-compose.traefik.yml"

# The backend probe host: localhost resolves to ::1 first and the backend
# listens on 0.0.0.0 only, so the probe must address 127.0.0.1. The second
# case mutates both composes identically, so only the host check can catch it.
fresh_copy
replace docker-compose.prod.yml "$be_probe" "$be_localhost"
expect_fail "backend probe host is localhost (prod)" "docker-compose.prod.yml: service backend healthcheck must probe http://127.0.0.1:4000/api/v1/health"

fresh_copy
replace docker-compose.prod.yml "$be_probe" "$be_localhost"
replace docker-compose.traefik.yml "$be_probe" "$be_localhost"
expect_fail "backend probe host is localhost in both composes" "docker-compose.traefik.yml: service backend healthcheck must probe http://127.0.0.1:4000/api/v1/health"

# A service behind a compose profile is rendered only with --profile '*', so
# without it this one would skip every per-service check.
fresh_copy
replace docker-compose.prod.yml "
volumes:
  pgdata:" "
  debugger:
    image: busybox:1.37
    profiles: [debug]

volumes:
  pgdata:"
expect_fail "unbounded service behind a profile (prod)" "docker-compose.prod.yml: service debugger has no bounded log"

exit "$failed"
