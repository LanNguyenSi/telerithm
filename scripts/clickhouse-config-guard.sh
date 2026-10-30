#!/usr/bin/env bash
# Guard for the ClickHouse configuration that the prod composes bind-mount.
#
# Nothing validates these files before a deploy: ClickHouse silently ignores a
# settings profile in config.d, exits at start on a malformed file, and (on
# newer clickhouse-server images, measured on 24.12.6.70) exits at start when
# the entrypoint cannot write users.d/default-user.xml. Each of those only
# shows on the next container start. This script fails the CI run instead.
#
# Checks, on the rendered `docker compose config` of both prod composes and on
# the files under backend/clickhouse:
#   1. the clickhouse service mounts init.sql, config.d and users.d read-only
#      at the expected targets, and both composes mount exactly the same set
#   2. every XML file in config.d and users.d is well-formed and has the root
#      element <clickhouse> (ClickHouse exits at start otherwise); config.d
#      holds no <profiles> block (ClickHouse ignores it there)
#   3. the clickhouse service sets CLICKHOUSE_SKIP_USER_SETUP=1 and none of the
#      variables that make the entrypoint write users.d/default-user.xml
#   4. the project, volume and network names of the two composes are disjoint,
#      and docker-compose.traefik.yml keeps the project "telerithm" with its
#      telerithm_* volumes (the live stack's volumes derive from that name), so
#      `docker compose -f docker-compose.prod.yml up` on the production
#      checkout cannot recreate the production containers
#   5. every service of each prod compose has a bounded json-file log
#      (max-size and max-file), memory and cpu limits and a healthcheck, the
#      backend healthcheck of each probes http://127.0.0.1:4000/api/v1/health
#      (localhost resolves to ::1 first and the backend listens on 0.0.0.0
#      only), and a service present in both composes has the same rendered
#      logging block, the same limits and the same rendered healthcheck in
#      both (the composes are mirrors, and nothing but this check tells when
#      one drifts: the x-logging anchor, the per-service deploy blocks and the
#      healthchecks are plain YAML that compose never compares). Services
#      behind a compose profile are rendered and checked too (--profile '*').
#
# Usage: scripts/clickhouse-config-guard.sh [repo-root]
# Needs docker compose and python3. No .env is read: the compose variables get
# dummy values.
set -euo pipefail

root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
composes=(docker-compose.prod.yml docker-compose.traefik.yml)

# A failed mktemp stops the guard before the cleanup trap exists: with an empty
# tmp, the trap would delete the caller's directory (scripts/test-scratch-safety.test.sh).
tmp="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-clickhouse-guard.XXXXXX")" \
  || { echo "clickhouse-config-guard: FAIL: mktemp failed" >&2; exit 1; }
if [ -z "$tmp" ] || [ ! -d "$tmp" ]; then
  echo "clickhouse-config-guard: FAIL: mktemp did not create a directory: '$tmp'" >&2
  exit 1
fi
trap 'rm -rf "$tmp"' EXIT

rendered=()
for f in "${composes[@]}"; do
  out="$tmp/${f%.yml}.json"
  # --env-file /dev/null: never read a real .env next to the compose file.
  # env -u COMPOSE_PROJECT_NAME: the name check below must see the file's own name.
  # --profile '*': compose renders only the active profiles, so a service behind
  # a profile would otherwise skip every per-service check below.
  if ! env -u COMPOSE_PROJECT_NAME POSTGRES_PASSWORD=ci-dummy OPENAI_API_KEY=ci-dummy \
    docker compose --env-file /dev/null --profile '*' -f "$root/$f" config --format json >"$out"; then
    echo "clickhouse-config-guard: FAIL: docker compose config failed for $f" >&2
    exit 1
  fi
  rendered+=("$f=$out")
done

python3 - "$root" "${rendered[@]}" <<'PY'
import json
import os
import sys
import xml.etree.ElementTree as ET

root = sys.argv[1]
rendered = [arg.split("=", 1) for arg in sys.argv[2:]]

failures = []


def fail(msg):
    failures.append(msg)


expected_mounts = {
    "/docker-entrypoint-initdb.d/init.sql": "backend/clickhouse/init.sql",
    "/etc/clickhouse-server/config.d": "backend/clickhouse/config.d",
    "/etc/clickhouse-server/users.d": "backend/clickhouse/users.d",
}
forbidden_env = [
    "CLICKHOUSE_USER",
    "CLICKHOUSE_PASSWORD",
    "CLICKHOUSE_PASSWORD_FILE",
    "CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT",
]

