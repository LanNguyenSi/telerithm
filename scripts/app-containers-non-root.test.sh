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
# processes write at runtime needs root: apart from the base image's node-owned
# /home/node (npm writes ~/.npm/_logs there and the Prisma CLI writes
# ~/.cache), the only path either process writes under /app is .next, which
# the frontend image copies with --chown=node:node, and the backend writes
# nothing under /app (migrate.sh runs node_modules/.bin/prisma, never npx, and
# the Prisma engines are read-only after `prisma generate` at build).
#
# All of it is structural:
# - the stage that runs the image must end with a USER that is neither root
#   nor in the root group: no compose service sets build.target, so the image
#   is the LAST stage of the Dockerfile, and a stage named build.target is
#   checked instead when a service building the file does set one; checking
#   only the stage named "runtime" is not enough, because a later
#   "FROM runtime AS final" would then be the image instead.
# - the frontend's running stage must hand .next to the account its last USER
#   names (a --chown on the COPY, or a chown of /app/.next in the same stage
#   before the USER switch), or the Next image cache write under .next/cache
#   fails with EACCES on the first /_next/image request.
# - every app service of every compose file must carry both hardening keys and
#   must not undo them: no user: override to root (a user key overrides the
#   image USER at runtime), no privileged: true, no non-empty cap_add.
# It checks the files, not a running container (a real check that the process
# is uid 1000 needs the built image, so it stays a manual step in
# DEPLOYMENT.md). The compose half is parsed with PyYAML, which is required:
# the check fails closed without it, like the other compose checks in this job
# (a plain-text scan would miss flow sequences and the *default-logging anchor).
#
# The controls at the end run the same check on mutated copies (a stage without
# USER, USER root, 00 or 1000:0, a stage added after runtime with USER root,
# an un-chowned .next copy, a service without cap_drop or without
# no-new-privileges, with user: root or 0:0 or 1000:0, privileged, or cap_add)
# and must fail with the message of their own branch; a control whose mutation
# anchor does not match exactly once is a hard error, not a silent pass.
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
# An account or group token (Dockerfile USER, compose user) is a name or a
# numeric id. Anything else, a ${VAR} in particular, names nothing a check can
# judge, so it fails closed.
ACCOUNT = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*$|^[0-9]+$")
# App images that write under /app at runtime, and the path they write: the
# frontend's Next server writes its image cache under .next; the backend
# writes nothing under /app.
WRITES = {"frontend/Dockerfile": ".next"}

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


def describe_stage(stage):
    return "the %s stage" % stage[0] if stage[0] else "the untagged last stage"


def is_root(token):
    # Names uid or gid 0: the name root, or a numeric 0 in any spelling,
    # since Docker parses 00 and 000 as uid 0 too.
    return token.lower() == "root" or (token.isdigit() and int(token) == 0)


def check_user(rel, stage, why):
    # The last USER of the stage must name a non-root account that is not in
    # the root group either; returns the account name when it is judgeable and
    # clean, None otherwise.
    desc = describe_stage(stage)
    users = [i for i in stage[1] if i.split()[0].lower() == "user"]
    if not users:
        fail("%s: %s has no USER directive, so the container runs as root (uid 0) (%s)"
             % (rel, desc, why))
        return None
    value = users[-1].split(None, 1)[1].strip() if len(users[-1].split()) > 1 else ""
    tokens = [t.strip() for t in value.split(":")]
    account = tokens[0]
    if not ACCOUNT.match(account):
        fail("%s: the last USER of %s does not name an account this check can "
             "judge (want a literal name or uid, not root): USER %s"
             % (rel, desc, value))
        return None
    if is_root(account):
        fail("%s: the last USER of %s is root (uid 0): USER %s" % (rel, desc, value))
        return None
    if len(tokens) > 1:
        if not ACCOUNT.match(tokens[1]):
            fail("%s: the last USER of %s has a group this check cannot judge: USER %s"
                 % (rel, desc, value))
        elif is_root(tokens[1]):
            fail("%s: the last USER of %s runs the process in the root group "
                 "(gid 0): USER %s" % (rel, desc, value))
    return account


def next_in(tokens):
    # True when a token is .next itself or something under it (.next/cache).
    for token in tokens:
        if ".next" in token.rstrip("/").split("/"):
            return True
    return False


def same_account(token, account):
    token = token.split(":")[0]
    return (token == account
            or (token.isdigit() and account.isdigit() and int(token) == int(account)))


