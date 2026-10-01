# API

The full route reference is the OpenAPI 3 spec (`backend/src/api/openapi.ts`), served at `GET /openapi.json` and rendered at `GET /docs`. This page covers what the spec does not: an overview of the route groups, and rate limiting.

## Endpoints

All endpoints are under `/api/v1`. Bearer-token auth applies except `/ingest/*` (API key) and `/auth/*`. The table below is a sampling; the full surface is around 58 endpoints across the categories below. See `GET /openapi.json` for the complete spec.

| Method | Path                              | Description                       |
| ------ | --------------------------------- | --------------------------------- |
| `POST` | `/auth/register`, `/auth/login`   | Account creation, sign in         |
| `GET`  | `/teams`                          | Teams (CRUD, invites, members)    |
| `GET`  | `/sources`                        | Ingestion sources (CRUD)          |
| `POST` | `/ingest/:sourceId`               | Ingest logs (API key)             |
| `POST` | `/logs/search`                    | Search logs                       |
| `POST` | `/logs/facets`, `/logs/histogram`, `/logs/patterns` | Faceted search, timelines, pattern clustering |
| `GET`  | `/logs/views`                     | Saved views (CRUD, duplicate)     |
| `POST` | `/query/natural`                  | Translate NL to query plan        |
| `GET`  | `/stream/logs`                    | SSE live tail                     |
| `GET`  | `/alerts/rules`, `/alerts/incidents` | Alert rules + incidents        |
| `POST` | `/alerts/incidents/:id/acknowledge` | Incident workflow (ack, resolve, reopen) |
| `GET`  | `/dashboards/overview`            | Overview dashboard                |
| `GET`  | `/issues`, `/issues/:id`          | Grouped errors with assignment    |
| `GET`  | `/subscriptions`                  | Notification channels (CRUD)      |
| `GET`  | `/maintenance-windows`            | Maintenance windows               |
| `GET`  | `/admin/users`, `/admin/teams`    | Admin (Owner role)                |
| `GET`  | `/health`                         | Health check                      |

## Rate limiting

