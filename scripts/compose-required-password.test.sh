#!/usr/bin/env bash
# Guard for the POSTGRES_PASSWORD interpolation in docker-compose.prod.yml.
# The file used to interpolate it as ${POSTGRES_PASSWORD:-telerithm}, so a host
# that forgot the variable in .env.production started Postgres with a password
# that is public with the repository, and the backend connected with it
# silently. Both places that use it (the postgres service environment and the
# backend DATABASE_URL) now interpolate it with the :? form, so compose refuses
# to start instead of substituting anything. Keep it that way.
#
# docker-compose.traefik.yml (the deployed variant) has no default either, but
# it interpolates the bare ${POSTGRES_PASSWORD} and so does NOT refuse: measured
# with `docker compose -f docker-compose.traefik.yml config` and the variable
# unset, compose exits 0, warns once per use that the variable is not set and
# defaults to a blank string, and renders POSTGRES_PASSWORD: "" and
# DATABASE_URL: postgresql://telerithm:@postgres... That is what
# .env.production.example says about it too. This check is about this file only.
#
# The two uses are read as YAML values at their place in the document
# (services.postgres.environment.POSTGRES_PASSWORD and
# services.backend.environment.DATABASE_URL), not by scanning the file for
# ${...} tokens: a tokeniser has to get nesting, $$ escapes, inline comments,
# whole-line comments and variable-name boundaries right, and every one of those
# was a way to pass a bad file (the controls below cover them one by one).
# Reading the value is simpler and stricter: the whole value must be the
# required form, so a nested default, a literal in front of or behind the
# interpolation, an escaped $ or a variable whose name only contains
# POSTGRES_PASSWORD cannot hide inside it. Needs python3 with PyYAML and fails
# closed without it: the CI job that runs this file (Shell script tests) already
# runs another compose check that requires PyYAML and fails closed without it
# (dev-compose-loopback.test.sh), so nothing installs it and a runner that lost
# it fails the job instead of skipping.
#
# When docker compose is available the check also renders the file, which is
# client-side and needs no daemon: with POSTGRES_PASSWORD unset
# `docker compose config` must fail and name the variable, and with a sentinel
# value both rendered uses must carry it. The sentinel must also appear exactly
# twice in the whole rendered document, once per required use: a third
# interpolation of the variable elsewhere in the file (a defaulted or a bare use
# on another service, which the two per-use rules cannot see) renders it a third
# time and fails there. A third use written as a literal stays out of scope:
# nothing in the rendered document says where a literal came from. render passes
# --env-file /dev/null, so a .env next to the compose file is never read as the
# source of the variable, and a failure message quotes compose's stderr and never
# its rendered output, so a value that a host keeps in a real .env cannot be
# printed by this test. A control puts a .env in the compose directory to keep
# both of those true. Without docker the section prints a visible skip line; the
# ClickHouse config job, which has Docker, runs this file with
# COMPOSE_REQUIRED_PASSWORD_REQUIRE_DOCKER=1, which turns that skip into a
# failure, so the behaviour assertion always runs somewhere in CI.
#
# The controls run the same check on mutated copies and must fail with the
# message of their own branch.
#
# Usage: bash scripts/compose-required-password.test.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="docker-compose.prod.yml"
# A password that is not the old fallback, so a rendered use that still says
# telerithm cannot pass for a substituted one.
SENTINEL="ci-sentinel-not-the-fallback"
# The value of the .env of the control below. Not the sentinel, so a render that
# read that file instead of refusing cannot pass for a substituted sentinel, and
# the control can require this value to be absent from the test output.
DOTENV_VALUE="ci-value-from-a-dotenv-that-must-not-appear"
REQUIRE_DOCKER="${COMPOSE_REQUIRED_PASSWORD_REQUIRE_DOCKER:-0}"

# The shipped line of each use, as the mutation target of the controls.
ENV_USE='POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env.production}'
URL_USE='postgresql://telerithm:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env.production}@postgres'

