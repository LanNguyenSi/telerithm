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
  `docs/configuration.md`'s source-type table.

## Invariants

- [API authz and team scoping](api-authz-and-team-scoping.md), the three
  caller models in `router.ts` (session Bearer, X-API-Key pinned to a single
  source, global admin) and the `requireResourceTeam` factory + AST
  meta-test convention that enforces team-scoping on by-id write routes;
  states as open, without deciding it, that `requireTeamRole` checks
  membership only, not role.
- [ClickHouse tenant row-scoping](clickhouse-tenant-row-scoping.md), the
  second, independent tenancy layer below `router.ts`: `team_id` as the
  first `WHERE` condition in every query method, and the dynamic
  `fields['<key>']` allow-list sanitiser that keeps it from being broken
  out of.
- [Compose file topology and drift](compose-file-topology-and-drift.md),
  which of the three `docker-compose*.yml` files is actually deployed, what
  must stay mirrored between the two production variants, and the PR
  #59/#60/#110 drift precedent.

## Runbooks

- [ClickHouse retention and memory limits](clickhouse-retention-and-memory-limits.md),
  the `text_log` disable + 7-day TTLs, the `max_server_memory_usage_to_ram_ratio=0`
  footgun, `init.sql`'s run-once-on-empty-datadir semantics, the unwired
  `anomalies` table, and how to verify a `config.d` mount actually took
  effect.
