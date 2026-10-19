---
type: overview
title: Ingestion pipeline — where it's documented, and the source types
description: Pointer doc, the ingestion pipeline (POST /ingest/:sourceId entrypoint and its /raw variant, IngestionService normalisation, issue grouping for error and fatal entries after the insert) is authoritatively documented in docs/architecture.md's "Ingestion pipeline" section and docs/configuration.md's "Ingestion sources" section; this entry only points there and cross-references the API-key-per-source tenant binding.
tags: [ingestion, sources, pointer]
timestamp: 2026-10-19T06:01:39Z
sources:
  - docs/architecture.md
  - docs/configuration.md
  - backend/src/types/domain.ts
  - backend/src/api/rest/router.ts
  - deploy/fluentd/fluent.conf
  - deploy/vector/vector.toml
---

# Ingestion pipeline — pointer

The authoritative reference is [../architecture.md](../architecture.md)'s "Ingestion pipeline" section: the `POST /api/v1/ingest/:sourceId` entrypoint (a JSON body whose `logs` array holds structured `LogEntry` objects or raw strings parsed by `LogParser`) (or the same array posted bare, which is what the Fluentd and Vector configs send) and its `/raw` variant, which takes a `text/plain` body (415 for any other type) and passes its lines on as raw strings, `IngestionService` resolving the source and its team, per-entry normalisation (defaults for missing fields), the write to ClickHouse via `LogRepository`, and issue grouping/fingerprinting via `IssueService`, which runs after the insert for each error or fatal entry without the request waiting for it. [../configuration.md](../configuration.md)'s "Ingestion sources" section covers the sender side: every source reaches the backend over that one HTTP endpoint with its `X-API-Key`; the six `SourceType` values (`HTTP`, `SYSLOG_UDP`, `SYSLOG_TCP`, `FILEBEAT`, `DOCKER`, `CLOUDWATCH`, matching `backend/src/types/domain.ts` exactly) are a label stored on the source and do not change how logs arrive; the `deploy/fluentd` and `deploy/vector` reference configs collect Docker container logs only and post them as a bare array, so syslog, Filebeat and CloudWatch need a forwarder the operator configures. Both sections are deliberately NOT restated here beyond this summary.

For orientation on the security boundary this pipeline sits behind: each `LogSource`'s `X-API-Key` is pinned 1:1 to that source at authentication time (`authenticateApiKey`, `backend/src/api/rest/router.ts:220#"async function authenticateApiKey("`). See [api-authz-and-team-scoping.md](api-authz-and-team-scoping.md) for the full caller-model writeup, including why this is the ingest path's entire tenant boundary rather than a team/session check. Because the key is looked up on the `LogSource` table for every request, deleting a source or rotating its key (both in that doc) makes the old key answer 403 from the next request.