# check <path>: reads the two uses out of the parsed document and prints one
# FAIL line per problem, returns 1 when any.
check() {
  python3 - "$1" <<'PY'
import re
import sys

path = sys.argv[1]
try:
    text = open(path).read()
except OSError as exc:
    print(f"FAIL: cannot read {path}: {exc}")
    sys.exit(1)

try:
    import yaml
except ImportError:
    print("FAIL: PyYAML (python3 -c 'import yaml') is required")
    sys.exit(1)

try:
    doc = yaml.safe_load(text)
except yaml.YAMLError as exc:
    print(f"FAIL: {path} does not parse as YAML: {exc}")
    sys.exit(1)

# The required form of the interpolation: the name POSTGRES_PASSWORD ends at the
# :?, and the message holds no brace, so no other interpolation is nested in it.
REQUIRED = r"\$\{POSTGRES_PASSWORD:\?[^{}]*\}"
# (label, path in the document, whole-value pattern)
USES = [
    ("services.postgres.environment.POSTGRES_PASSWORD",
     ("services", "postgres", "environment", "POSTGRES_PASSWORD"),
     # the value IS the interpolation: anything around it is part of the password
     re.compile(REQUIRED)),
    ("services.backend.environment.DATABASE_URL",
     ("services", "backend", "environment", "DATABASE_URL"),
     # the interpolation sits in a URL, and no other $ may appear in it: that
     # rules out a $$ escape and a ${OTHER:-${POSTGRES_PASSWORD:?m}} nest
     re.compile(r"[^$]*" + REQUIRED + r"[^$]*")),
]


def lookup(document, keys):
    node = document
    for key in keys:
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    return node


fails = 0
for label, keys, pattern in USES:
    value = lookup(doc, keys)
    if not isinstance(value, str):
        print(f"FAIL: {path} has no interpolation of POSTGRES_PASSWORD at all for {label} (found {type(value).__name__}); the check would be a no-op on it")
        fails += 1
    elif pattern.fullmatch(value):
        continue
    elif "$" not in value:
        print(f"FAIL: {path} has no interpolation of POSTGRES_PASSWORD at all for {label}: compose starts with the value written in the file ({value})")
        fails += 1
    elif re.search(r"\$\{POSTGRES_PASSWORD:?-", value):
        print(f"FAIL: {label} lets POSTGRES_PASSWORD fall back to a default: {value}")
        fails += 1
    else:
        print(f"FAIL: {label} must require POSTGRES_PASSWORD with the :? form so compose refuses to start, found: {value}")
        fails += 1
sys.exit(1 if fails else 0)
PY
}

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

work="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-required-password-test.XXXXXX")" \
  || { echo "FATAL: mktemp failed" >&2; exit 2; }
if [ -z "$work" ] || [ ! -d "$work" ]; then
  echo "FATAL: mktemp did not create a directory: '$work'" >&2
  exit 2
fi
trap 'rm -rf "$work"' EXIT

fresh_copy() {
  rm -rf "$work/tree"
  mkdir -p "$work/tree"
  cp "$repo/$FILE" "$work/tree/$FILE"
}

# compose_dir <name>: a fresh copy of the file in a directory of its own, so a
# compose run never picks up another compose file, and prints the directory. A
# .env is kept away by the --env-file /dev/null of render, which is what lets the
# control below put one in such a directory on purpose.
compose_dir() {
  local dir="$work/compose/$1"
  rm -rf "$dir"
  mkdir -p "$dir"
  cp "$repo/$FILE" "$dir/$FILE"
  printf '%s\n' "$dir"
}

# mutate <file> <old> <new>: exact single replacement, fails when <old> is
# absent so a control cannot turn into a no-op.
mutate() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1:4]
text = open(path).read()
if text.count(old) != 1:
    sys.exit(f"mutation target {old!r} found {text.count(old)} times in {path}, expected once")
open(path, "w").write(text.replace(old, new))
PY
}

expect_fail() {
  local name="$1" fragment="$2" out
  if out="$(check "$work/tree/$FILE" 2>&1)"; then
    bad "$name: check passed but must fail"
    return
  fi
  if grep -qF -- "$fragment" <<<"$out"; then ok "$name"; else bad "$name: failed for another reason (wanted: $fragment): $out"; fi
}

# render <dir> <env-args...>: the rendered compose config of that directory, so
# that the env arguments (a -u or a POSTGRES_PASSWORD=...) are the only source of
# the variable; stderr goes to $work/render.stderr for the failure messages.
# --env-file /dev/null: without it compose auto-loads an .env next to the compose
# file, which is both a second source of the variable (the run below that unsets
# it would be accepted on a host that has one) and a way for a real value of that
# host to reach the output of this test.
render() {
  local dir="$1"
  shift
  ( cd "$dir" && env "$@" docker compose --env-file /dev/null -f "$FILE" config 2>"$work/render.stderr" )
}

