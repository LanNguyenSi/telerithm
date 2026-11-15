#!/usr/bin/env bash
# Guard for the Tests section of scripts/README.md: its entries must be exactly
# the scripts/*.test.sh files that exist, in both directions. The README states
# "The entries below match `ls scripts/*.test.sh`": a test script without an
# entry is a CI check a contributor will not find or run, and an entry without
# a script is a command that fails at once. An entry is a line of the Tests
# section (from the `## Tests` heading to the next level-2 heading) that starts
# a bullet with the backticked path, "- `scripts/<name>.test.sh`", the style
# every entry uses; a mention elsewhere in the file, or a bullet in another
# section, is not an entry.
#
# The shipped files are read from the repository. The controls run the same
# check on a copy of the test scripts and the README in a scratch directory:
# deleting one entry and adding one entry for a script that does not exist must
# each make the check fail naming the script, and a bullet added outside the
# Tests section must not be counted (a check that scanned the whole file would
# fail that control). Each edit of the copy is exact-once: an anchor that does
# not match exactly once is a hard error, not a silent pass.
# Needs only bash and python3. CI runs this in the "Shell script tests" job.
#
# Usage: bash scripts/scripts-readme-inventory.test.sh
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# check <dir>: compare the scripts/*.test.sh files under <dir>/scripts with the
# Tests-section entries of <dir>/scripts/README.md. Prints one FAIL line per
# difference (a file without an entry, an entry without a file) and returns 1
# when there is any.
check() {
  python3 - "$1" <<'PY'
import os
import re
import sys

root = sys.argv[1]
scripts_dir = os.path.join(root, "scripts")
readme = os.path.join(scripts_dir, "README.md")

if not os.path.isdir(scripts_dir):
    print("FAIL: the scripts directory is missing (the check would be a no-op)")
    sys.exit(1)
found = {name for name in os.listdir(scripts_dir) if name.endswith(".test.sh")}
if not found:
    print("FAIL: no scripts/*.test.sh found (the check would be a no-op)")
    sys.exit(1)
if not os.path.isfile(readme):
    print("FAIL: scripts/README.md is missing")
    sys.exit(1)

heading = re.compile(r"^##(?!#)")
bullet = re.compile(r"^- `scripts/([^\s`]+\.test\.sh)`")
in_tests = False
listed = set()
with open(readme) as handle:
    for line in handle:
        if heading.match(line):
            in_tests = line.strip() == "## Tests"
            continue
        if in_tests:
            match = bullet.match(line)
            if match:
                listed.add(match.group(1))

rc = 0
for name in sorted(found - listed):
    print(f"FAIL: scripts/{name} has no entry in the Tests section of scripts/README.md")
    rc = 1
for name in sorted(listed - found):
    print(f"FAIL: scripts/README.md has an entry for scripts/{name}, but that file does not exist")
    rc = 1
sys.exit(rc)
PY
}

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

work="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-readme-inventory-test.XXXXXX")" \
  || { echo "FATAL: mktemp failed" >&2; exit 2; }
if [ -z "$work" ] || [ ! -d "$work" ]; then
  echo "FATAL: mktemp did not create a directory: '$work'" >&2
  exit 2
fi
trap 'rm -rf "$work"' EXIT

fresh_copy() {
  rm -rf "$work/tree"
  mkdir -p "$work/tree/scripts"
  cp "$repo"/scripts/*.test.sh "$work/tree/scripts/"
  cp "$repo/scripts/README.md" "$work/tree/scripts/README.md"
}

# drop_entry <name.test.sh>: delete the Tests-section bullet of that script
# from the copied README (exact-once, else non-zero).
drop_entry() {
  python3 - "$work/tree/scripts/README.md" "$1" <<'PY'
import re
import sys

path, name = sys.argv[1], sys.argv[2]
text = open(path).read()
new_text, n = re.subn(r"^- `scripts/" + re.escape(name) + r"`.*\n", "", text, flags=re.M)
if n != 1:
    sys.exit(f"entry for {name} found {n} times in {path}, expected once")
open(path, "w").write(new_text)
PY
}

# add_entry <name.test.sh> <anchor>: insert a bullet for <name> directly before
# the unique line starting with <anchor> (exact-once, else non-zero).
add_entry() {
  python3 - "$work/tree/scripts/README.md" "$1" "$2" <<'PY'
import sys

path, name, anchor = sys.argv[1:4]
text = open(path).read()
if text.count(anchor) != 1:
    sys.exit(f"anchor {anchor!r} found {text.count(anchor)} times in {path}, expected once")
entry = f"- `scripts/{name}`: a control entry naming a script that does not exist. `bash scripts/{name}`\n"
open(path, "w").write(text.replace(anchor, entry + anchor))
PY
}

# expect_fail <label> <fragment>: the check must fail on the copy and fail with
# <fragment> naming the cause (a bare non-zero exit is not enough).
expect_fail() {
  local name="$1" fragment="$2" out
  if out="$(check "$work/tree" 2>&1)"; then
    bad "$name: check passed but must fail"
  elif grep -qF -- "$fragment" <<<"$out"; then
    ok "$name"
  else
    bad "$name: failed for another reason (wanted: $fragment): $out"
  fi
}

if out="$(check "$repo" 2>&1)"; then
  ok "the Tests section of scripts/README.md lists exactly the scripts/*.test.sh files"
else
  bad "the shipped README and the test scripts disagree: $out"
fi

fresh_copy
if drop_entry relay-config.test.sh; then
  expect_fail "control: an entry deleted from the README is caught naming the script" \
    "scripts/relay-config.test.sh has no entry in the Tests section"
else
  bad "control: could not delete an entry from the copied README"
fi

fresh_copy
if add_entry bogus-control.test.sh '- `scripts/test-scratch-safety.test.sh`: the guard'; then
  expect_fail "control: an entry for a script that does not exist is caught naming the entry" \
    "scripts/README.md has an entry for scripts/bogus-control.test.sh, but that file does not exist"
else
  bad "control: could not add an entry to the copied README"
fi

fresh_copy
if add_entry bogus-control.test.sh '## Configuration Options'; then
  if out="$(check "$work/tree" 2>&1)"; then
    ok "control: a bullet outside the Tests section is not counted as an entry"
  else
    bad "control outside-tests: check failed but must pass: $out"
  fi
else
  bad "control: could not add a bullet outside the Tests section to the copied README"
fi

echo "passed: $PASS, failed: $FAIL"
[ "$FAIL" -eq 0 ]