mount_sets = {}
identities = {}
all_services = {}
for name, path in rendered:
    with open(path) as fh:
        doc = json.load(fh)
    all_services[name] = doc.get("services") or {}
    service = doc.get("services", {}).get("clickhouse")
    identities[name] = {
        "project": doc.get("name"),
        "volumes": {v.get("name") for v in (doc.get("volumes") or {}).values()},
        "networks": {n.get("name") for n in (doc.get("networks") or {}).values()},
    }
    if service is None:
        fail(f"{name}: no clickhouse service")
        continue

    # 1. volumes
    mounts = {}
    for vol in service.get("volumes", []):
        source = vol.get("source", "")
        if vol.get("type") == "bind":
            # compose renders bind sources as absolute paths; compare them
            # relative to the repository root
            source = os.path.relpath(os.path.realpath(source), os.path.realpath(root))
        mounts[vol["target"]] = (vol.get("type"), source, bool(vol.get("read_only")))
    mount_sets[name] = mounts
    for target, want_source in expected_mounts.items():
        got = mounts.get(target)
        if got is None:
            fail(f"{name}: clickhouse service does not mount {want_source} at {target}")
            continue
        if got[0] != "bind" or got[1] != want_source:
            fail(f"{name}: {target} is mounted from {got[1]!r} ({got[0]}), expected the bind {want_source}")
        if not got[2]:
            fail(f"{name}: {target} is not mounted read-only (the entrypoint would write default-user.xml into the checkout)")

    # 3. environment
    env = service.get("environment") or {}
    if isinstance(env, list):
        env = dict(item.split("=", 1) if "=" in item else (item, None) for item in env)
    for var in forbidden_env:
        if var in env:
            fail(f"{name}: clickhouse service sets {var}; the entrypoint then writes users.d/default-user.xml, which fails on the read-only mount")
    if env.get("CLICKHOUSE_SKIP_USER_SETUP") != "1":
        fail(f"{name}: clickhouse service must set CLICKHOUSE_SKIP_USER_SETUP=1 (newer clickhouse-server images write users.d/default-user.xml on every start otherwise, which fails on the read-only mount)")

names = list(mount_sets)
for other in names[1:]:
    if mount_sets[names[0]] != mount_sets[other]:
        only_a = sorted(set(mount_sets[names[0]].items()) - set(mount_sets[other].items()))
        only_b = sorted(set(mount_sets[other].items()) - set(mount_sets[names[0]].items()))
        fail(f"clickhouse volumes differ between {names[0]} and {other}: only in {names[0]}: {only_a}; only in {other}: {only_b}")

# 4. project, volume and network names
prod_file, live_file = "docker-compose.prod.yml", "docker-compose.traefik.yml"
if prod_file in identities and live_file in identities:
    prod, live = identities[prod_file], identities[live_file]
    if live["project"] != "telerithm":
        fail(f"{live_file}: project name is {live['project']!r}, must stay 'telerithm' (the live volumes and network derive from it)")
    want_volumes = {"telerithm_pgdata", "telerithm_chdata", "telerithm_redisdata"}
    if live["volumes"] != want_volumes:
        fail(f"{live_file}: volume names are {sorted(live['volumes'])}, must stay {sorted(want_volumes)} (the live data lives there)")
    with open(os.path.join(root, prod_file)) as fh:
        if not any(line.startswith("name:") and line[5:].strip() for line in fh):
            fail(f"{prod_file}: no top-level name:; without it the project name is the checkout directory, which is 'telerithm' on the production host")
    if prod["project"] == live["project"]:
        fail(f"{prod_file} and {live_file} share the project name {prod['project']!r}; starting {prod_file} would recreate the production containers")
    shared_volumes = prod["volumes"] & live["volumes"]
    if shared_volumes:
        fail(f"{prod_file} and {live_file} share the volumes {sorted(shared_volumes)}")
    shared_networks = (prod["networks"] & live["networks"]) - {"traefik"}
    if shared_networks:
        fail(f"{prod_file} and {live_file} share the networks {sorted(shared_networks)}")