Every request passes through a global limiter first, then (for a few route groups) a second, more specific one. All limiters are per-process, in-memory counters (`express-rate-limit`'s default `MemoryStore`); see [architecture.md#rate-limiting](architecture.md#rate-limiting) for what that means for a multi-instance deployment.

| Route group                                     | Key              | Window (default) | Limit (default) | Env vars                                                          | Defined in |
| ------------------------------------------------ | ---------------- | ----------------- | ---------------- | ------------------------------------------------------------------ | ---------- |
| All routes (global)                               | Client IP        | 1 minute           | 200               | not configurable (hardcoded)                                       | `backend/src/app.ts` |
| `POST /api/v1/auth/register`, `POST /api/v1/auth/login` | Client IP  | 15 minutes         | 20                | not configurable (hardcoded)                                       | `backend/src/api/rest/router.ts` |
| `POST /api/v1/ingest/:sourceId`, `POST /api/v1/ingest/:sourceId/raw` | Client IP | 1 minute | 500 | not configurable (hardcoded)                                       | `backend/src/api/rest/router.ts` |
| `POST /api/v1/subscriptions/:id/test`             | Caller (resolved user id; unauthenticated requests get 401 before the limiter runs, so they never consume a bucket) | 5 minutes | 5 | `NOTIFICATION_TEST_RATE_LIMIT_WINDOW_MS`, `NOTIFICATION_TEST_RATE_LIMIT_MAX` | `backend/src/api/rest/router.ts` |
| Everything else (search, facets, teams, alerts, dashboards, `GET /api/v1/health`, `GET /metrics`, `GET /docs`, `GET /openapi.json`, ...) | Client IP (global limiter only) | 1 minute | 200 | not configurable (hardcoded) | `backend/src/app.ts` |

The global limiter (`app.use(rateLimit(...))` in `backend/src/app.ts`, mounted before routing) applies to every request the process handles, including `GET /metrics`, `GET /api/v1/health`, and `GET /openapi.json`: nothing is exempt from it. A route in one of the other rows sits behind both the global limiter and its own, stricter one; whichever trips first returns the 429.

"Client IP" in the table is `req.ip`. By default (`TRUST_PROXY` unset) that is the address of the socket peer, and an `X-Forwarded-For` header sent by a client is ignored, so it cannot change which bucket a request lands in. Behind a reverse proxy (the Traefik deployment) the peer is the proxy, so every client would share one bucket; set `TRUST_PROXY` to the number of proxy hops in front of the backend so `req.ip` becomes the real client address. See [Behind a reverse proxy](#behind-a-reverse-proxy-trust_proxy) below.

A request over the limit gets `429 Too Many Requests` with:

- A `Retry-After` header (integer seconds until the window resets).
- A JSON body: `{ "error": "<message>", "retryAfter": <integer seconds> }`.

### Why `/subscriptions/:id/test` gets its own limiter

`POST /api/v1/subscriptions/:id/test` dispatches a real notification through `NotificationDispatcher` on every call (see [architecture.md#alerting](architecture.md#alerting)) and is scoped to the caller's own subscriptions. Before this limiter, the route had no per-caller limit: the global limiter's 200/minute is shared across every request from an IP (all callers behind it, all routes), not a per-user budget for this one write path, so a single authenticated caller could still flood their own notification channel well within the global budget. The limiter is:

- **Keyed per user, not per session or IP.** The route requires auth already; a `requireAuthMiddleware` step resolves the caller's session to a user id and runs *before* the limiter, so:
  - an unauthenticated or invalid request gets `401` from that step and never reaches the limiter, so it never creates a bucket (closes an otherwise-unbounded key space: without auth resolved first, any caller-supplied bearer string would get its own budget for free);
  - two sessions of the same user (e.g. two logged-in devices) share one budget, since logging in again is cheap and must not multiply the budget;
  - one flooding user cannot exhaust a shared office IP's budget for other users, and a user cannot dodge their own limit by rotating IP.
- **Strict by default** (5 requests / 5 minutes): this is a "verify the channel is wired up" action, not a normal write path.
- **Configurable via env**, per the design constraint that a too-strict limit here should never require a code change to loosen: set `NOTIFICATION_TEST_RATE_LIMIT_WINDOW_MS` (milliseconds) and `NOTIFICATION_TEST_RATE_LIMIT_MAX` (requests per window) in the backend environment. Defaults live in `backend/src/config/index.ts` and are documented in [configuration.md](configuration.md).

### Global, ingest, and auth limiters (pre-existing)

The global, ingest, and auth limiters already existed before the per-user limiter above was added; this page documents their current, unchanged behavior rather than introducing them. All three are keyed by client IP (`express-rate-limit`'s default `keyGenerator`) and their limits are hardcoded, not env-configurable. Widening that to match the notification-test limiter's env-configurability is a reasonable follow-up but is out of scope here (see the docs-audit-followup-2 task this page was written for).

### Behind a reverse proxy (`TRUST_PROXY`)

The global, ingest, and auth limiters (and the notification-test limiter's unauthenticated fallback) key on `req.ip`. `TRUST_PROXY` is the opt-in setting that tells the backend which proxies to believe when it derives that address from `X-Forwarded-For`:

- **Unset (default): no proxy is trusted.** `req.ip` is the socket peer. A request carrying a forged `X-Forwarded-For` is keyed on the peer, not on the header. Behind a proxy this puts all clients in one bucket, and `express-rate-limit` logs `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` when it sees the header.
- **A hop count** (`1`, `2`, ...): trust that many proxies counted from the backend. `req.ip` is the address the outermost trusted proxy saw. `1` fits Traefik alone in front of the backend. Use `2` only if a CDN or another proxy sits in front of Traefik and Traefik is configured to trust it (its entrypoint `forwardedHeaders.trustedIPs`); a count larger than the real number of hops lets a client choose its own key.
- **`loopback`**, or a **comma-separated list of proxy IPs/CIDRs**: trust only those peers.
- **`true` is rejected at startup.** It trusts every `X-Forwarded-For` entry, so any client could pick its own rate-limit key. A value that is not one of the forms above also fails startup with an `Invalid configuration` error.

`docker-compose.traefik.yml` sets `TRUST_PROXY` to `1` (override with the `TRUST_PROXY` variable in the compose env file). See [configuration.md](configuration.md) for the full variable entry.

`GET /api/v1/health` is deliberately not exempt from the global limiter. The Docker healthcheck polls the backend directly on `localhost` with no `X-Forwarded-For`, so with `TRUST_PROXY` set it is keyed on the loopback address and a client exhausting its own bucket cannot starve it; exempting the route would instead let any caller hammer the Postgres, ClickHouse, and Redis pings without limit.
