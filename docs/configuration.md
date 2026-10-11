# Configuration

All configuration is environment-driven. The backend validates its env vars on startup with Zod (`backend/src/config/index.ts`); a missing or malformed value crashes the process with a precise error. `SEED_DEMO_DATA`, `WEBHOOK_HOST_ALLOWLIST` and `WEBHOOK_NAT64_ADDITIONAL_PREFIXES` are the exceptions: they are read directly where they are used and are not checked at startup.

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
| `CORS_ORIGINS`       | `http://localhost:3000`       | Comma-separated allowed origins. Ignored when `NODE_ENV=development`: the backend then accepts any origin with credentials |
| `MULTI_TENANT`       | `false`                       | `true`: users create teams. `false`: single-team mode                               |
| `REGISTRATION_MODE`  | `approval`                    | `open`, `invite-only`, `approval`                                                   |
| `ADMIN_EMAIL`        | unset                         | Email of the instance admin. The account registered with this address becomes active and gets the global `ADMIN` role even under `approval` or `invite-only`; without it, nobody can approve accounts in those modes. Addresses are not verified, so register this account yourself right after the first start |
| `OPENAI_API_KEY`     | unset                         | Enables LLM-backed NLQ. If unset, heuristic fallback is used                        |
| `OPENAI_BASE_URL`    | unset                         | OpenAI-compatible endpoint (Ollama, llama.cpp, vLLM). Defaults to OpenAI cloud. `docker-compose.traefik.yml` hardcodes it to Groq |
| `OPENAI_MODEL`       | `openai/gpt-oss-120b`         | Model name passed to the chat completions API                                       |
| `OPENAI_TIMEOUT_MS`  | `10000`                       | Per-call timeout in ms                                                              |
| `MAX_LOOKBACK_MS`    | `604800000` (7 days)          | Hard cap on query time range                                                        |
| `MAX_PAGE_SIZE`      | `500`                         | Max page size for log search. Accepted range 50 to 2000, but the request schema caps `limit` at 500, so only values below 500 change behaviour |
| `MAX_SYNC_RUNTIME_MS`| `1500`                        | Max wall time for facet, histogram and pattern requests before they return 202 and continue as a job |
| `SEED_DEMO_DATA`     | unset                         | Set to `true` to allow demo seeding when `NODE_ENV=production` (otherwise seeding is skipped in production) |
| `NOTIFICATION_TEST_RATE_LIMIT_WINDOW_MS` | `300000` (5 minutes) | Rate-limit window for `POST /subscriptions/:id/test`, see [api.md](api.md) |
| `NOTIFICATION_TEST_RATE_LIMIT_MAX`       | `5`                  | Max `POST /subscriptions/:id/test` requests per window, per caller               |
| `WEBHOOK_HOST_ALLOWLIST` | unset                     | Comma-separated hostnames. When set, webhook, Slack and Teams notifications are only delivered to these exact hosts (case-insensitive). Read at delivery time, not validated at startup |
| `WEBHOOK_NAT64_ADDITIONAL_PREFIXES` | unset          | Comma-separated /96-aligned NAT64 prefixes in canonical form ending in `::` (for example `64:ff9b:1::`). The SSRF guard also checks the IPv4 address embedded under these prefixes, in addition to `64:ff9b::/96`. Entries not ending in `::` are ignored |
| `TRUST_PROXY`        | unset (off)                   | Reverse-proxy trust for the IP-keyed rate limiters. Unset = trust no proxy. Accepts a non-negative integer hop count up to `10` (`1` = one proxy such as Traefik), `loopback`, or a comma-separated list of proxy IPs/CIDRs (IPv4 prefix `/8` or longer, IPv6 `/32` or longer). `true`, a hop count above `10`, any entry broader than these bounds (`0.0.0.0/0`, `::/0`) or containing the IPv4-mapped block (`::ffff:0:0/96`), and an IPv6 spelling Express cannot parse are rejected at startup; a hop count above the real number of proxies and a list of narrow ranges covering everything are not caught (exact rules in api.md). See [api.md](api.md#behind-a-reverse-proxy-trust_proxy) |

A starter file lives at `backend/.env.example`. Copy and edit:

```bash
cp backend/.env.example backend/.env
```

`npm run dev` (in `backend/`) loads `backend/.env` through Node's `--env-file-if-exists` flag, which needs Node 22.9 or newer (CI uses Node 22); variables already set in your shell take precedence over the file, and a missing file is skipped. The file is read once at start: `tsx watch` does not restart on `.env` edits, so restart the dev server after changing it. The server reads the file only in this dev mode: `npm start` (the built server) and the Docker images do not load it, so set the variables in the environment there (compose passes them in). Prisma CLI commands run from `backend/`, such as `npx prisma db push`, load `backend/.env` on their own.

## Frontend env vars

| Variable                   | Default                          | Description                |
| -------------------------- | -------------------------------- | -------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000/api/v1`   | Backend API base URL used by the browser. Read at build time: in the Docker images, pass it as a build argument |
| `INTERNAL_API_BASE_URL`    | unset, falls back to `NEXT_PUBLIC_API_BASE_URL` | Backend API base used by the Next.js server (server components, server actions), for example `http://backend:4000/api/v1` inside compose |

Copy from `frontend/.env.local.example`.

## AI provider configuration

The `AIService` uses the official `openai` SDK against any OpenAI-compatible endpoint.

### Traefik deployment (Groq)

`docker-compose.traefik.yml` hardcodes `OPENAI_BASE_URL=https://api.groq.com/openai/v1` for the backend and passes `OPENAI_MODEL` from the host environment, defaulting to `openai/gpt-oss-120b`. `OPENAI_API_KEY` must be a Groq key. When Groq retires the model, set `OPENAI_MODEL` in the deploy environment. To switch provider, edit the `OPENAI_BASE_URL` line in that file and set `OPENAI_MODEL` to a model of that provider.

### OpenAI cloud (default outside the Traefik compose)

```bash
OPENAI_API_KEY=sk-proj-...
# OPENAI_BASE_URL unset
OPENAI_MODEL=gpt-4o-mini   # required: the built-in default is a Groq model name
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

All logs arrive over HTTP at `POST /api/v1/ingest/:sourceId` with the source's `X-API-Key`. The body is `{ "logs": [...] }`; each entry is an object (`timestamp`, `level`, `service`, `host`, `message`, `fields`) or a raw string. Raw strings in RFC 5424 or RFC 3164 syslog, JSON or plain text are parsed, using the optional `format` field or auto-detection (`backend/src/validation/schemas.ts`, `backend/src/parser/log-parser.ts`).

A source's type (`HTTP`, `SYSLOG_UDP`, `SYSLOG_TCP`, `FILEBEAT`, `DOCKER`, `CLOUDWATCH`, from `backend/src/types/domain.ts`) is a label stored on the source. It does not change how logs arrive; the backend listens only on HTTP.

Senders that ship with the repository:

- `packages/sdk-js`, the JavaScript/TypeScript client SDK
- `packages/cli/logforge-pipe.sh`, which ships lines from stdin
- `scripts/collect-docker-logs.sh`
- `deploy/fluentd/` and `deploy/vector/`, reference forwarder configs that collect Docker container logs only
- `deploy/docker-compose.logging.yml` to bring up the forwarder sidecar alongside the main stack

Syslog, Filebeat and CloudWatch need a forwarder you configure yourself that posts batches in the `logs` envelope.

Sources are created per team via the API; each gets a UUID and an API key. The API key authenticates the `POST /ingest/:sourceId` calls.

## Tenancy modes

- `MULTI_TENANT=false` (default): a single `default` team is created when the first account becomes active, and every active account joins it (pending accounts join on approval). Suitable for self-hosted single-team installs.
- `MULTI_TENANT=true`: each user can create teams, invite members, manage RBAC. Suitable for shared hosting.

`REGISTRATION_MODE` orthogonally controls signup: `open` activates every new account, `approval` queues new accounts for admin approval, and `invite-only` blocks every signup except the `ADMIN_EMAIL` address. Invites (multi-tenant mode only) add an existing, logged-in account to a team; they do not create accounts, and no admin route creates accounts either.

## Notification channels

Users subscribe to alert incidents through `/api/v1/subscriptions`. A subscription belongs to one user and team, can be limited to one rule (`ruleId`) and to a set of severities, and names a channel and its `config`:

| Channel   | `config` keys                                   | Delivery |
| --------- | ----------------------------------------------- | -------- |
| `WEBHOOK` | `url`, optional `secret`                        | JSON `POST` to `url` |
| `SLACK`   | `webhook_url`                                   | Slack incoming webhook |
| `MSTEAMS` | `webhook_url`                                   | Microsoft Teams incoming webhook |
| `EMAIL`   | optional `email` (defaults to the user's address) | Not delivered: the backend only writes a log line, since no SMTP transport exists |

The webhook body carries `incidentId`, `ruleId`, `severity`, `status`, `message` and `createdAt`. When the subscription has a `secret`, each request carries `X-Telerithm-Signature: sha256=<hex>`, the hex HMAC-SHA256 of the raw request body keyed with the secret; compute the same value over the body you received and compare.

The webhook, Slack and Teams URLs pass an SSRF guard (`backend/src/services/notification/url-guard.ts`) when a subscription is created or updated and again before each send. It rejects schemes other than `http` and `https`, and hosts that resolve to private, loopback, link-local, unique-local, unspecified or cloud-metadata addresses. Redirects are not followed. `WEBHOOK_HOST_ALLOWLIST` and `WEBHOOK_NAT64_ADDITIONAL_PREFIXES` (see [Backend env vars](#backend-env-vars)) tighten or extend the guard.

Delivery makes up to three attempts per subscription, waiting 1 second and then 2 seconds between them. `POST /api/v1/subscriptions/:id/test` sends a test notification through the same path.

## Production deploy

For production with Traefik + Let's Encrypt, see [../DEPLOYMENT.md](../DEPLOYMENT.md). The short version:

```bash
cp .env.production.example .env.production
# edit .env.production
docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build
docker compose -f docker-compose.traefik.yml exec backend npx prisma db push
```

Only the variables referenced in the backend `environment:` block of `docker-compose.traefik.yml` reach the container: `POSTGRES_PASSWORD`, `TRUST_PROXY`, `LOG_LEVEL`, `REGISTRATION_MODE`, `ADMIN_EMAIL`, `OPENAI_API_KEY` and `OPENAI_MODEL`. To set any other backend variable from this page (for example `MULTI_TENANT` or `WEBHOOK_HOST_ALLOWLIST`), add a line for it to that block.

The compose file sets `TRUST_PROXY=1` for the backend (Traefik is the only hop between the internet and the backend on the production host, per the architecture in [../DEPLOYMENT.md](../DEPLOYMENT.md)). Set `TRUST_PROXY` in `.env.production` to override it, for example `2` when a CDN or another proxy sits in front of Traefik. Leaving it unset on a deployment that is behind a proxy puts every client in one rate-limit bucket. An empty value in `.env.production` still falls back to `1`; write `TRUST_PROXY=0` to disable it.
