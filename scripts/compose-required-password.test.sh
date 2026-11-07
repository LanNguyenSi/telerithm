#!/usr/bin/env bash
# Guard for the POSTGRES_PASSWORD interpolation in docker-compose.prod.yml.
# The file used to interpolate it as ${POSTGRES_PASSWORD:-telerithm}, so a host
# that forgot the variable in .env.production started Postgres with a password
# that is public with the repository, and the backend connected with it
# silently. docker-compose.traefik.yml (the deployed variant) never had the
# default; the non-Traefik variant now requires the variable too, with the
# :? form, so compose refuses to start instead of substituting anything. Every
# interpolation of POSTGRES_PASSWORD in the file must use :?: a :- or -
# default is the fallback back, and a bare ${POSTGRES_PASSWORD} substitutes an
# empty password. A file with no interpolation of the variable at all is a
# failure too: the check would be a no-op on the file it exists to guard.
#
# No Docker and no PyYAML needed: the interpolation is read as text off the
# value lines (whole-line comments are skipped, so the header note of the
# compose file is not a use). The controls at the end run the same check on
# mutated copies and must fail with the message of their own branch.
#
# Usage: bash scripts/compose-required-password.test.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="docker-compose.prod.yml"

# check <dir>: prints one FAIL line per problem, returns 1 when any.
check() {
  python3 - "$1/$FILE" <<'PY'
import re
import sys

path = sys.argv[1]
try:
    lines = open(path).read().splitlines()
except OSError as exc:
    print(f"FAIL: cannot read {path}: {exc}")
    sys.exit(1)

uses = []
for no, line in enumerate(lines, 1):
    if line.lstrip().startswith("#"):
        continue
    for token in re.findall(r"\$\{[^{}]*\}", line):
        if "POSTGRES_PASSWORD" in token:
            uses.append((no, token))

if not uses:
    print(f"FAIL: {path} has no interpolation of POSTGRES_PASSWORD at all (the check would be a no-op)")
    sys.exit(1)

fails = 0
for no, token in uses:
    if ":-" in token or re.search(r"\$\{POSTGRES_PASSWORD-", token):
        print(f"FAIL: line {no} lets POSTGRES_PASSWORD fall back to a default: {token}")
        fails += 1
    elif ":?" not in token:
        print(f"FAIL: line {no} must require POSTGRES_PASSWORD with the :? form so compose refuses to start, found: {token}")
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

# mutate <file> <old> <new>: exact single replacement, fails when <old> is
# absent so a control cannot turn into a no-op.
mutate() {
  python3 - "$work/tree/$1" "$2" "$3" <<'PY'
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
  if out="$(check "$work/tree" 2>&1)"; then
    bad "$name: check passed but must fail"
    return
  fi
  if grep -qF -- "$fragment" <<<"$out"; then ok "$name"; else bad "$name: failed for another reason (wanted: $fragment): $out"; fi
}

if out="$(check "$repo" 2>&1)"; then
  ok "the shipped compose file requires POSTGRES_PASSWORD with :? in both places"
else
  bad "the shipped compose file: $out"
fi

# The default back on the postgres service environment.
fresh_copy
mutate "$FILE" "POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env.production}" "POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-telerithm}"
expect_fail "default back on the postgres environment" "lets POSTGRES_PASSWORD fall back to a default"

# The default back on the backend DATABASE_URL.
fresh_copy
mutate "$FILE" "postgresql://telerithm:\${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env.production}@postgres" "postgresql://telerithm:\${POSTGRES_PASSWORD:-telerithm}@postgres"
expect_fail "default back on the backend DATABASE_URL" "lets POSTGRES_PASSWORD fall back to a default"

# The :? dropped: compose substitutes an empty password and still starts.
fresh_copy
mutate "$FILE" "POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env.production}" "POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}"
expect_fail "bare interpolation without :?" "must require POSTGRES_PASSWORD with the"

# The variable gone from the file: the check would guard nothing.
fresh_copy
mutate "$FILE" "POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env.production}" "POSTGRES_PASSWORD: ci-dummy"
mutate "$FILE" "postgresql://telerithm:\${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env.production}@postgres" "postgresql://telerithm:ci-dummy@postgres"
expect_fail "variable absent from the file" "has no interpolation of POSTGRES_PASSWORD at all"

echo "passed: $PASS, failed: $FAIL"
[ "$FAIL" -eq 0 ]
