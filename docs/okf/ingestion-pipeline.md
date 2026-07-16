---
type: overview
title: Ingestion pipeline — where it's documented, and the source types
description: Pointer doc — the ingestion pipeline (single POST /ingest/:sourceId entrypoint, IngestionService normalisation, inline issue grouping) is authoritatively documented in docs/architecture.md's "Ingestion pipeline" section and docs/configuration.md's "Ingestion sources" table; this entry only points there and cross-references the API-key-per-source tenant binding.
tags: [ingestion, sources, pointer]
timestamp: 2026-07-16T06:09:28Z
sources:
  - docs/architecture.md
  - docs/configuration.md
  - backend/src/types/domain.ts
---

# Ingestion pipeline — pointer

The authoritative reference is [../architecture.md](../architecture.md)'s "Ingestion pipeline" section: the single `POST /api/v1/ingest/:sourceId` entrypoint (structured `LogEntry[]` or raw strings via `LogParser`), `IngestionService` resolving the source and its team, per-entry normalisation (default timestamp/level/host), the write to ClickHouse via `LogRepository`, and inline issue grouping/fingerprinting via `IssueService`. [../configuration.md](../configuration.md)'s "Ingestion sources" section lists the six `SourceType` values (`HTTP`, `SYSLOG_UDP`, `SYSLOG_TCP`, `FILEBEAT`, `DOCKER`, `CLOUDWATCH` — matching `backend/src/types/domain.ts` exactly) with how each reaches the HTTP endpoint (direct, or forwarded via the `deploy/fluentd` / `deploy/vector` reference configs). Both are current against master and deliberately NOT restated here.

For orientation on the security boundary this pipeline sits behind: each `LogSource`'s `X-API-Key` is pinned 1:1 to that source at authentication time (`authenticateApiKey`, `backend/src/api/rest/router.ts:145-170`) — see [api-authz-and-team-scoping.md](api-authz-and-team-scoping.md) for the full caller-model writeup, including why this is the ingest path's entire tenant boundary rather than a team/session check.