# check_docker <dir>: behaviour of real compose on that copy. Prints one FAIL
# line per problem, returns 1 when any. The caller must have POSTGRES_PASSWORD
# exported, so that the unset run below has to clear it itself.
check_docker() {
  local dir="$1" err out

  if out="$(render "$dir" -u POSTGRES_PASSWORD)"; then
    # No rendered output here: a render that did pick up a value from a host's
    # .env must not print it. The message stays identifiable by its tail.
    printf 'FAIL: docker compose config accepted %s with POSTGRES_PASSWORD unset (it must refuse)\n' "$FILE"
    return 1
  fi
  # A refused run prints nothing on stdout, so only stderr is quoted in messages.
  err="$(cat "$work/render.stderr" 2>/dev/null || true)"
  if ! grep -qF -- "POSTGRES_PASSWORD" <<<"$out
$err"; then
    printf 'FAIL: docker compose config failed on %s without naming POSTGRES_PASSWORD: %s\n' "$FILE" "$err"
    return 1
  fi

  if ! out="$(render "$dir" "POSTGRES_PASSWORD=$SENTINEL")"; then
    printf 'FAIL: docker compose config failed on %s with POSTGRES_PASSWORD set: %s\n' "$FILE" "$(cat "$work/render.stderr")"
    return 1
  fi
  printf '%s\n' "$out" > "$work/rendered.yml"
  python3 - "$SENTINEL" "$FILE" "$work/rendered.yml" <<'PY'
import sys

sentinel, name, path = sys.argv[1:4]
try:
    import yaml
except ImportError:
    print("FAIL: PyYAML (python3 -c 'import yaml') is required")
    sys.exit(1)

with open(path) as fh:
    text = fh.read()
doc = yaml.safe_load(text)
services = (doc or {}).get("services") or {}
env = (services.get("postgres") or {}).get("environment") or {}
url = (services.get("backend") or {}).get("environment") or {}
expected_url_prefix = "postgresql://telerithm:%s@" % sentinel

fails = 0
got = env.get("POSTGRES_PASSWORD") if isinstance(env, dict) else None
if got != sentinel:
    print(f"FAIL: the rendered {name} does not render the sentinel for services.postgres.environment.POSTGRES_PASSWORD (got {got!r})")
    fails += 1
got = url.get("DATABASE_URL") if isinstance(url, dict) else None
# The sentinel must be the password of the URL: right after the user, before the
# host, and nowhere else. The rest of the URL (host, database, pool settings) is
# not this check's business, so it is not compared.
if not isinstance(got, str) or not got.startswith(expected_url_prefix) or got.count(sentinel) != 1:
    print(f"FAIL: the rendered {name} does not render the sentinel for services.backend.environment.DATABASE_URL (got {got!r})")
    fails += 1
# The sentinel must appear exactly twice in the whole rendered document, once per
# required use. The two checks above only read those two uses, so a third
# interpolation of POSTGRES_PASSWORD anywhere else in the file (a defaulted or a
# bare one on another service) passes them and is caught only here, by its third
# rendering of the sentinel. A third use written as a literal is out of scope:
# the rendered document does not say where a literal came from.
occurrences = text.count(sentinel)
if occurrences != 2:
    print(f"FAIL: the rendered {name} carries the sentinel {occurrences} times in the whole document, expected it exactly twice, once per required use")
    fails += 1
sys.exit(1 if fails else 0)
PY
}

expect_docker_fail() {
  local name="$1" dir="$2" fragment="$3" out
  if out="$(check_docker "$dir" 2>&1)"; then
    bad "$name: docker check passed but must fail"
    return
  fi
  if grep -qF -- "$fragment" <<<"$out"; then ok "$name"; else bad "$name: failed for another reason (wanted: $fragment): $out"; fi
}

if out="$(check "$repo/$FILE" 2>&1)"; then
  ok "the shipped compose file requires POSTGRES_PASSWORD with :? in both uses"
else
  bad "the shipped compose file: $out"
fi

# --- the file must not fall back, and must not substitute anything else ------

# :- default back on the postgres service environment.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-telerithm}'
expect_fail "default back (:-) on the postgres environment" "lets POSTGRES_PASSWORD fall back to a default"

# Default back on the backend DATABASE_URL. The postgres environment line keeps
# its :?, so this line alone is what the check has to catch.
fresh_copy
mutate "$work/tree/$FILE" "$URL_USE" 'postgresql://telerithm:${POSTGRES_PASSWORD:-telerithm}@postgres'
expect_fail "default back (:-) on the backend DATABASE_URL" "lets POSTGRES_PASSWORD fall back to a default"

