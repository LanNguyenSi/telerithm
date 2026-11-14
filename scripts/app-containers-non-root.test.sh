#!/usr/bin/env bash
# Guard for the app containers running unprivileged. The runtime stages of
# backend/Dockerfile and frontend/Dockerfile used to have no USER directive, so
# both Node processes ran as root with the full capability set, the backend
# included, which Traefik exposes to the internet. Both stages now end with
# USER node (uid 1000, the user the node:22-alpine image ships), and the
# backend and frontend services of the three compose files carry
# security_opt: ["no-new-privileges:true"] and cap_drop: [ALL], so nothing they
# exec can raise privileges again and no capability is left to try. Ports 3000
# and 4000 are above 1024, so binding needs no capability, and nothing the two
# processes write at runtime needs root: the backend writes nothing under /app
# (migrate.sh runs node_modules/.bin/prisma, never npx, and the Prisma engines
# are read-only after `prisma generate` at build), and the frontend writes only
# under .next, which the image copies with --chown=node:node.
#
# Both halves are structural: the last USER of each runtime stage must name a
# non-root account, and every app service of every compose file must carry both
# hardening keys. It checks the files, not a running container (a real check
# that the process is uid 1000 needs the built image, so it stays a manual step
# in DEPLOYMENT.md). The compose half is parsed with PyYAML, which is required:
# the check fails closed without it, like the other compose checks in this job
# (a plain-text scan would miss flow sequences and the *default-logging anchor).
#
# The controls at the end run the same check on mutated copies (a runtime stage
# without USER, a USER root, a service without cap_drop or without
# no-new-privileges) and must fail with the message of their own branch.
#
# Usage: bash scripts/app-containers-non-root.test.sh
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILES="backend/Dockerfile frontend/Dockerfile"
COMPOSE_FILES="docker-compose.yml docker-compose.prod.yml docker-compose.traefik.yml"
APP_SERVICES="backend frontend"

