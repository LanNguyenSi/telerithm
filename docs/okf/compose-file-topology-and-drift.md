---
type: invariant
title: Compose file topology — three files, one actually deployed, and the mirroring invariant between the two prod variants
description: docker-compose.yml is local dev only (no logging bounds, no ClickHouse config.d mounts); docker-compose.prod.yml is a generic/reference prod compose that is NOT deployed; docker-compose.traefik.yml is the actually-deployed VPS-01 variant, pinned by .relay.yml's compose_file. The three ClickHouse config mounts plus the json-file x-logging anchor must stay identical between prod.yml and traefik.yml; PR #59/#60/#110 are the precedent for that drift risk, the last of which finally applied a fix to both proactively instead of needing a follow-up mirror.
tags: [docker-compose, deploy, drift, topology, ops]
timestamp: 2026-07-16T03:16:00Z
sources:
  - docker-compose.yml
  - docker-compose.prod.yml
  - docker-compose.traefik.yml
  - .relay.yml
  - CHANGELOG.md
---

## The invariant

Three compose files exist at the repo root and serve three different purposes, not three redundant copies:

- **`docker-compose.yml`** — local dev only. Exposes Postgres/ClickHouse/Redis ports directly on the host (`5432`, `8123`/`9000`, `6379`), has no per-service memory/CPU limits, no `x-logging` bound, and mounts only `backend/clickhouse/init.sql` into ClickHouse — no `limits.xml`, no `system-logs.xml`.
- **`docker-compose.prod.yml`** — a generic/reference production compose (internal-only Postgres/ClickHouse/Redis, `deploy.resources.limits` on every service, an `x-logging` anchor bounding json-file logs to `10m x 3`, all three ClickHouse `backend/clickhouse/{init.sql,limits.xml,system-logs.xml}` mounts). It is **not** what is actually deployed anywhere; it exists as the non-Traefik reference shape.
- **`docker-compose.traefik.yml`** — the file **actually deployed** on VPS-01. Structurally the same service set and resource limits as `prod.yml`, plus Traefik network wiring and routing labels (`traefik.http.routers.*`, `Host(...)` rules for `demo.telerithm.cloud`/`play.telerithm.cloud`). `.relay.yml` (repo root) pins this explicitly: `compose_file: docker-compose.traefik.yml`, and its `pre_update`/`post_update` hooks (`docker compose -f docker-compose.traefik.yml build ...` / `... exec backend npx prisma db push --skip-generate`) run only against this file. `DEPLOYMENT.md`'s entire deploy walkthrough also only ever invokes `-f docker-compose.traefik.yml`.

Because `prod.yml` and `traefik.yml` are two independently-edited files describing what should be the same production runtime configuration, **the parts of them that encode operational behaviour, not routing, must be kept identical**: the three ClickHouse `config.d`/`docker-entrypoint-initdb.d` volume mounts (`init.sql`, `limits.xml`, `system-logs.xml`) and the `x-logging: &default-logging` anchor (`json-file`, `max-size: "10m"`, `max-file: "3"`) applied to every service. `docker-compose.yml` (dev) is deliberately exempt from this — it never runs against production data volumes and intentionally omits both.

## Where it's enforced

There is no automated check that `prod.yml` and `traefik.yml` stay in sync on these fields — this is a hand-maintained invariant, not a structural one (unlike the by-id-write-route guard in [api-authz-and-team-scoping.md](api-authz-and-team-scoping.md), which has an AST meta-test). The only enforcement today is discipline at edit time and the operational-note habit `CHANGELOG.md` documents: verify the mount that matters is actually present in the file that is actually deployed (see [clickhouse-retention-and-memory-limits.md](clickhouse-retention-and-memory-limits.md), "Verify a config.d mount actually took effect").

## What breaks it — the drift precedent

Three commits show the exact failure mode and its eventual fix:

- **PR #59** (`CHANGELOG.md [0.1.1]`) raised the ClickHouse container to 3 GiB and introduced `limits.xml` after an OOM — but only patched `docker-compose.prod.yml`.
- **PR #60** had to catch up: "PR #59 only patched `docker-compose.prod.yml`, but production runs via `docker-compose.traefik.yml`. The limits mount and 3 GiB cap are now mirrored into the traefik compose, so the fix lands on the deployed container." This is the drift risk made concrete — a real fix shipped and did not reach production until a dedicated follow-up commit noticed the gap.
- **PR #110** (commit `b3744ec`/`7248959`) is the corrected pattern: it introduced `system-logs.xml`'s mount and the `x-logging` bounding "in both prod composes" and "on all services in both prod composes" in the same commit, per its own message — no separate mirroring PR was needed this time.

Any future change to ClickHouse's `config.d`/`docker-entrypoint-initdb.d` mounts, resource limits, or the logging anchor must land in both `docker-compose.prod.yml` and `docker-compose.traefik.yml` in the same change (PR #110's pattern), not just the one a developer happens to be looking at (PR #59's pattern) — otherwise the fix silently does not reach the deployed container, exactly as PR #60 had to discover and correct after the fact.
