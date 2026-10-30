#!/usr/bin/env bash
# Regression check for the dev stack's published ports: every entry of every
# service's "ports:" list in docker-compose.yml must be bound to the loopback
# interface, that is start with "127.0.0.1:" (or, in the long syntax, set
# host_ip: 127.0.0.1). The dev stack runs with open signup and default or no
# datastore credentials, so a published port without a host IP ("4000:4000",
# "4000", or long syntax without host_ip) or with 0.0.0.0: is reachable, and
# on the open-signup stack registerable, from the whole local network.
#
# No Docker needed: the file is parsed with PyYAML, which is required; the
# check fails (exit non-zero) when python3 cannot import yaml, because a
# plain-text parser would miss flow sequences and anchors and could pass a
# non-loopback port.
#
# Usage: bash scripts/dev-compose-loopback.test.sh [path to docker-compose.yml]
# With no argument the repository's docker-compose.yml is checked; the named
# file is the subject of the positive control and of every mutated copy.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${1:-${SCRIPT_DIR}/../docker-compose.yml}"

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "FAIL - ${COMPOSE_FILE} not found"
  exit 1
fi
# Absolute, so control k can hand it to a child started in another directory.
COMPOSE_FILE="$(CDPATH='' cd -- "$(dirname -- "${COMPOSE_FILE}")" && pwd)/$(basename -- "${COMPOSE_FILE}")"

# check <file>: run the embedded checker, set OUT and RC. The status is
# captured inside the command (|| RC=$?) so the script also survives the
# `bash -e` a GitHub Actions `run:` step uses.
check() {
  RC=0
  OUT="$(python3 - "$1" <<'PY' 2>&1
import re
import sys

path = sys.argv[1]

try:
    import yaml
except ImportError:
    print("FAIL: PyYAML (python3 -c 'import yaml') is required")
    sys.exit(1)

with open(path) as fh:
    doc = yaml.safe_load(fh)

pairs = []
for svc, cfg in (doc.get("services") or {}).items():
    for entry in ((cfg or {}).get("ports") or []):
        if isinstance(entry, dict):
            pairs.append((svc, entry))
        else:
            pairs.append((svc, str(entry)))


def classify(entry):
    # -> (rendered_entry, ok)
    if isinstance(entry, dict):
        published = entry.get("published")
        host_ip = entry.get("host_ip")
        rendered = "published: %s" % published
        if host_ip is None:
            return rendered + " (long syntax without host_ip)", False
        rendered += " host_ip: %s" % host_ip
        return rendered, str(host_ip) == "127.0.0.1"
    text = str(entry).strip().strip('"').strip("'")
    return text, text.startswith("127.0.0.1:")


bad = 0
if not pairs:
    print("FAIL: no ports: entries parsed from %s (the check would be a "
          "no-op)" % path)
    bad = 1
for svc, entry in pairs:
    rendered, ok = classify(entry)
    if not ok:
        print('FAIL: service "%s" published port entry "%s" is not bound to '
              "the loopback interface (127.0.0.1)" % (svc, rendered))
        bad += 1

if bad:
    sys.exit(1)
print("ok: all published ports in %s are bound to 127.0.0.1" % path)
PY
)" || RC=$?
}

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

# --- positive control: the shipped dev compose passes ------------------------
check "${COMPOSE_FILE}"
if [ "${RC}" -eq 0 ] && grep -q "all published ports" <<< "${OUT}"; then
  ok "shipped docker-compose.yml passes the loopback check"
else bad "shipped docker-compose.yml: rc=${RC} out=${OUT}"; fi

# --- negative controls on mutated temp copies -------------------------------
# SCRATCH is never reassigned after this: the EXIT trap below removes exactly
# the directory mktemp created, and a failed mktemp exits here before the trap
# is armed (a failed mktemp must not fall back to the caller's directory).
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-loopback-test.XXXXXX")" || { echo "FAIL - mktemp failed"; exit 1; }
[ -n "${SCRATCH}" ] && [ -d "${SCRATCH}" ] || { echo "FAIL - no scratch dir"; exit 1; }
trap 'rm -rf "${SCRATCH}"' EXIT

