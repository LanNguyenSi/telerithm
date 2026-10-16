# Knowledge bundle index

Curated OKF knowledge bundle for the telerithm repo: cross-file semantics,
invariants, and operational facts that no single source file or existing doc
states on its own. The mature references one level up (`docs/`:
architecture, configuration, queries, deployment) stay authoritative for
their areas; these docs deliberately do not duplicate them.

## Overview

- [NLQ pipeline](nlq-pipeline.md), pointer to the authoritative
  `docs/architecture.md` "NLQ pipeline" section plus `docs/queries.md`.
- [Ingestion pipeline](ingestion-pipeline.md), pointer to the authoritative
  `docs/architecture.md` "Ingestion pipeline" section plus
  `docs/configuration.md`'s "Ingestion sources" section.

## Modules

- [Alert evaluation and incident lifecycle](alert-evaluation-and-incident-lifecycle.md),
  the cross-file couplings around `AlertEvaluationWorker` that
  `docs/architecture.md`'s "Alerting" section does not state: one unlocked
  loop per backend process, skipped evaluations that are not made up, the rule
  create, edit and delete routes and what they refuse, the demo seed with its
  plain-text rule, the reserved `ANOMALY_DETECTED` condition, the allowed incident transitions, the
  fixed `MEDIUM` severity against subscription severity filters, team scoping
  through the rule relation, and what the alert metrics count.

## Invariants

- [API authz and team scoping](api-authz-and-team-scoping.md), the three
  caller models in `router.ts` (session Bearer, X-API-Key pinned to a single
  source, global admin) and the `writeRoute` wrapper that authenticates,
  resolves the team and applies the `canWrite` rule (VIEWER read-only) before
  any team-scoped mutating handler runs, made mandatory by a runtime route-table
  test over the real app plus AST meta-tests for the call shapes and a static
  scan for code outside `createApp()`.
- [ClickHouse tenant row-scoping](clickhouse-tenant-row-scoping.md), the
  second, independent tenancy layer below `router.ts`: `team_id` as the
  first `WHERE` condition in every `logs` read, the `LogRepository` methods
  and the alert worker's count query alike, and the dynamic
  `fields['<key>']` allow-list sanitiser that keeps it from being broken
  out of.
- [Compose file topology and drift](compose-file-topology-and-drift.md),
  which of the three `docker-compose*.yml` files is actually deployed, what
  must stay mirrored between the two production variants, and the PR
  #59/#60/#110 drift precedent.
- [Notification delivery trust boundary](notification-delivery-trust-boundary.md),
  `assertSafeUrl` right before each of the three outbound `fetch` calls
  (webhook, Slack, Teams) with `redirect: "manual"`, why that delivery-time
  check is the binding one (the router's input check does not run on every
  write), who can set a target, what leaves the system, and the
  test route.

## Runbooks

- [ClickHouse retention and memory limits](clickhouse-retention-and-memory-limits.md),
  the `text_log` disable + 7-day TTLs, the `max_server_memory_usage_to_ram_ratio=0`
  footgun, `init.sql`'s run-once-on-empty-datadir semantics, the fixed 30-day
  `logs` TTL next to the unenforced per-source `retentionDays`, the unwired
  `anomalies` table, and how to verify a `config.d` mount actually took
  effect.