# Same without the colon, the other default form compose accepts.
fresh_copy
mutate "$work/tree/$FILE" "$URL_USE" 'postgresql://telerithm:${POSTGRES_PASSWORD-telerithm}@postgres'
expect_fail "default back (-) on the backend DATABASE_URL" "lets POSTGRES_PASSWORD fall back to a default"

# The :? dropped: compose substitutes an empty password and still starts.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}'
expect_fail "bare interpolation without :?" "must require POSTGRES_PASSWORD with the"

# The same without the braces: Compose does interpolate this form (measured with
# `docker compose config`: the value when the variable is set, a blank string and
# a warning when it is not), but it requires nothing, so the container starts with
# that value or with an empty password.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: $POSTGRES_PASSWORD'
expect_fail "shell form without braces" "must require POSTGRES_PASSWORD with the"

# A default that hides one nesting level down.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-${FALLBACK:-telerithm}}'
expect_fail "default one nesting level down" "lets POSTGRES_PASSWORD fall back to a default"

# $$ escape: compose renders the literal text ${POSTGRES_PASSWORD:?...} as the
# password and requires nothing. Both lines, because that is what the escape
# does everywhere it appears.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: $${POSTGRES_PASSWORD:?m}'
mutate "$work/tree/$FILE" "$URL_USE" 'postgresql://telerithm:$${POSTGRES_PASSWORD:?m}@postgres'
expect_fail "escaped dollar, so nothing is interpolated" "must require POSTGRES_PASSWORD with the"

# The same escape on the DATABASE_URL alone, so it is that value's own rule
# against a second $ that refuses it.
fresh_copy
mutate "$work/tree/$FILE" "$URL_USE" 'postgresql://telerithm:$${POSTGRES_PASSWORD:?m}@postgres'
expect_fail "escaped dollar in the DATABASE_URL" "must require POSTGRES_PASSWORD with the"

# Text around the interpolation on the environment line: compose would start
# Postgres on that text plus the variable, not on the variable alone.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: pw-${POSTGRES_PASSWORD:?m}-x'
expect_fail "text around the interpolation on the environment line" "must require POSTGRES_PASSWORD with the"

# A literal with the interpolation behind an inline comment: compose starts with
# the public password; YAML stops the value at the comment.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: telerithm # ${POSTGRES_PASSWORD:?m}'
mutate "$work/tree/$FILE" "$URL_USE" 'postgresql://telerithm:ci-dummy@postgres'
expect_fail "literal with the interpolation in an inline comment" "has no interpolation of POSTGRES_PASSWORD at all"

# A literal on the environment line while the DATABASE_URL keeps the :? form.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: ci-dummy'
expect_fail "literal on the environment line only" "has no interpolation of POSTGRES_PASSWORD at all for services.postgres.environment.POSTGRES_PASSWORD"

# A different variable whose name merely contains POSTGRES_PASSWORD.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD_OLD:?x}'
expect_fail "wrong variable on the environment line" "must require POSTGRES_PASSWORD with the"

fresh_copy
mutate "$work/tree/$FILE" "$URL_USE" 'postgresql://telerithm:${POSTGRES_PASSWORD_OLD:?x}@postgres'
expect_fail "wrong variable in the DATABASE_URL" "must require POSTGRES_PASSWORD with the"

# The right interpolation inside a wrong one: an outer default wins, so compose
# starts with FALLBACK (or with nothing) and the inner :? is never evaluated.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: ${X:-${POSTGRES_PASSWORD:?m}}'
expect_fail "nested inside another interpolation, environment line" "must require POSTGRES_PASSWORD with the"

fresh_copy
mutate "$work/tree/$FILE" "$URL_USE" 'postgresql://telerithm:${X:-${POSTGRES_PASSWORD:?m}}@postgres'
expect_fail "nested inside another interpolation, DATABASE_URL" "must require POSTGRES_PASSWORD with the"

# The interpolation only in whole-line comments, the real use a literal: the
# file says nothing to compose.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" "# $ENV_USE
      POSTGRES_PASSWORD: ci-dummy"
mutate "$work/tree/$FILE" "$URL_USE" "# DATABASE_URL: $URL_USE
      DATABASE_URL: postgresql://telerithm:ci-dummy@postgres"
expect_fail "interpolation only in comments" "has no interpolation of POSTGRES_PASSWORD at all"

