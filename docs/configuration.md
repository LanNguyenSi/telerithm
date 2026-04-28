# Configuration

All configuration is environment-driven. The backend validates env vars on startup with Zod (`backend/src/config/index.ts`); a missing or malformed value crashes the process with a precise error, never silently degrades.

## Backend env vars

| Variable             | Default                       | Description                                                                         |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `PORT`               | `4000`                        | API server port                                                                     |
| `HOST`               | `127.0.0.1`                   | API bind host                                                                       |
| `NODE_ENV`           | `development`                 | `development`, `production`, `test`                                                 |
| `DATABASE_URL`       | _required_                    | PostgreSQL connection string                                                        |
| `CLICKHOUSE_URL`     | _required_                    | ClickHouse HTTP endpoint                                                            |
| `REDIS_URL`          | `redis://localhost:6379`      | Redis connection string                                                             |
| `LOG_LEVEL`          | `info`                        | `fatal`, `error`, `warn`, `info`, `debug`, `trace`                                  |
| `CORS_ORIGINS`       | `http://localhost:3000`       | Comma-separated allowed origins                                                     |
| `MULTI_TENANT`       | `false`                       | `true`: users create teams. `false`: single-team mode                               |
| `REGISTRATION_MODE`  | `approval`                    | `open`, `invite-only`, `approval`                                                   |
| `ADMIN_EMAIL`        | unset                         | Bootstrap admin email for first signup                                              |
| `OPENAI_API_KEY`     | unset                         | Enables LLM-backed NLQ. If unset, heuristic fallback is used                        |
| `OPENAI_BASE_URL`    | unset                         | OpenAI-compatible endpoint (Ollama, llama.cpp, vLLM). Defaults to OpenAI cloud      |
| `OPENAI_MODEL`       | `llama-3.3-70b-versatile`     | Model name passed to the chat completions API                                       |
| `OPENAI_TIMEOUT_MS`  | `10000`                       | Per-call timeout in ms                                                              |
| `MAX_LOOKBACK_MS`    | `604800000` (7 days)          | Hard cap on query time range                                                        |
| `MAX_PAGE_SIZE`      | `500`                         | Max page size for log search (50, 2000)                                             |
| `MAX_SYNC_RUNTIME_MS`| `1500`                        | Max wall time for synchronous queries before they're pushed to async jobs           |

A starter file lives at `backend/.env.example`. Copy and edit:

```bash
cp backend/.env.example backend/.env
```

## Frontend env vars

| Variable                   | Default                          | Description                |
| -------------------------- | -------------------------------- | -------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000/api/v1`   | Backend API base URL       |

Copy from `frontend/.env.local.example`.

## AI provider configuration

The `AIService` uses the official `openai` SDK against any OpenAI-compatible endpoint.

### OpenAI cloud (default)

```bash
OPENAI_API_KEY=sk-proj-...
# OPENAI_BASE_URL unset
# OPENAI_MODEL=gpt-4o-mini   # or whatever model you have access to
```

### Local LLM

Point the SDK at a local server. Any OpenAI-compatible server works (llama.cpp's `llama-server`, Ollama, vLLM, LM Studio). See [../LOCAL_LLM.md](../LOCAL_LLM.md) for the full walkthrough.

```bash
OPENAI_API_KEY=sk-anything-the-server-doesnt-check
OPENAI_BASE_URL=http://localhost:8000/v1
OPENAI_MODEL=qwen3.5-4b
OPENAI_TIMEOUT_MS=30000
```

Local models are typically slower per call, so bump `OPENAI_TIMEOUT_MS` accordingly.

### No LLM (heuristic only)

Leave `OPENAI_API_KEY` unset. The NLQ endpoint still works; it falls back to `translateQueryHeuristicPublic`, which uses regex patterns for level / service detection and returns a `warnings: ["AI fallback mode active: heuristic interpretation was used."]` flag so the UI can surface that the AI path was skipped.

## Ingestion sources

Source types (from `backend/src/types/domain.ts`):

| Type         | Notes                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| `HTTP`       | The canonical ingest path, `POST /api/v1/ingest/:sourceId` with `X-API-Key`    |
| `SYSLOG_UDP` | RFC 5424 / 3164 over UDP, forwarded via fluentd or vector to the HTTP endpoint |
| `SYSLOG_TCP` | RFC 5424 / 3164 over TCP, same forwarding model                                |
| `FILEBEAT`   | Filebeat output via the HTTP / fluentd path                                    |
| `DOCKER`     | Docker logging driver via fluentd                                              |
| `CLOUDWATCH` | CloudWatch Logs subscription filter, forwarded to the HTTP endpoint            |

Reference compose configs:

- `deploy/fluentd/` for syslog, Docker, CloudWatch forwarders
- `deploy/vector/` for vector-based pipelines
- `deploy/docker-compose.logging.yml` to bring up the forwarder sidecar alongside the main stack

Sources are created per team via the API; each gets a UUID and an API key. The API key authenticates the `POST /ingest/:sourceId` calls.

## Tenancy modes

- `MULTI_TENANT=false` (default): a single team is created at bootstrap, all signups join it. Suitable for self-hosted single-team installs.
- `MULTI_TENANT=true`: each user can create teams, invite members, manage RBAC. Suitable for shared hosting.

`REGISTRATION_MODE` orthogonally controls whether new accounts can sign up at all (`open`), need an invite token (`invite-only`), or queue for admin approval (`approval`).

## Production deploy

For production with Traefik + Let's Encrypt, see [../DEPLOYMENT.md](../DEPLOYMENT.md). The short version:

```bash
cp .env.production.example .env.production
# edit .env.production
docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build
docker compose -f docker-compose.traefik.yml exec backend npx prisma migrate deploy
```
