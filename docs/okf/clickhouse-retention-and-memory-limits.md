---
type: runbook
title: ClickHouse retention, memory limits, and the config.d mount contract
description: system-logs.xml disables text_log outright and gives every other ClickHouse system log table a 7-day TTL, with the caveat that a TTL change only applies to newly-created tables (existing ones get renamed *_N on restart); limits.xml's max_server_memory_usage_to_ram_ratio must never be 0 (means 0% of RAM, not disabled — the historical PR #60 footgun); init.sql only runs via docker-entrypoint-initdb.d on an empty ClickHouse datadir; the anomalies table it creates has zero code references and is provisioned-but-unwired for the still-Planned anomaly feature; and the operational lesson that a broken host bind-mount can silently turn a mounted config FILE into an empty directory, so a mount must be verified, not assumed.
tags: [clickhouse, retention, memory, runbook, ops, config-mount]
timestamp: 2026-07-16T03:12:00Z
sources:
  - backend/clickhouse/system-logs.xml
  - backend/clickhouse/limits.xml
  - backend/clickhouse/init.sql
  - CHANGELOG.md
  - DEPLOYMENT.md
---

`backend/clickhouse/` ships three files that only take effect if they are actually mounted into the running container: `init.sql` (schema bootstrap), `limits.xml` and `system-logs.xml` (both `config.d/` overrides). All three are asserted identical between the two prod composes in [compose-file-topology-and-drift.md](compose-file-topology-and-drift.md); this doc covers what each one actually does and the gotchas around it.

## system-logs.xml — disable text_log, TTL the rest

ClickHouse's internal `system.text_log` duplicates the server's stderr into a MergeTree table with no TTL by default. On 2026-07-15 it held 133 GiB / 2.5 billion rows on VPS-01 — roughly 80% of the whole disk — while the actual telerithm application data stayed tiny. `system-logs.xml` (`backend/clickhouse/system-logs.xml`) responds in two parts: `<text_log remove="1"/>` disables it outright (it is pure ClickHouse-internal diagnostics, not telerithm data), and every other system log table (`query_log`, `query_thread_log`, `metric_log`, `asynchronous_metric_log`, `trace_log`, `processors_profile_log`, `part_log`, `error_log`) gets `event_date + INTERVAL 7 DAY DELETE` so short-window debugging stays possible without unbounded growth.

**Caveat, stated in the file's own header comment:** a TTL config change only applies to *newly created* tables. On the first restart after this file is mounted, ClickHouse renames each existing table to `<name>_N` and creates a fresh one carrying the TTL — the renamed leftovers keep whatever data they already had and are not themselves retroactively pruned; they can be dropped by hand if they matter for disk space (after the 2026-07-15 truncate they were empty on VPS-01, but that will not be true on every deploy of this config). Shipped together with bounded container logs (`docker-compose.prod.yml`/`docker-compose.traefik.yml`'s `x-logging` anchor, json-file 10m x 3) as commit `b3744ec` / `7248959` (PR #110): "system.text_log had no TTL and grew to 133 GiB ... while actual telerithm data stayed tiny. Disable text_log outright ... and give every other system log table a 7-day TTL."

## limits.xml — memory ceiling, and the ratio=0 footgun

`limits.xml` sets `max_server_memory_usage_to_ram_ratio: 0.85` plus a `default` profile of `max_memory_usage: 2147483648` (2 GiB per-query), `max_bytes_before_external_group_by`/`max_bytes_before_external_sort: 1073741824` (1 GiB external-spill thresholds each). This history is the reason the setting is ratio-only rather than an absolute cap: PR #59 (CHANGELOG.md, `[0.1.1]`) first raised the container to 3 GiB and introduced `limits.xml` after a ClickHouse OOM on the dashboard-overview aggregation (1 GiB cap, producing 500s and a React SSR error). PR #60 then found two problems with that first pass — it had only patched `docker-compose.prod.yml` while production actually runs `docker-compose.traefik.yml` (see [compose-file-topology-and-drift.md](compose-file-topology-and-drift.md)), and the *combination* of an absolute `max_server_memory_usage` cap with `max_server_memory_usage_to_ram_ratio: 0` was resetting the effective limit back to 0 — **ClickHouse treats `ratio: 0` as "0% of RAM", not "disabled"**, so the absolute cap got silently overridden to unlimited. The fix replaced the pair with the ratio-only setting at `0.85` (roughly 2.55 GiB on the 3 GiB container), per-query and spill thresholds unchanged. Never reintroduce an explicit `max_server_memory_usage_to_ram_ratio: 0` expecting it to mean "no ratio limit, use the absolute cap instead" — it means the opposite.

## init.sql — only runs on an empty datadir

`init.sql` is mounted read-only at `/docker-entrypoint-initdb.d/init.sql` in every compose file (dev and both prod variants). This path is ClickHouse's own convention: scripts under `docker-entrypoint-initdb.d/` run **only on first container start against an empty ClickHouse data directory** — not on every restart, and not idempotently against existing data. Neither `DEPLOYMENT.md` (which just says step 4 will "Initialize ClickHouse schema automatically") nor any other doc in this repo states this run-once-on-empty-datadir semantics explicitly; it is standard behaviour of the upstream image's entrypoint, not something telerithm's own code enforces, so a schema change to `init.sql` will not reach an already-initialized volume — that needs a manual `ALTER`/migration against the running container, the same way Postgres schema changes go through `prisma db push` rather than re-running `init.sql`'s equivalent.

## The anomalies table — provisioned, not wired

`init.sql` also creates an `anomalies` table (`team_id`, `detected_at`, `anomaly_type`, `severity`, `description`, `affected_services`, `sample_logs`, `resolved`) via `ENGINE = MergeTree() ORDER BY (team_id, detected_at)`. Grepping the backend and frontend source for `anomal` finds **zero references outside this schema definition** — no repository, service, or route reads or writes it. `README.md`'s feature list still carries "anomaly detection" under **Planned**, not shipped. This table is provisioned infrastructure for a not-yet-built feature, not dead code to clean up and not a bug to fix reactively — flagging it here as an explicit fact for an operator decision (build the feature, or drop the table) rather than editorializing which way that should go.

## Verify a config.d mount actually took effect — do not assume it

`CHANGELOG.md`'s `[0.1.1]` operational note already establishes the discipline for one of these files: "Verify `docker-compose.traefik.yml` is what is in effect on the host before assuming the new limits are applied: `docker exec <ch-container> cat /etc/clickhouse-server/config.d/limits.xml`." The same check applies identically to `system-logs.xml` now that a third config file is mounted the same way. A stricter version of the same check, `ls -la` rather than `cat`, additionally catches a failure mode `cat` alone can miss: a broken or misconfigured host bind-mount can silently turn what should be a mounted config *file* into an empty *directory* instead — the container then boots with the override silently absent, no error, nothing to `cat`. This is the same class of host-side bind-mount contract fragility that surfaced in an unrelated 2026-07-15 incident on the same VPS-01 host; the operational lesson generalises to any bind-mounted single-file config on that host, ClickHouse included. When in doubt after a deploy:

```bash
docker exec <clickhouse-container> ls -la /etc/clickhouse-server/config.d/
```

Expect `limits.xml` and `system-logs.xml` as regular FILES in `config.d/` (`init.sql` is mounted elsewhere, at `docker-entrypoint-initdb.d/`; base-image defaults may add further entries, so check those two by name rather than counting); a directory where a file should be, or a missing entry, means the mount did not take effect and the container is running without that override.
