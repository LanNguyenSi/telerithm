---
type: overview
title: NLQ pipeline — where the natural-language query path is documented
description: Pointer doc — the natural-language query pipeline (AIService.translateQuery, OpenAI-SDK-compatible with heuristic fallback, no SQL generation) is authoritatively documented in docs/architecture.md's "NLQ pipeline" section and docs/queries.md; this entry only points there, deliberately NOT restated.
tags: [nlq, ai, query, pointer]
timestamp: 2026-07-16T03:19:00Z
sources:
  - docs/architecture.md
  - docs/queries.md
---

# NLQ pipeline — pointer

The authoritative reference is [../architecture.md](../architecture.md)'s "NLQ pipeline" section: `POST /api/v1/query/natural` → `QueryService.explainNaturalQuery` → `AIService.translateQuery`, the OpenAI-SDK-compatible / heuristic-fallback split, the "no SQL generation, structured filter plan only" design choice, and the Zod-validated response contract. [../queries.md](../queries.md) covers the caller-facing surface: how translation works, calling the endpoint, example queries and working/non-working prompt patterns, the heuristic fallback, async query jobs, and domain stop words. Both are current against master and deliberately NOT restated here — one copy, no drift.

For a related concept this bundle does cover directly: `queryType: "sql"` in the search endpoint is a legacy misnomer unrelated to this NLQ path — see [clickhouse-tenant-row-scoping.md](clickhouse-tenant-row-scoping.md).