# check <dir>: run the embedded checker over that tree, print one FAIL line per
# problem (and one ok line when there is none), return 1 when any.
check() {
  python3 - "$1" "$DOCKERFILES" "$COMPOSE_FILES" "$APP_SERVICES" <<'PY'
import os
import re
import sys

root, dockerfiles, compose_files, app_services = sys.argv[1:5]
dockerfiles = dockerfiles.split()
compose_files = compose_files.split()
app_services = app_services.split()
STAGE = "runtime"
# A USER value is either an account name or a numeric uid (optionally name:group).
# Anything else, a ${VAR} in particular, names nothing this check can judge.
ACCOUNT = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*$|^[0-9]+$")

fails = 0


def fail(message):
    global fails
    print("FAIL: " + message)
    fails += 1


def logical_lines(text):
    # Instructions with a trailing backslash joined, blank lines and whole-line
    # comments dropped: a commented-out USER is no USER.
    out = []
    pending = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.endswith("\\"):
            pending += line[:-1].strip() + " "
            continue
        out.append((pending + line).strip())
        pending = ""
    if pending:
        out.append(pending.strip())
    return out


def stages(text):
    # -> [(stage name or None, [instruction, ...])], a stage ending at the next FROM.
    found = []
    current = None
    for line in logical_lines(text):
        parts = line.split()
        if not parts:
            continue
        if parts[0].lower() == "from":
            # FROM [--platform=...] <image> [AS <name>]
            rest = [p for p in parts[1:] if not p.startswith("--")]
            name = rest[2] if len(rest) >= 3 and rest[1].lower() == "as" else None
            current = (name, [])
            found.append(current)
        elif current is not None:
            current[1].append(line)
    return found


def check_dockerfile(rel):
    path = os.path.join(root, rel)
    try:
        text = open(path).read()
    except OSError as exc:
        fail("%s cannot be read: %s" % (rel, exc))
        return
    runtimes = [s for s in stages(text) if s[0] == STAGE]
    if not runtimes:
        fail("%s has no stage named %s, so nothing here ends in a non-root USER "
             "(the check would be a no-op on it)" % (rel, STAGE))
        return
    for _, instructions in runtimes:
        users = [i for i in instructions if i.split()[0].lower() == "user"]
        if not users:
            fail("%s: the %s stage has no USER directive, so the container runs "
                 "as root (uid 0)" % (rel, STAGE))
            continue
        value = users[-1].split(None, 1)[1].strip() if len(users[-1].split()) > 1 else ""
        account = value.split(":")[0].strip()
        if not ACCOUNT.match(account):
            fail("%s: the last USER of the %s stage does not name an account this "
                 "check can judge (want a literal name or uid, not root): USER %s"
                 % (rel, STAGE, value))
        elif account == "0" or account.lower() == "root":
            fail("%s: the last USER of the %s stage is root (uid 0): USER %s"
                 % (rel, STAGE, value))


def as_list(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return [str(value)]


def check_compose(rel):
    path = os.path.join(root, rel)
    try:
        text = open(path).read()
    except OSError as exc:
        fail("%s cannot be read: %s" % (rel, exc))
        return
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        fail("%s does not parse as YAML: %s" % (rel, exc))
        return
    services = (doc or {}).get("services") or {}
    for svc in app_services:
        cfg = services.get(svc)
        if not isinstance(cfg, dict):
            fail("%s has no %s service, so no hardening key can be required of it "
                 "(the check would be a no-op on it)" % (rel, svc))
            continue
        if "ALL" not in [v.strip().upper() for v in as_list(cfg.get("cap_drop"))]:
            fail("%s: service %s must cap_drop ALL, or the container keeps the "
                 "capabilities it is started with: cap_drop: %r"
                 % (rel, svc, cfg.get("cap_drop")))
        if "no-new-privileges:true" not in [v.strip().lower() for v in as_list(cfg.get("security_opt"))]:
            fail("%s: service %s must set security_opt no-new-privileges:true, or "
                 "a setuid binary it execs can raise privileges: security_opt: %r"
                 % (rel, svc, cfg.get("security_opt")))


try:
    import yaml
except ImportError:
    print("FAIL: PyYAML (python3 -c 'import yaml') is required")
    sys.exit(1)

for rel in dockerfiles:
    check_dockerfile(rel)
for rel in compose_files:
    check_compose(rel)

if fails:
    sys.exit(1)
print("ok: every runtime stage ends with a non-root USER, and every app service "
      "of %s drops ALL capabilities with no-new-privileges:true"
      % ", ".join(compose_files))
PY
}

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

if out="$(check "$repo" 2>&1)"; then
  ok "the shipped Dockerfiles and compose files run the app containers unprivileged"
else
  bad "the shipped files: $out"
fi

# SCRATCH is never reassigned after this: the EXIT trap removes exactly the
# directory mktemp created, and a failed mktemp exits before the trap is armed.
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-app-non-root-test.XXXXXX")" \
  || { echo "FATAL: mktemp failed" >&2; exit 2; }
if [ -z "${SCRATCH}" ] || [ ! -d "${SCRATCH}" ]; then
  echo "FATAL: mktemp did not create a directory: '${SCRATCH}'" >&2
  exit 2
fi
trap 'rm -rf "${SCRATCH}"' EXIT

fresh_copy() {
  rm -rf "${SCRATCH}/tree"
  mkdir -p "${SCRATCH}/tree/backend" "${SCRATCH}/tree/frontend"
  for f in ${DOCKERFILES} ${COMPOSE_FILES}; do cp "${repo}/${f}" "${SCRATCH}/tree/${f}"; done
}

# mutate <file> <old> <new>: exact single replacement, fails when <old> is
# absent or not unique so a control cannot turn into a no-op or a guess.
mutate() {
  python3 - "${SCRATCH}/tree/$1" "$2" "$3" <<'PY'
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
  if out="$(check "${SCRATCH}/tree" 2>&1)"; then
    bad "$name: check passed but must fail"
    return
  fi
  if grep -qF -- "$fragment" <<<"$out"; then ok "$name"; else bad "$name: failed for another reason (wanted: $fragment): $out"; fi
}

# a. a runtime stage with its USER commented out: the container runs as root
fresh_copy
mutate backend/Dockerfile "USER node" "# USER node"
expect_fail "backend runtime stage without a USER is rejected" \
  "backend/Dockerfile: the runtime stage has no USER directive"

# b. the same stage with an explicit root user
fresh_copy
mutate backend/Dockerfile "USER node" "USER root"
expect_fail "backend runtime stage with USER root is rejected" \
  "backend/Dockerfile: the last USER of the runtime stage is root (uid 0)"

# c. the frontend is really checked too, not only the backend
fresh_copy
mutate frontend/Dockerfile "USER node" "# USER node"
expect_fail "frontend runtime stage without a USER is rejected" \
  "frontend/Dockerfile: the runtime stage has no USER directive"

# d. uid 0 written as a number is root as well
fresh_copy
mutate frontend/Dockerfile "USER node" "USER 0:0"
expect_fail "frontend runtime stage with USER 0:0 is rejected" \
  "frontend/Dockerfile: the last USER of the runtime stage is root (uid 0)"

# e. a USER anywhere in the file is not enough: a stage is checked on its own, so
#    a runtime stage that comes after the one carrying USER node must fail even
#    though the file still says USER node
fresh_copy
mutate backend/Dockerfile 'CMD ["sh", "entrypoint.sh"]' \
  $'CMD ["sh", "entrypoint.sh"]\n\nFROM node:22-alpine AS runtime\nEXPOSE 4000'
expect_fail "a later runtime stage without a USER is rejected" \
  "backend/Dockerfile: the runtime stage has no USER directive"

# f. a file with no stage named runtime cannot be checked at all
fresh_copy
mutate frontend/Dockerfile "FROM node:22-alpine AS runtime" "FROM node:22-alpine AS serve"
expect_fail "a Dockerfile with no runtime stage is rejected" \
  "frontend/Dockerfile has no stage named runtime"

# g. a prod service without cap_drop keeps its capabilities
fresh_copy
mutate docker-compose.prod.yml \
  '    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *default-logging
    environment:
      HOST: 0.0.0.0' \
  '    security_opt: ["no-new-privileges:true"]
    logging: *default-logging
    environment:
      HOST: 0.0.0.0'
expect_fail "prod backend without cap_drop is rejected" \
  "docker-compose.prod.yml: service backend must cap_drop ALL"

# h. a prod service without no-new-privileges can raise privileges again
fresh_copy
mutate docker-compose.traefik.yml \
  '    # Same two keys as the backend service above (see the comment there).
    security_opt: ["no-new-privileges:true"]' \
  '    # Same two keys as the backend service above (see the comment there).'
expect_fail "traefik frontend without no-new-privileges is rejected" \
  "docker-compose.traefik.yml: service frontend must set security_opt no-new-privileges:true"

# i. a drop list that no longer drops everything is not the hardening: dropping
#    two of the thirty-eight capabilities leaves the other thirty-six
fresh_copy
mutate docker-compose.yml \
  '    # Same two keys as the backend service above (see the comment there).
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]' \
  '    # Same two keys as the backend service above (see the comment there).
    security_opt: ["no-new-privileges:true"]
    cap_drop: [CHOWN, SETUID]'