expect_fail() {
  # $1: file, $2: expectation name, $3: substring the message must contain
  check "$1"
  if [ "${RC}" -ne 0 ] && grep -qF "$3" <<< "${OUT}"; then
    ok "$2"
  else bad "$2: rc=${RC} out=${OUT}"; fi
}

mutate() {
  # $1: sed program, $2: name of the mutated copy
  sed "$1" "${COMPOSE_FILE}" > "${SCRATCH}/$2" || return 1
}

# a. a backend entry without a host IP
mutate 's|"127.0.0.1:4000:4000"|"4000:4000"|' no-host-ip.yml
expect_fail "${SCRATCH}/no-host-ip.yml" "entry without host IP is rejected" 'service "backend"'
expect_fail "${SCRATCH}/no-host-ip.yml" "entry without host IP names the entry" "4000:4000"

# b. an explicit all-interfaces bind
mutate 's|"127.0.0.1:3000:3000"|"0.0.0.0:3000:3000"|' all-interfaces.yml
expect_fail "${SCRATCH}/all-interfaces.yml" "0.0.0.0: entry is rejected" 'service "frontend"'
expect_fail "${SCRATCH}/all-interfaces.yml" "0.0.0.0: entry names the entry" "0.0.0.0:3000:3000"

# c. the container-port-only short form
mutate 's|"127.0.0.1:5432:5432"|5432|' short-form.yml
expect_fail "${SCRATCH}/short-form.yml" "short-form entry is rejected" 'service "postgres"'
expect_fail "${SCRATCH}/short-form.yml" "short-form entry names the entry" "5432"

# d. long syntax without host_ip
mutate 's|"127.0.0.1:6379:6379"|{ target: 6379, published: 6379, protocol: tcp }|' long-no-host-ip.yml
expect_fail "${SCRATCH}/long-no-host-ip.yml" "long syntax without host_ip is rejected" 'service "redis"'
expect_fail "${SCRATCH}/long-no-host-ip.yml" "long syntax names the entry" "published: 6379"

# e. long syntax with a non-loopback host_ip
mutate 's|"127.0.0.1:6379:6379"|{ target: 6379, published: 6379, host_ip: 0.0.0.0 }|' long-bad-host-ip.yml
expect_fail "${SCRATCH}/long-bad-host-ip.yml" "long syntax with host_ip 0.0.0.0 is rejected" 'service "redis"'

# f. long syntax WITH host_ip: 127.0.0.1 passes
mutate 's|"127.0.0.1:6379:6379"|{ target: 6379, published: 6379, host_ip: 127.0.0.1 }|' long-good-host-ip.yml
check "${SCRATCH}/long-good-host-ip.yml"
if [ "${RC}" -eq 0 ]; then
  ok "long syntax with host_ip 127.0.0.1 passes"
else bad "long syntax with host_ip 127.0.0.1: rc=${RC} out=${OUT}"; fi

# g. a flow-sequence ports list with a non-loopback entry is rejected (the
#    yaml parser sees it; a line based parser would miss the items)
cat > "${SCRATCH}/flow-seq.yml" <<'YML'
services:
  frontend:
    ports: ["0.0.0.0:3000:3000"]
YML
expect_fail "${SCRATCH}/flow-seq.yml" "flow-sequence ports list is rejected" 'service "frontend"'
expect_fail "${SCRATCH}/flow-seq.yml" "flow-sequence ports list names the entry" "0.0.0.0:3000:3000"

# h. an anchored ports list with a non-loopback entry is rejected (the yaml
#    parser resolves the alias; a line based parser sees only "*p")
cat > "${SCRATCH}/anchored.yml" <<'YML'
x-ports: &p
  - "0.0.0.0:3000:3000"
services:
  frontend:
    ports: *p