# The use dropped from the mapping entirely, a comment in its place and nothing
# else: the key is gone, so compose is told nothing about this use.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" "# $ENV_USE"
expect_fail "environment use commented out with nothing in its place" "has no interpolation of POSTGRES_PASSWORD at all for services.postgres.environment.POSTGRES_PASSWORD (found NoneType)"

# The variable gone from the file: the check would guard nothing.
fresh_copy
mutate "$work/tree/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: ci-dummy'
mutate "$work/tree/$FILE" "$URL_USE" 'postgresql://telerithm:ci-dummy@postgres'
expect_fail "variable absent from the file" "has no interpolation of POSTGRES_PASSWORD at all"

# --- the checker itself fails closed ----------------------------------------

# A file that is not YAML at all is reported, not skipped.
fresh_copy
mutate "$work/tree/$FILE" 'name: telerithm-standalone' 'name: [unclosed'
expect_fail "file that does not parse as YAML" "does not parse as YAML"

# A missing file is reported, not skipped.
fresh_copy
rm -f "$work/tree/$FILE"
expect_fail "file missing" "cannot read"

# The checker fails closed when python3 cannot import yaml: run the same check()
# above in a subshell with PYTHONPATH shadowing yaml by a module that raises
# ImportError, and require a non-zero exit with the exact message.
fakelib="$work/fakelib"
mkdir -p "$fakelib"
printf 'raise ImportError("no yaml here")\n' > "$fakelib/yaml.py"
if out="$(PYTHONPATH="$fakelib" check "$repo/$FILE" 2>&1)"; then
  bad "missing PyYAML: check passed but must fail"
elif grep -qF -- "PyYAML (python3 -c 'import yaml') is required" <<<"$out"; then
  ok "missing PyYAML fails the checker with the required message"
else
  bad "missing PyYAML fails the checker for another reason: $out"
fi

# --- behaviour against real compose -----------------------------------------

