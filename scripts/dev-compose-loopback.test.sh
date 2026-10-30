#!/usr/bin/env bash
# Regression check for the dev stack's published ports: every entry of every
# service's "ports:" list in docker-compose.yml must be bound to the loopback
# interface, that is start with "127.0.0.1:" (or, in the long syntax, set
# host_ip: 127.0.0.1). The dev stack runs with open signup and default or no
# datastore credentials, so a published port without a host IP ("4000:4000",
# "4000", or long syntax without host_ip) or with 0.0.0.0: is reachable, and
# on the open-signup stack registerable, from the whole local network.
#
# No Docker needed: the file is parsed with PyYAML, or with a plain-text
# parser when PyYAML is absent. Set DEV_COMPOSE_LOOPBACK_PARSER=plain to
# force the plain-text parser (this test drives both).
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

# check <file>: run the embedded checker, set OUT and RC. The status is
# captured inside the command (|| RC=$?) so the script also survives the
# `bash -e` a GitHub Actions `run:` step uses.
check() {
  RC=0
  OUT="$(python3 - "$1" <<'PY' 2>&1
import os
import re
import sys

path = sys.argv[1]
mode = os.environ.get("DEV_COMPOSE_LOOPBACK_PARSER", "")


def entries_yaml():
    import yaml

    with open(path) as fh:
        doc = yaml.safe_load(fh)
    for svc, cfg in (doc.get("services") or {}).items():
        for entry in ((cfg or {}).get("ports") or []):
            if isinstance(entry, dict):
                yield svc, entry
            else:
                yield svc, str(entry)


def entries_plain():
    # line based: two-space service names, four-space keys, "- " port items;
    # an item continues over more-indented lines (block long syntax)
    with open(path) as fh:
        lines = fh.read().splitlines()
    out = []
    in_services = False
    svc = None
    in_ports = False
    buf = None
    for line in lines:
        if re.match(r"^services:\s*$", line):
            in_services = True
            continue
        if not in_services:
            continue
        m = re.match(r"^  ([A-Za-z0-9_.-]+):\s*$", line)
        if m:
            if buf is not None:
                out.append((svc, buf.strip()))
                buf = None
            svc = m.group(1)
            in_ports = False
            continue
        if re.match(r"^[A-Za-z0-9_-]", line):  # top-level key ends services
            break
        if svc is None:
            continue
        if re.match(r"^    ports:\s*$", line):
            if buf is not None:
                out.append((svc, buf.strip()))
                buf = None
            in_ports = True
            continue
        if in_ports and re.match(r"^    [A-Za-z0-9_.-]+:", line):  # next key
            in_ports = False
        if in_ports:
            m = re.match(r"^      - (.*)$", line)
            if m:
                if buf is not None:
                    out.append((svc, buf.strip()))
                buf = m.group(1)
                continue
            if buf is not None and re.match(r"^        ", line):
                buf += " " + line.strip()
                continue
    if buf is not None:
        out.append((svc, buf.strip()))
    return out


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
    m = re.search(r"published:\s*([^,\s}]+)", text)
    if m:
        # plain parser flow/block long syntax
        host = re.search(r"host_ip:\s*([^,\s}]+)", text)
        rendered = "published: %s" % m.group(1)
        if host is None:
            return rendered + " (long syntax without host_ip)", False
        return rendered + " host_ip: %s" % host.group(1), host.group(1) == "127.0.0.1"
    return text, text.startswith("127.0.0.1:")


if mode != "plain":
    try:
        pairs = list(entries_yaml())
    except ImportError:
        pairs = list(entries_plain())
else:
    pairs = list(entries_plain())

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

# --- positive control: the shipped dev compose passes (both parsers) --------
for parser_mode in yaml plain; do
  export DEV_COMPOSE_LOOPBACK_PARSER="${parser_mode}"
  check "${COMPOSE_FILE}"
  if [ "${RC}" -eq 0 ] && grep -q "all published ports" <<< "${OUT}"; then
    ok "shipped docker-compose.yml passes the loopback check (${parser_mode} parser)"
  else bad "shipped docker-compose.yml (${parser_mode} parser): rc=${RC} out=${OUT}"; fi
done

# --- negative controls on mutated temp copies -------------------------------
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-loopback-test.XXXXXX")"
SCRATCH="$(cd "${SCRATCH}" && pwd -P)"
trap 'rm -rf "${SCRATCH}"' EXIT

expect_fail() {
  # $1: file, $2: expectation name, $3: substring the message must contain
  local parser_mode
  for parser_mode in yaml plain; do
    export DEV_COMPOSE_LOOPBACK_PARSER="${parser_mode}"
    check "$1"
    if [ "${RC}" -ne 0 ] && grep -qF "$3" <<< "${OUT}"; then
      ok "$2 (${parser_mode} parser)"
    else bad "$2 (${parser_mode} parser): rc=${RC} out=${OUT}"; fi
  done
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
for parser_mode in yaml plain; do
  export DEV_COMPOSE_LOOPBACK_PARSER="${parser_mode}"
  check "${SCRATCH}/long-good-host-ip.yml"
  if [ "${RC}" -eq 0 ]; then
    ok "long syntax with host_ip 127.0.0.1 passes (${parser_mode} parser)"
  else bad "long syntax with host_ip 127.0.0.1 (${parser_mode} parser): rc=${RC} out=${OUT}"; fi
done

echo
echo "passed: ${PASS}, failed: ${FAIL}"
[ "${FAIL}" -eq 0 ]
