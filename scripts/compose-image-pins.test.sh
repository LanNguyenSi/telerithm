#!/usr/bin/env bash
# Guard for the base image pins in the compose files. clickhouse and redis are
# pinned to a minor (clickhouse/clickhouse-server:24.10, redis:7.4) so that
# `make deploy`, which builds with --pull, only moves patch releases; a bare
# major tag (":24", ":7") or a different pin in one file would move the
# datastore minor on a deploy, or leave the files disagreeing. The three
# compose files must name the same pinned tag for each image, and the tag must
# have the expected shape. Raising a pin is a deliberate change: edit PINS
# below together with the three compose files (DEPLOYMENT.md, "Base image
# versions").
#
# No Docker and no PyYAML needed: image lines are read as text. The controls at
# the end run the same check on mutated copies and must fail with the message
# of their own branch.
#
# Usage: bash scripts/compose-image-pins.test.sh
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILES="docker-compose.yml docker-compose.prod.yml docker-compose.traefik.yml"
# image name -> pinned tag
PINS="clickhouse/clickhouse-server=24.10 redis=7.4"

# check <dir>: prints one FAIL line per problem, returns 1 when any.
check() {
  local dir="$1" rc=0 pin image tag file lines
  for pin in $PINS; do
    image="${pin%%=*}"
    tag="${pin#*=}"
    for file in $FILES; do
      if [ ! -f "$dir/$file" ]; then
        echo "FAIL: $file is missing"
        rc=1
        continue
      fi
      lines="$(grep -E "^[[:space:]]*image:[[:space:]]*${image}(:|[[:space:]]|\$)" "$dir/$file" || true)"
      if [ -z "$lines" ]; then
        echo "FAIL: $file has no image line for $image (the check would be a no-op)"
        rc=1
        continue
      fi
      if [ "$(printf '%s\n' "$lines" | wc -l | tr -d ' ')" != 1 ]; then
        echo "FAIL: $file has more than one image line for $image"
        rc=1
        continue
      fi
      if ! printf '%s\n' "$lines" | grep -qE "^[[:space:]]*image:[[:space:]]*${image}:${tag}[[:space:]]*\$"; then
        echo "FAIL: $file must pin $image to ${tag}, found: $(printf '%s' "$lines" | sed 's/^[[:space:]]*//')"
        rc=1
      fi
    done
  done
  return $rc
}

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

work="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-image-pins-test.XXXXXX")" \
  || { echo "FATAL: mktemp failed" >&2; exit 2; }
if [ -z "$work" ] || [ ! -d "$work" ]; then
  echo "FATAL: mktemp did not create a directory: '$work'" >&2
  exit 2
fi
trap 'rm -rf "$work"' EXIT

fresh_copy() {
  rm -rf "$work/tree"
  mkdir -p "$work/tree"
  for f in $FILES; do cp "$repo/$f" "$work/tree/$f"; done
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
  ok "the shipped compose files pin clickhouse and redis to the same minor"
else
  bad "the shipped compose files: $out"
fi

fresh_copy
mutate docker-compose.traefik.yml "image: clickhouse/clickhouse-server:24.10" "image: clickhouse/clickhouse-server:24"
expect_fail "clickhouse on the bare major tag (traefik)" "docker-compose.traefik.yml must pin clickhouse/clickhouse-server to 24.10"

fresh_copy
mutate docker-compose.prod.yml "image: redis:7.4" "image: redis:7"
expect_fail "redis on the bare major tag (prod)" "docker-compose.prod.yml must pin redis to 7.4"

fresh_copy
mutate docker-compose.yml "image: clickhouse/clickhouse-server:24.10" "image: clickhouse/clickhouse-server:24.12"
expect_fail "dev compose on another minor" "docker-compose.yml must pin clickhouse/clickhouse-server to 24.10"

fresh_copy
mutate docker-compose.prod.yml "image: redis:7.4" "image: valkey:7.4"
expect_fail "image line gone (no-op guard)" "has no image line for redis"

echo "passed: $PASS, failed: $FAIL"
[ "$FAIL" -eq 0 ]
