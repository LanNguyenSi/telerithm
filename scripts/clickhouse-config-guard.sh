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
#
# Usage: scripts/clickhouse-config-guard.sh [repo-root]
# Needs docker compose and python3. No .env is read: the compose variables get
# dummy values.
set -euo pipefail

root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
composes=(docker-compose.prod.yml docker-compose.traefik.yml)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

rendered=()
for f in "${composes[@]}"; do
  out="$tmp/${f%.yml}.json"
  # --env-file /dev/null: never read a real .env next to the compose file.
  if ! POSTGRES_PASSWORD=ci-dummy OPENAI_API_KEY=ci-dummy \
    docker compose --env-file /dev/null -f "$root/$f" config --format json >"$out"; then
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
for name, path in rendered:
    with open(path) as fh:
        service = json.load(fh).get("services", {}).get("clickhouse")
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
print("clickhouse-config-guard: OK (mounts, XML roots, entrypoint variables)")
PY
