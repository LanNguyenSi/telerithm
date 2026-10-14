---
type: overview
title: NLQ pipeline — where the natural-language query path is documented
description: Pointer doc — the natural-language query pipeline (AIService.translateQuery, OpenAI-SDK-compatible with heuristic fallback, no SQL generation) is authoritatively documented in docs/architecture.md's "NLQ pipeline" section and docs/queries.md; this entry only points there, deliberately NOT restated.
tags: [nlq, ai, query, pointer]
timestamp: 2026-10-14T05:04:06Z
sources:
  - docs/architecture.md
  - docs/queries.md
  - backend/src/api/rest/router.ts
  - backend/src/services/query/query-service.ts
---

# NLQ pipeline — pointer

The authoritative reference is [../architecture.md](../architecture.md)'s "NLQ pipeline" section: `POST /api/v1/query/natural` → `QueryService.explainNaturalQuery` → `AIService.translateQuery`, the OpenAI-SDK-compatible / heuristic-fallback split, the "no SQL generation, structured filter plan only" design choice, and the Zod-validated response contract. [../queries.md](../queries.md) covers the caller-facing surface: how translation works, calling the endpoint, example queries and working/non-working prompt patterns, the heuristic fallback, async query jobs, and domain stop words. Both are deliberately NOT restated here: one copy, no drift.

The async query jobs that queries.md describes are not part of the NLQ path: `POST /query/natural` (`backend/src/api/rest/router.ts:804#"/query/natural"`) answers synchronously through `QueryService.explainNaturalQuery` (`backend/src/services/query/query-service.ts:128#"async explainNaturalQuery("`). The `202` job hand-off belongs to the facet, histogram and pattern handlers (`backend/src/api/rest/router.ts:512#"/logs/facets"`, `backend/src/api/rest/router.ts:548#"/logs/histogram"`, `backend/src/api/rest/router.ts:584#"/logs/patterns"`), which start a job through `QueryService.startAsyncJob` (`backend/src/services/query/query-service.ts:157#"startAsyncJob<T>("`) when the request sets `async` or runs past `MAX_SYNC_RUNTIME_MS`.

For a related concept this bundle does cover directly: `queryType: "sql"` in the search endpoint is a legacy misnomer unrelated to this NLQ path — see [clickhouse-tenant-row-scoping.md](clickhouse-tenant-row-scoping.md).