def check_next_writable(rel, stage, account):
    # The frontend writes .next at runtime, so the running stage must hand
    # .next to the account its last USER names: either the COPY bringing it in
    # is --chowned to that account, or a chown RUN in the same stage does it
    # before the stage drops to that account (after the USER switch a chown
    # could not run as root anymore).
    instructions = stage[1]
    last_user = max(i for i, l in enumerate(instructions) if l.split()[0].lower() == "user")
    handed = False
    for idx, line in enumerate(instructions):
        parts = line.split()
        word = parts[0].lower()
        flags = [p for p in parts[1:] if p.startswith("--")]
        operands = [p for p in parts[1:] if not p.startswith("--")]
        if not next_in(operands if word == "copy" else parts[1:]):
            continue
        if word == "copy" and any(f.startswith("--chown=") and same_account(f.split("=", 1)[1], account)
                                  for f in flags):
            handed = True
        if (word == "run" and idx < last_user
                and any(p.lower() == "chown" for p in parts[1:])
                and any(same_account(p, account) for p in parts[1:])):
            handed = True
    if not handed:
        fail("%s: %s must hand .next to the account its USER names (%s): COPY it "
             "with --chown=%s, or chown /app/.next to %s in the stage, or the "
             "Next image cache write under .next/cache fails with EACCES at "
             "runtime" % (rel, describe_stage(stage), account, account, account))


