# Architecture

Telerithm is a log analytics backend (Express + TypeScript) plus a Next.js 15 frontend. Logs are parsed at the edge, stored in ClickHouse for query speed, and surfaced through a REST API. Natural-language queries are translated to a structured plan by an OpenAI-compatible LLM, with a deterministic heuristic fallback when no key is configured.

## Repo layout

```
frontend/                 Next.js 15, server components, Tailwind CSS
backend/
  src/
    api/
      openapi.ts          OpenAPI 3 spec served at /api/v1/openapi.json
      rest/router.ts      REST endpoints
    ingestion/            Single ingestion service, multi-format parser
    parser/               Format detection (JSON, syslog, plain), normalization
    services/
      ai/ai-service.ts    NLQ to filter plan (LLM + heuristic)
      query/              Query plan execution, pattern normalization
      alert/              Alert rules, incident lifecycle, evaluation worker
      issue/              Error grouping and fingerprinting
      streaming/          SSE live tail
      team/               Tenancy, sources, invites, RBAC
      notification/       Channels: email, webhook, slack, msteams
      log-view/           Saved views
    repositories/         ClickHouse + Prisma data access
    workers/              Background jobs (alert evaluation, retention)
  prisma/                 Postgres schema and migrations
  tests/                  Vitest integration tests
packages/sdk-js/          @telerithm/sdk client SDK
deploy/                   Optional fluentd / vector ingestion sidecars
```

## Data flow

```
   sources                 backend                   stores
   -------                 -------                   ------
HTTP / Syslog / ──► IngestionService ──► LogParser ──► ClickHouse  (logs)
Filebeat / Docker        │                              Postgres   (teams,
CloudWatch               │                                          sources,
                         ▼                                          alerts,
                    IssueService                                    incidents,
                    (fingerprint, group)                            saved views)
                         │                              Redis      (cache,
                         ▼                                          rate limits,
                    AlertEvalWorker ──► NotificationDispatcher      streaming)
                                          ├─ email
                                          ├─ webhook
                                          ├─ slack
                                          └─ msteams
```

## Ingestion pipeline

`POST /api/v1/ingest/:sourceId` is the single ingest entrypoint. It accepts:

- A JSON array of structured `LogEntry` objects (`level`, `service`, `host`, `message`, `fields`).
- A JSON array of raw strings, parsed by `LogParser` based on `payload.format` or auto-detection.

The `IngestionService` (`backend/src/ingestion/ingestion-service.ts`) resolves the source by ID, looks up its team, normalises each entry (default timestamp, default level, default host), and writes the batch to ClickHouse via `LogRepository`. Issue grouping runs inline on errors via `IssueService`, which fingerprints messages and assigns them to existing groups or creates new ones.

Source types are defined in `backend/src/types/domain.ts`:

```ts
export type SourceType =
  | "HTTP"
  | "SYSLOG_UDP"
  | "SYSLOG_TCP"
  | "FILEBEAT"
  | "DOCKER"
  | "CLOUDWATCH";
```

For non-HTTP sources, `deploy/fluentd` and `deploy/vector` ship reference compose configs that forward to the HTTP endpoint.

## NLQ pipeline

The natural-language query path is the central AI integration. `POST /api/v1/query/natural` forwards to `QueryService.explainNaturalQuery`, which delegates to `AIService.translateQuery` (`backend/src/services/ai/ai-service.ts`).

```
NL query ──► AIService.translateQuery
                │
                ├─ if OPENAI_API_KEY set:
                │     OpenAI SDK ──► chat.completions.create
                │       (json_object response_format,
                │        temperature 0.1, retry 2x with backoff)
                │     ──► Zod-validated structured plan
                │
                └─ else:
                      heuristic translator
                      (regex level/service detection,
                       stopword-filtered text terms)

returns NLQTranslation:
  { explanation, filtersApplied[], inferredTimeRange?, textTerms[], warnings[] }
```

Key design choices:

- **OpenAI SDK, not OpenAI cloud.** `OPENAI_BASE_URL` lets you point at any OpenAI-compatible server (Ollama, llama.cpp, vLLM). See [LOCAL_LLM.md](../LOCAL_LLM.md).
- **No SQL generation.** The LLM produces a structured filter plan, not SQL. The query layer compiles it. This keeps the LLM blast radius small (no injection, no schema leakage) and lets the frontend show editable filter chips.
- **Facet hints, not free text.** Known service / host / level values from the team's current scope are passed to the LLM as ground truth. Unknown values go into `textTerms` instead of becoming bogus filters.
- **Retry + fallback.** Transient errors (timeout, 429, 5xx) retry with exponential backoff. After exhaustion, the heuristic translator runs so the UI still gets a usable plan.
- **Schema-validated.** The LLM response is validated with Zod (`nlqResponseSchema`). Validation failures count as parse errors and trigger fallback.

## Storage

- **ClickHouse** holds log rows. Append-only, columnar, partitioned by day. Search and histogram queries hit ClickHouse directly.
- **Postgres** holds tenancy state: teams, users, sources, alert rules, incidents, saved views, invites, escalation policies. Managed by Prisma.
- **Redis** caches facet hints, holds SSE subscriber state, and rate-limits ingestion.

## Alerting

`AlertEvaluationWorker` polls active rules on a fixed cadence, runs each rule's threshold query against ClickHouse, and on threshold breach creates an `Incident` and dispatches notifications via `NotificationDispatcher`. Maintenance windows suppress dispatch without suppressing incident creation. Escalation policies advance through configured steps until the incident is acknowledged or resolved.

## Streaming

`/api/v1/stream/logs` is an SSE endpoint. The `IngestionService` emits events on accepted batches; `StreamingService` filters per-subscriber by team and saved-view criteria, then writes server-sent events to the connected client.