YML
expect_fail "${SCRATCH}/anchored.yml" "anchored ports list is rejected" 'service "frontend"'
expect_fail "${SCRATCH}/anchored.yml" "anchored ports list names the entry" "0.0.0.0:3000:3000"

# i. a copy with every ports: block removed must not pass silently
sed -e '/^    ports:$/d' -e '/^      - "127\.0\.0\.1:/d' "${COMPOSE_FILE}" > "${SCRATCH}/no-ports.yml"
expect_fail "${SCRATCH}/no-ports.yml" "copy without any ports: block is rejected" "no ports: entries parsed"

# j. the checker fails closed when python3 cannot import yaml: run the
#    checker (the same check() above, same embedded python) in a subshell
#    with PYTHONPATH shadowing yaml by a module that raises ImportError, and
#    require a non-zero exit with the exact message
FAKELIB="${SCRATCH}/fakelib"
mkdir -p "${FAKELIB}"
printf 'raise ImportError("no yaml here")\n' > "${FAKELIB}/yaml.py"
JOUT="$(
  export PYTHONPATH="${FAKELIB}"
  check "${COMPOSE_FILE}"
  echo "checker_rc=${RC}"
  printf '%s\n' "${OUT}"
)"
if grep -qF "checker_rc=1" <<< "${JOUT}" \
  && grep -qF "FAIL: PyYAML (python3 -c 'import yaml') is required" <<< "${JOUT}"; then
  ok "missing PyYAML fails the checker with the required message"
else bad "missing PyYAML fails the checker: ${JOUT}"; fi

# k. an unusable TMPDIR must not take the current directory with it: run the
#    script itself (a child bash) from a sacrificial directory holding a
#    canary file, with TMPDIR pointing at a path that does not exist, and
#    require a non-zero exit naming the mktemp failure with the sacrificial
#    directory and its canary still there afterwards
SACRIFICE="${SCRATCH}/sacrifice"
mkdir -p "${SACRIFICE}"
touch "${SACRIFICE}/canary.txt"
# The child runs under the same bash as this script, skips this control
# (DEV_COMPOSE_LOOPBACK_CHILD) so a regression cannot recurse, and is bounded
# by a 30 s limit, after which it is killed and the control fails.
if [ "${DEV_COMPOSE_LOOPBACK_CHILD:-}" != "1" ]; then
  RC=0
  ( cd "${SACRIFICE}" && TMPDIR="${SCRATCH}/no-such-tmpdir" DEV_COMPOSE_LOOPBACK_CHILD=1 \
    "${BASH}" "${SCRIPT_DIR}/dev-compose-loopback.test.sh" "${COMPOSE_FILE}" ) > "${SCRATCH}/child.out" 2>&1 &
  CHILD=$!
  WAITED=0
  while kill -0 "${CHILD}" 2>/dev/null && [ "${WAITED}" -lt 30 ]; do sleep 1; WAITED=$((WAITED + 1)); done
  TIMED_OUT=0
  if kill -0 "${CHILD}" 2>/dev/null; then kill -KILL "${CHILD}" 2>/dev/null; TIMED_OUT=1; fi
  wait "${CHILD}" || RC=$?
  OUT="$(cat "${SCRATCH}/child.out")"
  if [ "${TIMED_OUT}" -eq 0 ] && [ "${RC}" -ne 0 ] && grep -qF "FAIL - mktemp failed" <<< "${OUT}" \
    && [ -d "${SACRIFICE}" ] && [ -f "${SACRIFICE}/canary.txt" ]; then
    ok "unusable TMPDIR exits non-zero and leaves the caller's directory intact"
  else bad "unusable TMPDIR: rc=${RC} timed_out=${TIMED_OUT} out=${OUT} sacrifice dir exists=$([ -d "${SACRIFICE}" ] && echo yes || echo no) canary exists=$([ -f "${SACRIFICE}/canary.txt" ] && echo yes || echo no)"; fi
fi

echo
echo "passed: ${PASS}, failed: ${FAIL}"
[ "${FAIL}" -eq 0 ]