# 5. logging, limits and healthchecks of every service, and their mirroring.
# Compared on the rendered config: compose resolves the *default-logging alias
# and normalises memory to bytes, so the YAML text does not matter. Services
# are taken from the files, not from a fixed list.
def log_bound(service):
    logging = service.get("logging") or {}
    options = logging.get("options") or {}
    return logging.get("driver") == "json-file" and bool(options.get("max-size")) and bool(options.get("max-file"))


def limit(service, key):
    return (((service.get("deploy") or {}).get("resources") or {}).get("limits") or {}).get(key)


def has_healthcheck(service):
    check = service.get("healthcheck") or {}
    return bool(check.get("test")) and not check.get("disable") and check.get("test") != ["NONE"]


backend_probe_url = "http://127.0.0.1:4000/api/v1/health"


def probe_text(service):
    test = (service.get("healthcheck") or {}).get("test")
    return " ".join(test) if isinstance(test, list) else str(test or "")


for name, services in all_services.items():
    for svc, service in sorted(services.items()):
        if not log_bound(service):
            fail(f"{name}: service {svc} has no bounded log: logging is {service.get('logging')!r}, must be driver json-file with max-size and max-file (use logging: *default-logging)")
        for key in ("memory", "cpus"):
            if limit(service, key) is None:
                fail(f"{name}: service {svc} has no deploy.resources.limits.{key}")
        if not has_healthcheck(service):
            fail(f"{name}: service {svc} has no healthcheck (Compose never restarts an unhealthy container, but docker compose ps and Traefik's docker provider read it)")
        elif svc == "backend" and backend_probe_url not in probe_text(service):
            fail(f"{name}: service backend healthcheck must probe {backend_probe_url}, not localhost (localhost resolves to ::1 first and the backend listens on 0.0.0.0 only): {probe_text(service)!r}")

if len(all_services) == 2:
    (name_a, services_a), (name_b, services_b) = all_services.items()
    for svc in sorted(set(services_a) & set(services_b)):
        if services_a[svc].get("logging") != services_b[svc].get("logging"):
            fail(f"logging of service {svc} differs between {name_a} and {name_b}: {services_a[svc].get('logging')!r} vs {services_b[svc].get('logging')!r}")
        if services_a[svc].get("healthcheck") != services_b[svc].get("healthcheck"):
            fail(f"healthcheck of service {svc} differs between {name_a} and {name_b}: {services_a[svc].get('healthcheck')!r} vs {services_b[svc].get('healthcheck')!r}")
        for key in ("memory", "cpus"):
            value_a, value_b = limit(services_a[svc], key), limit(services_b[svc], key)
            if value_a is not None and value_b is not None and str(value_a) != str(value_b):
                fail(f"deploy.resources.limits.{key} of service {svc} differs between {name_a} and {name_b}: {value_a!r} vs {value_b!r}")

# 2. XML files
for sub in ("config.d", "users.d"):
    directory = os.path.join(root, "backend", "clickhouse", sub)
    if not os.path.isdir(directory):
        fail(f"backend/clickhouse/{sub} is missing")
        continue
    files = sorted(f for f in os.listdir(directory) if not f.startswith("."))
    if not files:
        fail(f"backend/clickhouse/{sub} is empty")
    for fname in files:
        rel = f"backend/clickhouse/{sub}/{fname}"
        if not fname.endswith(".xml"):
            fail(f"{rel}: not an .xml file (ClickHouse reads only .xml, .conf and .yaml/.yml here; keep the directory to XML)")
            continue
        try:
            tree = ET.parse(os.path.join(directory, fname))
        except ET.ParseError as exc:
            fail(f"{rel}: malformed XML ({exc}); ClickHouse exits at the next start")
            continue
        top = tree.getroot()
        if top.tag != "clickhouse":
            fail(f"{rel}: root element is <{top.tag}>, must be <clickhouse>; ClickHouse exits at start otherwise")
        if sub == "config.d" and top.find("profiles") is not None:
            fail(f"{rel}: <profiles> in config.d is ignored by ClickHouse; settings profiles belong in users.d")

if failures:
    for msg in failures:
        print(f"clickhouse-config-guard: FAIL: {msg}", file=sys.stderr)
    sys.exit(1)
print("clickhouse-config-guard: OK (mounts, XML roots, entrypoint variables, project names, logging, limits, healthchecks)")
PY
