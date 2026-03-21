# Telerithm

**AI-powered log analytics and debugging for self-hosted teams.**

Telerithm helps you understand what's happening in your systems. Instead of grepping through millions of log lines, ask questions in plain language and let AI surface the signal from the noise.

---

## Features

**Available now:**

- **Natural Language Search** - ask _"show me payment failures from the last hour"_ instead of writing SQL
- **Real-time Log Streaming** - SSE-based live tail for newly ingested logs
- **Multi-Source Ingestion** - HTTP, Syslog (UDP/TCP), Filebeat, Docker, CloudWatch
- **Alert Rules & Incidents** - threshold-based alerts with severity levels and incident lifecycle
- **Notification Channels** - Email, Webhook, Slack, Microsoft Teams
- **Error Grouping** - automatic issue fingerprinting with assignment workflow
- **Escalation Policies** - timed escalation steps with configurable notification channels
- **Maintenance Windows** - suppress alerts during scheduled downtime
- **Team Management** - multi-tenant with role-based access (Owner, Admin, Member, Viewer)
- **Invite System** - token-based team invites with optional email restriction
- **Admin API** - user management, team overview, system statistics
- **Self-Hosted First** - single-tenant default, optional multi-tenancy via config flag

**Planned:**

- **AI Root Cause Analysis** - automatic incident summarization with fix suggestions
- **AI Anomaly Detection** - pattern deviation alerts without manual threshold config
- **Log Pattern Clustering** - group similar log lines to reduce noise
- **Saved Queries & Dashboards** - custom dashboard builder with persistent views
- **RBAC for Sources** - per-source access control within teams
- **SSO / OIDC** - enterprise authentication providers
- **Retention Policies** - per-source configurable log retention
- **Metrics Export** - Prometheus endpoint for operational monitoring
- **CLI Tool** - `telerithm` command for local debugging and log tailing

---

## Quick Start

### Docker Compose (recommended)

```bash
make init
```

This starts the full stack:

| Service    | URL                  |
|------------|----------------------|
| Frontend   | http://localhost:3000 |
| Backend    | http://localhost:4000 |
| PostgreSQL | localhost:5432        |
| ClickHouse | localhost:8123        |
| Redis      | localhost:6379        |

```bash
make logs    # follow container logs
make down    # stop everything
```

### Manual Setup

**Backend:**

```bash
cd backend
cp .env.example .env    # adjust DATABASE_URL, CLICKHOUSE_URL as needed
npm install
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

**Frontend:**

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

---

## Configuration

Key environment variables for the backend (`.env`):

| Variable         | Default                  | Description                                      |
|------------------|--------------------------|--------------------------------------------------|
| `PORT`           | `4000`                   | API server port                                  |
| `DATABASE_URL`   | *required*               | PostgreSQL connection string                     |
| `CLICKHOUSE_URL` | *required*               | ClickHouse connection string                     |
| `REDIS_URL`      | `redis://localhost:6379` | Redis connection string                          |
| `MULTI_TENANT`   | `false`                  | `true`: users create teams. `false`: single team |
| `CORS_ORIGINS`   | `http://localhost:3000`  | Allowed CORS origins                             |
| `LOG_LEVEL`      | `info`                   | fatal, error, warn, info, debug, trace           |

---

## Architecture

```
frontend/          Next.js 15, server components, Tailwind CSS
backend/           Express, TypeScript, Prisma ORM
  ├── api/         REST endpoints + OpenAPI spec
  ├── ingestion/   Log parsing and storage pipeline
  ├── services/    Business logic (team, alert, query, notification, ...)
  ├── prisma/      Database schema and migrations
  └── tests/       Integration tests (Vitest)
packages/
  └── sdk-js/      JavaScript/TypeScript client SDK
```

**Stack:** Node.js · Express · Prisma · PostgreSQL · ClickHouse · Redis · Next.js · Tailwind CSS

---

## Ingesting Logs

Send logs to any configured source via the HTTP ingest endpoint:

```bash
curl -X POST http://localhost:4000/api/v1/ingest/<sourceId> \
  -H "X-API-Key: <apiKey>" \
  -H "Content-Type: application/json" \
  -d '{
    "logs": [
      {
        "level": "error",
        "service": "payment",
        "message": "Payment authorization failed for order 4721",
        "fields": { "status_code": 502, "amount": 189.50 }
      }
    ]
  }'
```

Or use the [JavaScript SDK](./packages/sdk-js):

```typescript
import { init, log } from "@telerithm/sdk";

init({ endpoint: "http://localhost:4000/api/v1", apiKey: "lf_..." });

log.error("Payment authorization failed", {
  service: "payment",
  fields: { orderId: 4721, statusCode: 502 },
});
```

---

## API Overview

All endpoints are under `/api/v1`. Auth endpoints use Bearer tokens.

| Method   | Path                         | Description            |
|----------|------------------------------|------------------------|
| `POST`   | `/auth/register`             | Create account         |
| `POST`   | `/auth/login`                | Sign in                |
| `GET`    | `/teams`                     | List user's teams      |
| `POST`   | `/teams`                     | Create team            |
| `POST`   | `/teams/:id/invites`         | Create team invite     |
| `POST`   | `/invites/:token/accept`     | Accept invite          |
| `POST`   | `/ingest/:sourceId`          | Ingest logs (API key)  |
| `POST`   | `/logs/search`               | Search logs            |
| `POST`   | `/query/natural`             | Natural language query  |
| `GET`    | `/stream/logs`               | SSE live tail          |
| `GET`    | `/alerts/rules`              | List alert rules       |
| `GET`    | `/alerts/incidents`          | List incidents         |
| `GET`    | `/issues`                    | List grouped errors    |
| `GET`    | `/admin/users`               | Admin: list users      |
| `GET`    | `/admin/stats`               | Admin: system stats    |
| `GET`    | `/health`                    | Health check           |

Full OpenAPI spec available at `GET /api/v1/openapi.json`.

---

## Production Deployment

For production deployment with Traefik and SSL, see [DEPLOYMENT.md](./DEPLOYMENT.md).

Quick deploy to VPS with Traefik:
```bash
cp .env.production.example .env.production
# Edit .env.production with your secrets
docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build
docker compose -f docker-compose.traefik.yml exec backend npx prisma migrate deploy
```

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions and guidelines.

```bash
# Run backend tests
cd backend && npm test

# Type check
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit
```

---

## License

[MIT](./LICENSE)