def as_list(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return [str(value)]


def compose_builds(docs):
    # -> {dockerfile path: [(compose rel, service, target or None), ...]}
    builds = {}
    for rel, doc in docs.items():
        services = (doc or {}).get("services") or {}
        for svc in app_services:
            cfg = services.get(svc)
            if not isinstance(cfg, dict):
                continue
            build = cfg.get("build")
            if isinstance(build, str):
                ctx, dockerfile, target = build, "Dockerfile", None
            elif isinstance(build, dict):
                ctx = build.get("context", ".")
                dockerfile = build.get("dockerfile", "Dockerfile")
                target = build.get("target")
            else:
                continue
            path = os.path.normpath(os.path.join(str(ctx), str(dockerfile)))
            builds.setdefault(path, []).append((rel, svc, None if target is None else str(target)))
    return builds


def running_stages(rel, found, docs):
    # The image that runs is the stage named by build.target when a compose
    # service building this Dockerfile sets one, and the LAST stage of the
    # file otherwise: docker build without --target always builds the last
    # stage, and no compose service of these files sets a target.
    entries = compose_builds(docs).get(rel, [])
    out = []
    seen = set()
    if not entries:
        entries = [(None, None, None)]  # nothing builds it: its last stage is the image
    for rel_c, svc, target in entries:
        if target is None:
            key = ("<last>", None)
            stage = found[-1]
            why = ("service %s of %s builds it without a target, so its last "
                   "stage is the image" % (svc, rel_c) if rel_c else
                   "no compose service builds it with a build.target, so its "
                   "last stage is the image")
        else:
            named = [s for s in found if s[0] == target]
            if not named:
                fail("%s: service %s of %s builds it with target %s, but the "
                     "file has no stage named %s" % (rel, svc, rel_c, target, target))
                continue
            key = ("<named>", target)
            stage = named[-1]
            why = "service %s of %s builds it with target %s" % (svc, rel_c, target)
        if key in seen:
            continue
        seen.add(key)
        out.append((stage, why))
    return out


def check_dockerfile(rel, docs):
    path = os.path.join(root, rel)
    try:
        text = open(path).read()
    except OSError as exc:
        fail("%s cannot be read: %s" % (rel, exc))
        return
    found = stages(text)
    if not found:
        fail("%s has no stage at all, so there is no image to check" % rel)
        return
    for stage, why in running_stages(rel, found, docs):
        account = check_user(rel, stage, why)
        if account is not None and rel in WRITES:
            check_next_writable(rel, stage, account)


def check_compose(rel, doc):
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
        if "user" in cfg and str(cfg["user"]).strip() != "":
            # A user key overrides the image USER at runtime, root included;
            # the empty string means the image default, like leaving it out.
            tokens = [t.strip() for t in str(cfg["user"]).strip().split(":")]
            if not ACCOUNT.match(tokens[0]):
                fail("%s: service %s sets a user this check cannot judge (want a "
                     "literal name or uid, not root): user: %r" % (rel, svc, cfg["user"]))
            elif is_root(tokens[0]):
                fail("%s: service %s must not override the image's non-root user "
                     "with root: user: %r" % (rel, svc, cfg["user"]))
            elif len(tokens) > 1:
                if not ACCOUNT.match(tokens[1]):
                    fail("%s: service %s sets a user with a group this check "
                         "cannot judge: user: %r" % (rel, svc, cfg["user"]))
                elif is_root(tokens[1]):
                    fail("%s: service %s must not run in the root group: user: %r"
                         % (rel, svc, cfg["user"]))
        privileged = cfg.get("privileged")
        if privileged is True or str(privileged).strip().lower() in ("true", "yes", "on", "1"):
            fail("%s: service %s must not run privileged, it gets back every "
                 "capability the hardening drops: privileged: %r"
                 % (rel, svc, cfg.get("privileged")))
        if any(v.strip() for v in as_list(cfg.get("cap_add"))):
            fail("%s: service %s must not cap_add, an added capability defeats "
                 "the cap_drop ALL: cap_add: %r" % (rel, svc, cfg.get("cap_add")))


try:
    import yaml
except ImportError:
    print("FAIL: PyYAML (python3 -c 'import yaml') is required")
    sys.exit(1)

# Parsed once and shared: check_dockerfile reads build.target out of the
# compose services to find the stage that actually runs.
docs = {}
for rel in compose_files:
    try:
        docs[rel] = yaml.safe_load(open(os.path.join(root, rel)).read())
    except OSError as exc:
        fail("%s cannot be read: %s" % (rel, exc))
        docs[rel] = False
    except yaml.YAMLError as exc:
        fail("%s does not parse as YAML: %s" % (rel, exc))
        docs[rel] = False

for rel in dockerfiles:
    check_dockerfile(rel, {k: v for k, v in docs.items() if v is not False})
for rel, doc in docs.items():
    if doc is not False:
        check_compose(rel, doc)

if fails:
    sys.exit(1)
print("ok: every running stage (the last one, no compose sets a build.target) "
      "ends with a non-root USER outside the root group and hands .next to it, "
      "and every app service of %s drops ALL capabilities with "
      "no-new-privileges:true, no root user, no privileged and no cap_add"
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

# mutate <file> <old> <new>: exact single replacement, and a hard error when
# <old> is absent or not unique: a control whose anchor does not match once
# must stop the run, not turn into a no-op the next expect_fail would pass or
# fail for the wrong reason (some anchors name a USER the mutation drops).
mutate() {
  python3 - "${SCRATCH}/tree/$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1:4]
text = open(path).read()
if text.count(old) != 1:
    sys.exit(f"mutation target {old!r} found {text.count(old)} times in {path}, expected once")
open(path, "w").write(text.replace(old, new))
PY
  if [ $? -ne 0 ]; then
    echo "FATAL: control anchor did not match exactly once, cannot run this control: $2" >&2
    exit 2
  fi
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

# e. the check follows the last stage, not the stage named runtime: a stage
#    added after runtime is the image now, so it must end non-root even
#    though the stage before it still says USER node
fresh_copy
mutate backend/Dockerfile 'CMD ["sh", "entrypoint.sh"]' \
  $'CMD ["sh", "entrypoint.sh"]\n\nFROM node:22-alpine AS extra\nEXPOSE 4000'
expect_fail "a later stage without a USER is rejected" \
  "backend/Dockerfile: the extra stage has no USER directive"

# f. a renamed final stage is checked under its own name: the rule is the last
#    stage, so renaming runtime away must not hide a missing USER
fresh_copy
mutate frontend/Dockerfile "FROM node:22-alpine AS runtime" "FROM node:22-alpine AS serve"
mutate frontend/Dockerfile "USER node" "# USER node"
expect_fail "a renamed last stage without a USER is rejected" \
  "frontend/Dockerfile: the serve stage has no USER directive"

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

# k. the frontend runtime stage must hand .next to the USER account: without
#    the --chown the copied build output is root-owned and the image cache
#    write fails with EACCES at runtime
fresh_copy
mutate frontend/Dockerfile "--chown=node:node /app/.next" "/app/.next"
expect_fail "frontend .next copied without --chown is rejected" \
  "frontend/Dockerfile: the runtime stage must hand .next to the account its USER names (node)"

# l. a compose user override back to root undoes the image USER at runtime
fresh_copy
mutate docker-compose.prod.yml \
  '    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *default-logging
    environment:
      HOST: 0.0.0.0' \
  '    user: root
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *default-logging
    environment:
      HOST: 0.0.0.0'
expect_fail "prod backend with user root is rejected" \
  "docker-compose.prod.yml: service backend must not override the image's non-root user with root"

# m. the same with a numeric uid 0 (and with a group behind it)
fresh_copy
mutate docker-compose.prod.yml \
  '    # Same two keys as the backend service above (see the comment there).
    security_opt: ["no-new-privileges:true"]' \
  '    # Same two keys as the backend service above (see the comment there).
    user: "0:0"
    security_opt: ["no-new-privileges:true"]'
expect_fail "prod frontend with user 0:0 is rejected" \
  "docker-compose.prod.yml: service frontend must not override the image's non-root user with root"

# n. uid 1000 is not enough when the group is root
fresh_copy
mutate docker-compose.prod.yml \
  '    # Same two keys as the backend service above (see the comment there).
    security_opt: ["no-new-privileges:true"]' \
  '    # Same two keys as the backend service above (see the comment there).
    user: "1000:0"
    security_opt: ["no-new-privileges:true"]'
expect_fail "prod frontend with user 1000:0 is rejected" \
  "docker-compose.prod.yml: service frontend must not run in the root group"

# o. privileged: true hands the container every dropped capability back
fresh_copy
mutate docker-compose.yml \
  '    # Same two keys as the backend service above (see the comment there).
    security_opt: ["no-new-privileges:true"]' \
  '    # Same two keys as the backend service above (see the comment there).
    privileged: true
    security_opt: ["no-new-privileges:true"]'
expect_fail "dev frontend privileged is rejected" \
  "docker-compose.yml: service frontend must not run privileged"

# p. one cap_add defeats the cap_drop ALL again
fresh_copy
mutate docker-compose.prod.yml \
  '    # Same two keys as the backend service above (see the comment there).
    security_opt: ["no-new-privileges:true"]' \
  '    # Same two keys as the backend service above (see the comment there).
    cap_add: [SYS_ADMIN]
    security_opt: ["no-new-privileges:true"]'
expect_fail "prod frontend with a cap_add is rejected" \
  "docker-compose.prod.yml: service frontend must not cap_add"

# q. a stage added after runtime that ends USER root: no compose service sets
#    a target, so this final stage is the image that runs
fresh_copy
mutate backend/Dockerfile 'CMD ["sh", "entrypoint.sh"]' \
  $'CMD ["sh", "entrypoint.sh"]\n\nFROM runtime AS final\nUSER root\nEXPOSE 4000'
expect_fail "a later stage ending USER root is rejected" \
  "backend/Dockerfile: the last USER of the final stage is root (uid 0)"

# r. USER 00 is uid 0 for Docker: numeric accounts normalise before the
#    root comparison, exactly as 0 does
fresh_copy
mutate backend/Dockerfile "USER node" "USER 00"
expect_fail "USER 00 is rejected as root" \
  "backend/Dockerfile: the last USER of the runtime stage is root (uid 0)"

# s. USER 1000:0 runs the process in the root group, which the hardening of
#    the compose files (cap_drop ALL) is meant to exclude
fresh_copy
mutate frontend/Dockerfile "USER node" "USER 1000:0"
expect_fail "USER 1000:0 is rejected for the root group" \
  "frontend/Dockerfile: the last USER of the runtime stage runs the process in the root group"

# t. precedence: when a compose service building the file sets build.target,
#    the named stage is the image, so its missing USER is what fails (the
#    runtime stage below is untouched and fine)
fresh_copy
mutate docker-compose.yml '    build:
      context: ./backend' \
  '    build:
      context: ./backend
      target: build'
expect_fail "the stage named by build.target is checked, not the last one" \
  "backend/Dockerfile: the build stage has no USER directive"

# u. a build.target naming a stage the file does not have must not be a no-op
fresh_copy
mutate docker-compose.yml '    build:
      context: ./backend' \
  '    build:
      context: ./backend
      target: nonexistent'
expect_fail "a build.target naming no stage is rejected" \
  "backend/Dockerfile: service backend of docker-compose.yml builds it with target nonexistent, but the file has no stage named nonexistent"

# v. a control whose anchor does not match exactly once must stop the run, not
#    pass: on a real scratch copy, run mutate in a subshell with an anchor no
#    file contains, then with one that occurs several times, and require exit 2
#    plus the FATAL message both times
fresh_copy
for anchor in 'this anchor exists nowhere' 'FROM node:22-alpine'; do
  vrc=0
  vout="$( ( mutate backend/Dockerfile "${anchor}" 'y' ) 2>&1 )" || vrc=$?
  if [ "${vrc}" -eq 2 ] && printf '%s' "${vout}" | grep -q 'FATAL: control anchor did not match exactly once'; then
    ok "a control whose anchor matches $( [ "${anchor}" = 'FROM node:22-alpine' ] && echo 'several times' || echo 'nowhere' ) aborts the run"
  else
    bad "a control whose anchor does not match exactly once must abort with exit 2 (got ${vrc}): ${anchor}"
  fi
done
fresh_copy

# w. the checker fails closed when python3 cannot import yaml: run the same
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
