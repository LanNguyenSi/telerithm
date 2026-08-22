# API

The full route reference is the OpenAPI 3 spec (`backend/src/api/openapi.ts`), served at `GET /openapi.json` and rendered at `GET /docs`. This page covers what the spec does not: rate limiting.

## Rate limiting

Every REST route sits behind one of three rate limiters, or none. All of them are per-process, in-memory counters (`express-rate-limit`'s default `MemoryStore`); see [architecture.md#rate-limiting](architecture.md#rate-limiting) for what that means for a multi-instance deployment.

| Route group                                     | Key              | Window (default) | Limit (default) | Env vars                                                          |
| ------------------------------------------------ | ---------------- | ----------------- | ---------------- | ------------------------------------------------------------------ |
| `POST /auth/register`, `POST /auth/login`         | Client IP        | 15 minutes         | 20                | not configurable (hardcoded)                                       |
| `POST /ingest/:sourceId`, `POST /ingest/:sourceId/raw` | Client IP        | 1 minute           | 500               | not configurable (hardcoded)                                       |
| `POST /subscriptions/:id/test`                    | Caller (bearer token; falls back to client IP if unauthenticated) | 5 minutes | 5 | `NOTIFICATION_TEST_RATE_LIMIT_WINDOW_MS`, `NOTIFICATION_TEST_RATE_LIMIT_MAX` |
| Everything else (search, facets, teams, alerts, dashboards, health, metrics, docs, ...) | n/a | n/a | none | n/a |

A request over the limit gets `429 Too Many Requests` with:

- A `Retry-After` header (integer seconds until the window resets).
- A JSON body: `{ "error": "<message>", "retryAfter": <integer seconds> }`.

### Why `/subscriptions/:id/test` gets its own limiter

`POST /subscriptions/:id/test` dispatches a real notification through `NotificationDispatcher` on every call (see [architecture.md#alerting](architecture.md#alerting)), is scoped to the caller's own subscriptions, and (unlike the auth and ingest limiters, which predate this route's coverage) has no other write-frequency limit anywhere in the request path. Without a limiter, an authenticated caller could flood their own notification channel by looping the request. The limiter is:

- **Keyed per caller, not per IP.** The route requires auth already; keying by the raw bearer token means one flooding user cannot exhaust a shared office IP's budget for other users, and a user cannot dodge their own limit by rotating IP.
- **Strict by default** (5 requests / 5 minutes): this is a "verify the channel is wired up" action, not a normal write path.
- **Configurable via env**, per the design constraint that a too-strict limit here should never require a code change to loosen: set `NOTIFICATION_TEST_RATE_LIMIT_WINDOW_MS` (milliseconds) and `NOTIFICATION_TEST_RATE_LIMIT_MAX` (requests per window) in the backend environment. Defaults live in `backend/src/config/index.ts` and are documented in [configuration.md](configuration.md).

### Ingest and auth limiters (pre-existing)

The ingest and auth limiters already existed before this rate-limiting pass; this page documents their current, unchanged behavior rather than introducing them. Both are keyed by client IP (`express-rate-limit`'s default `keyGenerator`) and their limits are hardcoded, not env-configurable. Widening that to match the notification-test limiter's env-configurability is a reasonable follow-up but is out of scope here (see the docs-audit-followup-2 task this page was written for).

### Exempt routes

Health (`GET /health`), metrics (`GET /metrics`), and the API docs (`GET /docs`, `GET /openapi.json`) have never had a rate limiter and still don't: none of them are user-write paths, and rate-limiting a health check would risk the health check itself flapping under load.