if docker compose version >/dev/null 2>&1; then
  # The exported value is a decoy: it is set on purpose here so that the unset
  # run of check_docker has to clear it, which is what makes that check test
  # something. Without the decoy a lost -u would go unnoticed on a host that
  # happens not to have the variable.
  export POSTGRES_PASSWORD="$SENTINEL"
  if out="$(check_docker "$repo" 2>&1)"; then
    ok "docker compose refuses an unset POSTGRES_PASSWORD and renders the sentinel in both uses"
  else
    bad "docker compose behaviour on the shipped file: $out"
  fi

  # The :? dropped: compose must refuse, so this copy must be caught.
  dir="$(compose_dir no-required)"
  mutate "$dir/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}'
  mutate "$dir/$FILE" "$URL_USE" 'postgresql://telerithm:${POSTGRES_PASSWORD}@postgres'
  expect_docker_fail "docker check catches a file compose accepts unset" "$dir" "with POSTGRES_PASSWORD unset (it must refuse)"

  # A .env next to the compose file must not be the source of the variable and its
  # value must not reach the output of this test: render passes --env-file
  # /dev/null, so compose never reads that file. Without that flag compose
  # auto-loads it, the unset run of check_docker is accepted instead of refused,
  # and a message that quoted the rendered config would print the value a real
  # .env holds. The messages of check_docker therefore quote compose's stderr only,
  # and the branch that reports the value prints no output of the check at all.
  dir="$(compose_dir dotenv)"
  printf 'POSTGRES_PASSWORD=%s\n' "$DOTENV_VALUE" > "$dir/.env"
  if out="$(check_docker "$dir" 2>&1)" && ! grep -qF -- "$DOTENV_VALUE" <<<"$out"; then
    ok ".env in the compose directory is not read: the unset refusal stands and the output holds no value from that file"
  elif grep -qF -- "$DOTENV_VALUE" <<<"$out"; then
    bad ".env in the compose directory: the docker check output holds the value from that file (it is not quoted here for that reason)"
  else
    bad ".env in the compose directory: docker check failed on that copy: $out"
  fi

  # A compose run that fails for another reason must not be mistaken for the
  # refusal this check expects: a broken file with no POSTGRES_PASSWORD in it.
  dir="$(compose_dir broken-schema)"
  mutate "$dir/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: ci-dummy'
  mutate "$dir/$FILE" "$URL_USE" 'postgresql://telerithm:ci-dummy@postgres'
  mutate "$dir/$FILE" 'name: telerithm-standalone' 'name: [unclosed'
  expect_docker_fail "docker check requires the refusal to name the variable" "$dir" "without naming POSTGRES_PASSWORD"

  # Each rendered use must carry the sentinel on its own: one of them written
  # into the file instead of interpolated must not pass for the other one.
  dir="$(compose_dir literal-env)"
  mutate "$dir/$FILE" "$ENV_USE" 'POSTGRES_PASSWORD: ci-dummy'
  expect_docker_fail "docker check catches a literal in the rendered postgres environment" "$dir" "does not render the sentinel for services.postgres.environment.POSTGRES_PASSWORD"

  dir="$(compose_dir literal-url)"
  mutate "$dir/$FILE" "$URL_USE" 'postgresql://telerithm:ci-dummy@postgres'
  expect_docker_fail "docker check catches a literal in the rendered DATABASE_URL" "$dir" "does not render the sentinel for services.backend.environment.DATABASE_URL"

  # The sentinel must be the password, not merely somewhere in the URL: here it
  # is the database name while the password is a literal.
  dir="$(compose_dir sentinel-elsewhere)"
  mutate "$dir/$FILE" "$URL_USE" "postgresql://telerithm:ci-dummy@postgres:5432/${SENTINEL}"
  expect_docker_fail "docker check requires the sentinel in the password position" "$dir" "does not render the sentinel for services.backend.environment.DATABASE_URL"

  # And it must be the only thing interpolated: a URL that also carries the
  # value of the test somewhere else is not the URL this check is about.
  dir="$(compose_dir sentinel-twice)"
  mutate "$dir/$FILE" "$URL_USE" "postgresql://telerithm:\${POSTGRES_PASSWORD:?m}@postgres:5432/${SENTINEL}"
  expect_docker_fail "docker check requires the sentinel to be the interpolated password only" "$dir" "does not render the sentinel for services.backend.environment.DATABASE_URL"

  # A third interpolation of POSTGRES_PASSWORD elsewhere in the file: both per-use
  # rules still hold on it, so only the count over the whole rendered document
  # sees it. The two forms that pass the per-use rules, a defaulted and a bare
  # one, on the backend. A third use written as a literal stays out of scope: the
  # count would catch the sentinel itself in a literal, but nothing in the
  # rendered document says where any other literal came from.
  dir="$(compose_dir third-defaulted)"
  mutate "$dir/$FILE" 'REDIS_URL: redis://redis:6379' "REDIS_URL: redis://redis:6379
      PGPASSWORD: \${POSTGRES_PASSWORD:-telerithm}"
  expect_docker_fail "docker check catches a defaulted third use of the variable" "$dir" "carries the sentinel 3 times in the whole document"

  dir="$(compose_dir third-bare)"
  mutate "$dir/$FILE" 'REDIS_URL: redis://redis:6379' "REDIS_URL: redis://redis:6379
      PGPASSWORD: \${POSTGRES_PASSWORD}"
  expect_docker_fail "docker check catches a bare third use of the variable" "$dir" "carries the sentinel 3 times in the whole document"

  # The use gone from the rendered document (a comment in its place): a value
  # that is not a string at all is not the sentinel either.
  dir="$(compose_dir no-url-use)"
  mutate "$dir/$FILE" "$URL_USE" "# DATABASE_URL: $URL_USE"
  expect_docker_fail "docker check catches a rendered document without the DATABASE_URL" "$dir" "does not render the sentinel for services.backend.environment.DATABASE_URL"

  # The rendered comparison fails closed without PyYAML too, so it cannot pass
  # by not looking at the document at all.
  if out="$(PYTHONPATH="$fakelib" check_docker "$repo" 2>&1)"; then
    bad "missing PyYAML in the rendered comparison: check passed but must fail"
  elif grep -qF -- "PyYAML (python3 -c 'import yaml') is required" <<<"$out"; then
    ok "missing PyYAML fails the rendered comparison with the required message"
  else
    bad "missing PyYAML in the rendered comparison for another reason: $out"
  fi
elif [ "$REQUIRE_DOCKER" = "1" ]; then
  bad "COMPOSE_REQUIRED_PASSWORD_REQUIRE_DOCKER=1 but docker compose is not available"
else
  echo "SKIP - docker compose not available: no behaviour assertion against real compose (the ClickHouse config CI job runs this file with COMPOSE_REQUIRED_PASSWORD_REQUIRE_DOCKER=1)"
fi

echo "passed: $PASS, failed: $FAIL"
[ "$FAIL" -eq 0 ]