expect_fail "dev frontend dropping only two capabilities is rejected" \
  "docker-compose.yml: service frontend must cap_drop ALL"

# j. the service itself must be there, or the two keys above are a no-op
fresh_copy
mutate docker-compose.prod.yml $'\n  backend:\n' $'\n  backendDisabled:\n'
expect_fail "a prod compose without a backend service is rejected" \
  "docker-compose.prod.yml has no backend service"

# k. the checker fails closed when python3 cannot import yaml: run the same
#    check() in a subshell with a PYTHONPATH that shadows yaml by a module that
#    raises ImportError, and require a non-zero exit with the exact message
FAKELIB="${SCRATCH}/fakelib"
mkdir -p "${FAKELIB}"
printf 'raise ImportError("no yaml here")\n' > "${FAKELIB}/yaml.py"
JOUT="$(
  export PYTHONPATH="${FAKELIB}"
  check "$repo"
  echo "checker_rc=$?"
)"
if grep -qF "checker_rc=1" <<<"$JOUT" \
  && grep -qF "FAIL: PyYAML (python3 -c 'import yaml') is required" <<<"$JOUT"; then
  ok "missing PyYAML fails the checker with the required message"
else bad "missing PyYAML fails the checker: $JOUT"; fi

echo "passed: $PASS, failed: $FAIL"
[ "$FAIL" -eq 0 ]
