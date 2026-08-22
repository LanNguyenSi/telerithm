# API

The full route reference is the OpenAPI 3 spec (`backend/src/api/openapi.ts`), served at `GET /openapi.json` and rendered at `GET /docs`. This page covers what the spec does not: rate limiting.

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
