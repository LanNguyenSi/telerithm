# Telerithm

**AI-powered log analytics for self-hosted teams.**

Telerithm turns plain-language questions into structured queries over your logs. Instead of grepping millions of lines or hand-writing SQL, you ask _"show me payment errors from the last hour"_ and the AI translates it into filters, a time range, and a search plan you can review and edit. Self-hosted, single-tenant by default, OpenAI-compatible (cloud or local LLM).

<!-- TODO: hero screenshot of the natural-language query interface -->

## Try it in 60 seconds

**Live demo (no install):**

[demo.telerithm.cloud](https://demo.telerithm.cloud)

**Self-host:**

```bash
git clone https://github.com/LanNguyenSi/telerithm.git
cd telerithm
make init
```

That builds the stack and starts everything on Docker:

| Service    | URL                    |
| ---------- | ---------------------- |
| Frontend   | http://localhost:3000  |
| Backend    | http://localhost:4000  |
| API docs   | http://localhost:4000/docs |

Send a log, then ask a question:

```bash
curl -X POST http://localhost:4000/api/v1/ingest/<sourceId> \
  -H "X-API-Key: <apiKey>" -H "Content-Type: application/json" \
  -d '{"logs":[{"level":"error","service":"payment","message":"Payment authorization failed for order 4721","fields":{"status_code":502,"amount":189.50}}]}'
```

## What a query looks like

`POST /api/v1/query/natural` with `{"teamId":"...", "query":"payment errors in the last hour"}` returns the AI's structured plan:

```json
{
  "explanation": "Filtered to service=payment and level=error over the last hour.",
  "filtersApplied": [
    { "field": "level",   "operator": "eq",       "value": "error"   },
    { "field": "service", "operator": "contains", "value": "payment" }
  ],
  "inferredTimeRange": {
    "startTime": "2026-04-28T09:14:00Z",
    "endTime":   "2026-04-28T10:14:00Z"
  },
  "textTerms": ["payment", "errors"],
  "warnings": []
}
```

The frontend renders this as editable filter chips plus a timeline view, so you can refine the AI's interpretation before running the search. If `OPENAI_API_KEY` is unset, Telerithm falls back to a deterministic heuristic translator (no LLM call, no cloud dependency).

## Next steps

| If you want to...                                                | Read                                       |
| ---------------------------------------------------------------- | ------------------------------------------ |
| See it running, click around, no install                         | [demo.telerithm.cloud](https://demo.telerithm.cloud) |
| Read the pitch and roadmap                                       | [telerithm.cloud](https://telerithm.cloud) |
| Understand the ingestion + AI pipeline                           | [docs/architecture.md](docs/architecture.md) |
| Configure env vars, ingestion sources, LLM provider              | [docs/configuration.md](docs/configuration.md) |
| Write better natural-language queries, see prompt patterns       | [docs/queries.md](docs/queries.md)         |
| Run on a VPS with Traefik + SSL                                  | [DEPLOYMENT.md](DEPLOYMENT.md)             |
| Run a local LLM (llama.cpp, Ollama) instead of cloud             | [LOCAL_LLM.md](LOCAL_LLM.md)               |

## Features

**Available now:**

- Natural-language search with editable AI-generated filter plan
- Real-time SSE log streaming, Today view, log detail with surrounding context
- Saved views, faceted search, histograms, automatic pattern clustering
- Multi-source ingestion: HTTP, Syslog (UDP/TCP), Filebeat, Docker, CloudWatch
- Alert rules + incidents, escalation policies, maintenance windows
- Notification channels: Email, Webhook, Slack, Microsoft Teams
- Error grouping with fingerprinting and assignment workflow
- Team management with RBAC (Owner, Admin, Member, Viewer), invites, admin API
- Single-tenant by default, optional multi-tenant via config flag

**Planned:** AI root-cause analysis, anomaly detection, custom dashboards, SSO/OIDC, retention policies, Prometheus metrics export, `telerithm` CLI.

## API at a glance

All endpoints under `/api/v1`. Bearer-token auth except `/ingest/*` (API key) and `/auth/*`.

| Method | Path                     | Description                |
| ------ | ------------------------ | -------------------------- |
| `POST` | `/auth/register`         | Create account             |
| `POST` | `/auth/login`            | Sign in                    |
| `POST` | `/ingest/:sourceId`      | Ingest logs (API key)      |
| `POST` | `/logs/search`           | Search logs                |
| `POST` | `/query/natural`         | Translate NL to query plan |
| `GET`  | `/stream/logs`           | SSE live tail              |
| `GET`  | `/alerts/incidents`      | List incidents             |
| `GET`  | `/issues`                | List grouped errors        |
| `GET`  | `/health`                | Health check               |

Full spec at `GET /api/v1/openapi.json`.

## Architecture

```
frontend/         Next.js 15, server components, Tailwind
backend/
  ├── api/        REST endpoints + OpenAPI spec
  ├── ingestion/  Log parsing and storage pipeline
  ├── services/   ai, query, alert, team, notification, ...
  ├── prisma/     Postgres schema and migrations
  └── tests/      Vitest integration tests
packages/sdk-js/  JavaScript/TypeScript client SDK
```

**Stack:** Node.js, Express, Prisma, PostgreSQL, ClickHouse, Redis, Next.js, Tailwind. See [docs/architecture.md](docs/architecture.md) for how ingestion, storage, and the NLQ pipeline fit together.

## Development

```bash
cd backend && npm test              # vitest integration tests
cd backend && npx tsc --noEmit      # type check
cd frontend && npx tsc --noEmit     # type check
```

Contributions welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
