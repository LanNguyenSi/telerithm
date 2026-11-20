# API

The OpenAPI 3 spec (`backend/src/api/openapi.ts`, served at `GET /openapi.json` and rendered at `GET /docs`) covers the health, auth, team, source, ingest, log search, saved-view, NLQ, alert-rule and incident-list, dashboard and streaming routes. Subscriptions, issues, maintenance windows, incident actions and the incident timeline, rule mute and unmute, invites, admin routes, `GET /auth/settings`, `POST /ingest/:sourceId/raw` and `GET /logs/:id` are not in the spec yet; this page lists them. It also covers rate limiting.

## Endpoints

All endpoints are under `/api/v1`. Bearer-token auth applies except `/health`, `/auth/register`, `/auth/login`, `/auth/settings` (no auth) and `/ingest/*` (API key); `/stream/logs` also accepts a one-time `?ticket=` from `POST /stream/ticket` in place of the header (see Live tail below); the session token itself is not accepted in the URL.

| Method | Path                              | Description                       |
| ------ | --------------------------------- | --------------------------------- |
| `POST` | `/auth/register`, `/auth/login`   | Account creation, sign in         |
| `POST` | `/auth/logout`                    | Sign out: deletes the session of the presented token and answers `204`, other sessions of the user stay. Bearer auth; a missing, expired or unknown token gets `401` |
| `GET`  | `/auth/settings`                  | Registration mode (no auth)       |
| `GET`  | `/auth/me`                        | The caller as the database has them: `{ "user": { id, email, name, role, status } }` with `Cache-Control: no-store`. The frontend reads the instance role from here for its admin pages; a missing, expired or unknown token, or a user who is not `ACTIVE`, gets `401` |
| `GET`, `POST` | `/teams`                   | Teams (list, create)              |
| `POST`, `GET` | `/teams/:id/invites`       | Create and list team invites      |
| `POST` | `/invites/:token/accept`          | Accept an invite (logged-in user) |
| `DELETE` | `/invites/:id`                  | Revoke an invite (OWNER, ADMIN). Any other caller, a non-member or a member without the manage role, gets the same 404 as for an unknown id |
| `GET`, `POST` | `/sources`                 | Ingestion sources (list, create); the list carries a masked `keyHint` (for example `lf_****a7c1`) only for OWNER and ADMIN and never the full `apiKey`, the create response shows the full key once to the creator, with `Cache-Control: no-store` |
| `PUT`  | `/sources/:id`                    | Rename a source (OWNER, ADMIN, MEMBER; VIEWER gets 403). The response carries `keyHint` for OWNER and ADMIN, never `apiKey` |
| `DELETE` | `/sources/:id`                  | Delete a source (OWNER, ADMIN; others get 403). Removes the row and invalidates its key at once; stored logs stay until the 30-day retention expires |
| `POST` | `/sources/:id/rotate-key`         | Replace a source's ingest key (OWNER, ADMIN; others get 403). The old key is rejected at once, no grace window; the response carries the new `apiKey` with `Cache-Control: no-store` |
| `POST` | `/sources/:id/reveal`             | Read a source's full ingest key as `{ "apiKey" }` with `Cache-Control: no-store` on every answer of the handler (OWNER, ADMIN; others get 403, an unknown or foreign id gets 404). Every successful call logs one audit line with source, team and user, never the key |
| `POST` | `/ingest/:sourceId`, `/ingest/:sourceId/raw` | Ingest logs (API key)             |
| `POST` | `/logs/search`                    | Search logs (also `GET /logs`)    |
| `GET`  | `/logs/:id`                       | One log entry                     |
| `POST` | `/logs/context`                   | Surrounding log lines             |
| `POST` | `/logs/facets`, `/logs/histogram`, `/logs/patterns` | Faceted search, timelines, pattern clustering |
| `GET`  | `/query/jobs/:id`                 | Result of an async facet, histogram or pattern job |
| `GET`, `POST`, `PUT`, `DELETE` | `/logs/views`, `/logs/views/:id` | Saved views (list, create, update, delete); update and delete of a teammate's private view get the same 404 as an unknown id |
| `POST` | `/logs/views/:id/duplicate`       | Duplicate a saved view; a teammate's private view gets the same 404 as an unknown id |
| `POST` | `/query/natural`                  | Translate NL to query plan        |
| `POST` | `/stream/ticket`                  | One-time ticket for `/stream/logs`; body `{ "teamId" }`, any team role may ask, answer `201` `{ "ticket", "expiresInSeconds": 60 }` with `Cache-Control: no-store` (see Live tail below) |
| `GET`  | `/stream/logs`                    | SSE live tail; authenticated by the `Authorization` header or a one-time `?ticket=`; closed by the server within 15 seconds once the user is no longer `ACTIVE` or no longer a member of the team; at most `MAX_STREAMS_PER_USER` (default 5) open streams per user and backend process, the next one answers `429` (see Live tail below) |
| `GET`, `POST` | `/alerts/rules`            | Alert rules (list, create)        |
| `PUT`, `DELETE` | `/alerts/rules/:id`      | Update (partial), delete an alert rule |
| `POST` | `/alerts/rules/:id/mute`, `/alerts/rules/:id/unmute` | Mute and unmute a rule |
| `GET`  | `/alerts/incidents`               | Alert incidents (list)            |
| `POST` | `/alerts/incidents/:id/acknowledge`, `/resolve`, `/reopen` | Incident workflow |
| `GET`  | `/alerts/incidents/:id/timeline`  | Incident event timeline           |
| `GET`  | `/dashboards/overview`            | Overview dashboard                |
| `GET`  | `/issues`, `/issues/:id`          | Grouped errors                    |
| `PUT`  | `/issues/:id`                     | Update an issue (status, assignment) |
| `GET`, `POST` | `/subscriptions`           | Notification subscriptions (list, create) |
| `PUT`, `DELETE` | `/subscriptions/:id`     | Update, delete a subscription     |
| `POST` | `/subscriptions/:id/test`         | Send a test notification          |
| `GET`, `POST` | `/maintenance-windows`     | Maintenance windows (list, create) |
| `DELETE` | `/maintenance-windows/:id`      | Delete a maintenance window       |
| `GET`  | `/admin/users`, `/admin/teams`, `/admin/teams/:id/members`, `/admin/stats` | Admin listings |
| `PUT`, `POST`, `DELETE` | `/admin/users/:id`, `/admin/users/:id/approve`, `/admin/users/:id/add-to-team`, `/admin/users/:id/remove-from-team/:teamId`, `/admin/teams/:id/members/:userId` | Admin user and membership changes. `PUT /admin/users/:id` that leaves the user not `ACTIVE` (disabled, or set to `PENDING`) deletes all of that user's sessions; both member-removal routes also delete the removed member's subscriptions of that team |
| `GET`  | `/health`                         | Health check                      |

The `/admin/*` routes need the instance admin (global `ADMIN` user role, given to the `ADMIN_EMAIL` account at signup; team roles do not apply).

There are two role systems: the instance role (`USER` or `ADMIN`) gates `/admin/*`, and the team role (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`) gates team-scoped routes.

### Ingest request bodies

`POST /ingest/:sourceId` takes `Content-Type: application/json` and answers `202` with `{ accepted, rejected, errors, batchId }`. The body is `{ "logs": [...] }`; a bare JSON array of the same entries is accepted too, because forwarders such as Fluentd and Vector can only post an array. An empty `logs` array, or one entry that fails validation (for example an unknown `level`), answers `400` for the whole batch. The cap is on the parsed entry count: the `logs` array holds at most `1000` elements (`MAX_INGEST_BATCH`, `backend/src/validation/schemas.ts`) and a larger array answers `400` like any other validation failure, while a request whose entries expand past `1000` when parsed (a raw string entry is parsed as JSON when it starts with `[` or `{`, and a JSON array expands to one entry per element) answers `413` with `{ "error": "..." }` naming the limit and nothing is inserted.

`POST /ingest/:sourceId/raw` takes `Content-Type: text/plain` (any `text/*` type, with or without a `charset`). Each line of the body is one log line: `\n` and `\r\n` both end a line, blank lines are skipped, and every line is parsed like a string entry in `logs` (the format is auto-detected). It answers `202` with the same body as above, `400 Empty body` when no line is left, `413` (same body as above) when the body holds more than `1000` lines, the same limit applied one entry per line (the body limit itself is 10 MB), and `415` for any other content type, JSON included. `curl -d` sends `application/x-www-form-urlencoded` by default, so pass `-H "Content-Type: text/plain"` and `--data-binary`:

```bash
curl -X POST http://localhost:4000/api/v1/ingest/$SOURCE_ID/raw \
  -H "X-API-Key: $API_KEY" -H "Content-Type: text/plain" \
  --data-binary $'first line\nsecond line'
```

Both routes answer `401` without an `X-API-Key` header and `403` for a wrong key or a key that belongs to another source.

### Incident actions

An incident is `OPEN`, `ACKNOWLEDGED` or `RESOLVED`. The actions only apply from these states:

| Action | Allowed from | Result |
| ------ | ------------ | ------ |
| `acknowledge` | `OPEN` | `ACKNOWLEDGED` |
| `resolve` | `OPEN`, `ACKNOWLEDGED` | `RESOLVED` |
| `reopen` | `RESOLVED`, `ACKNOWLEDGED` | `OPEN` |

Any other combination answers `409` with a message such as `Cannot acknowledge an incident that is RESOLVED; acknowledge applies to OPEN incidents`, and writes nothing (no status change, no timeline event). `409` is also the answer when another request changed the status between the check and the write. An unknown id answers `404`, and so does an incident of a team the caller does not belong to (same body), so the answer does not reveal whether an id exists. A member of the incident's team without write access (`VIEWER`) gets `403`.

The by-id read routes follow the same rule: `GET /issues/:id`, `GET /alerts/incidents/:id/timeline` and `GET /query/jobs/:id` answer a caller who is not a member of the owning team with the `404` and the body they give for an unknown id (`Issue not found`, `Incident not found`, `Job not found`), and so does `DELETE /invites/:id` (`Invite not found`). A member of the invite's team who may not manage invites gets the same `404` and body (`Invite not found`), so the status does not reveal inside a team either whether an invite exists. If the membership lookup itself fails, the route answers `500`, never `403` or `404`.

### Sessions

`POST /auth/login` and `POST /auth/register` (when it signs the user in) return a `sess_` token that is valid for 7 days. Every authenticated request checks on each call that the token exists, has not expired and that its user is `ACTIVE`; otherwise the answer is `401`. So disabling a user locks out their tokens on the next request. A `/stream/logs` connection that is already open is checked again on each 15-second heartbeat (the session, which a ticket-opened stream keeps by its id, the user status and membership of the stream's team) and is closed by the server at the first heartbeat after the check fails, so it can keep delivering for up to 15 seconds after the user is disabled or removed from the team; a heartbeat check that fails because of a database error does not close it. Re-enabling the user does not revive them (the rows are deleted when the user is disabled): the user logs in again. `POST /auth/logout` ends one session; the frontend calls it before it clears its cookies and clears them even when the call fails.

### Live tail

`EventSource`, which a browser uses for server-sent events, cannot send an `Authorization` header, and the session token must not travel in a URL (proxy and access logs, browser history). So a browser asks for a ticket first and opens the stream with it:

1. `POST /stream/ticket` with the bearer header and `{ "teamId": "..." }` (a member of any role; a non-member gets `403`) answers `201` `{ "ticket": "...", "expiresInSeconds": 60 }`.
2. `GET /stream/logs?teamId=...&ticket=...` opens the stream. The ticket is 32 random bytes, valid for 60 seconds and consumed by its first use, whether or not the stream opens, so the second use (or a use after 60 seconds, a ticket for another team than `teamId`, or an unknown ticket) answers `401 {"error":"Unauthorized"}` with the same body for all of them. Ask for a new ticket before every connection, reconnects included: an `EventSource` reconnects on its own with the old URL, which the server then refuses, so the frontend closes the source on an error and fetches a new ticket.

A ticket is bound to the session it was issued for, that session's user and one team; it opens that team's stream and no other. The server stores only the SHA-256 hash of the ticket, in Redis with a 60-second expiry (so every backend instance accepts a ticket another one issued; if Redis evicts or loses the entry, the stream answers `401` and the client asks again). The heartbeat re-check applies to a ticket-opened stream as well: it ends at the first heartbeat after the session is deleted, the user stops being `ACTIVE` or the user leaves the team.

Clients that can set headers (curl, a server-side consumer) keep sending `Authorization: Bearer <token>` to `/stream/logs`; when both a header and a ticket are present, the header decides and the ticket is not consumed. The earlier `?token=<session token>` query parameter is no longer accepted: no client in this repository used it (the frontend was the only one), and keeping it would keep the token in URLs. Both `ticket` and `token` query values are replaced by `REDACTED` in the backend access log.

### Live tail stream cap

One user may hold at most `MAX_STREAMS_PER_USER` open `/stream/logs` streams at once (default 5; see [configuration.md](configuration.md)), whether they were opened with the header or with a ticket and whichever team they follow. The next request answers `429 {"error":"Too many open live tail streams"}` as JSON, with no stream headers, and opens nothing. The check comes after the credentials and the team membership, so a request that answers `401` or `403` does not count. A stream gives its slot back when the client disconnects, when the connection fails and when the server ends it at a failed heartbeat check; a client that leaves while the server is still checking its credentials never takes one. The counter is per backend process and in memory: with several backend replicas the effective cap per user is `MAX_STREAMS_PER_USER` times the number of replicas, and a restart resets it. The frontend does not show the `429` separately: like any stream error it closes the source and reconnects with a backoff of 1 to 30 seconds.

### Subscription channels

`channel` is `WEBHOOK`, `SLACK` or `MSTEAMS`. `POST /subscriptions` and `PUT /subscriptions/:id` answer `400` for `EMAIL` (`EMAIL subscriptions are not supported yet because no email transport is configured; ...`) because the backend has no mail transport. Existing `EMAIL` subscriptions are not migrated: they stay listed and can be updated (leave `channel` out of the body), tested and deleted, and delivery for them only writes a log line.

A `ruleId` in the `POST /subscriptions` body must be a rule of the body's `teamId`. A rule of another team and a nonexistent rule give the same `404` `Alert rule not found`, so the answer does not reveal whether an id exists. A caller who is not a member of `teamId` gets `403` first, before any rule lookup. `GET /subscriptions` returns `rule: null` for a subscription whose rule belongs to another team (such rows predate this check and are not migrated); the row stays listed and can be deleted.

### Log search page size

`limit` on the search requests is 1 to 500 (default 100). `MAX_PAGE_SIZE` can lower that maximum (50 to 500) but not raise it (a larger value is clamped to 500 with a startup warning); see [configuration.md](configuration.md).

### Log search input limits

The search inputs are bounded (the maxima are named constants in `backend/src/constants/search.ts`, and a request over any of them answers `400`):

| Input | Maximum | Applies to |
| ----- | ------- | ---------- |
| `query` | 2000 characters | `POST /logs/search`, `GET /logs`, `POST /logs/facets`, `/logs/histogram`, `/logs/patterns`, `POST /query/natural` |
| `filters` | 100 entries | the same search routes |
| filter `field` | 200 characters | every filter |
| filter `value` (string) | 2000 characters | every filter (the number branch is not length-limited) |
| distinct search tokens in `query` | 64 | the five log-search routes, when `queryType` is `sql` (the default); not applied to `queryType: "natural"` and not to `POST /query/natural`, whose `query` is only length-capped |

The token maximum is checked per distinct token, because every token becomes its own `ILIKE` group in the generated SQL: the query is split on whitespace, lowercased, every character outside `[a-z0-9_-]` is removed, tokens shorter than 2 characters are dropped and repeats count once. Exceeding it answers `400` with `{ "error": "query is limited to 64 search terms" }` instead of truncating.

Saved-view definitions are checked against what replaying them as a search sends, so a saved view can never hold more than a search accepts: `text` is at most 2000 characters and at most 64 distinct search tokens (counted as above), `filters`, `facets` and `exclusions` are each at most 100 entries with the field and value length caps above, and `facets` plus `exclusions` plus the level (`eq`), service (`contains`) and host (`contains`) filters of `filters` that the replay turns into form filters (the first matching entry of each, when its value is non-empty; other `filters` entries are not replayed) may total at most 100. A definition over any of these answers `400` with the usual validation-error shape.

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

Browser calls other than the live tail stream reach the backend through the frontend's `/bff` proxy, so their socket peer is the frontend container. The proxy forwards exactly one `X-Forwarded-For` value, the rightmost entry of the header it received (the one Traefik appended), and none when the header is absent or that entry is not an IP address; with `TRUST_PROXY=1` (one hop, the frontend or Traefik) `req.ip` is that client address. Server-side calls of the frontend send no such header and share the frontend container's bucket. This relies on the frontend being reachable only through Traefik: a caller that reaches the frontend directly sets the header itself and so chooses its rate-limit key. Outside that setup the consequence differs: with `TRUST_PROXY` unset (the standalone `docker-compose.prod.yml`, which publishes ports 3000 and 4000 and sets no `TRUST_PROXY`) the backend ignores the forwarded value, so every browser API call except the live tail stream lands in the frontend container's one bucket of 200 per minute; setting `TRUST_PROXY=1` there instead lets any caller of port 3000 choose its own key, because nothing in front of the frontend replaces the header.

A request over the limit gets `429 Too Many Requests` with:

- A `Retry-After` header (integer seconds until the window resets).
- A JSON body `{ "error": "<message>" }`. Only `POST /api/v1/subscriptions/:id/test` adds `"retryAfter": <integer seconds>`; on every other route, read the `Retry-After` header.

### Why `/subscriptions/:id/test` gets its own limiter

`POST /api/v1/subscriptions/:id/test` dispatches a real notification through `NotificationDispatcher` on every call (see [architecture.md#alerting](architecture.md#alerting)) and is scoped to the caller's own subscriptions. Before this limiter, the route had no per-caller limit: the global limiter's 200/minute is shared across every request from an IP (all callers behind it, all routes), not a per-user budget for this one write path, so a single authenticated caller could still flood their own notification channel well within the global budget. The limiter is:

- **Keyed per user, not per session or IP.** The route requires auth already; a `requireAuthMiddleware` step resolves the caller's session to a user id and runs *before* the limiter, so:
  - an unauthenticated or invalid request gets `401` from that step and never reaches the limiter, so it never creates a bucket (closes an otherwise-unbounded key space: without auth resolved first, any caller-supplied bearer string would get its own budget for free);
  - two sessions of the same user (e.g. two logged-in devices) share one budget, since logging in again is cheap and must not multiply the budget;
  - one flooding user cannot exhaust a shared office IP's budget for other users, and a user cannot dodge their own limit by rotating IP.
- **Strict by default** (5 requests / 5 minutes): this is a "verify the channel is wired up" action, not a normal write path.
- **Configurable via env**, per the design constraint that a too-strict limit here should never require a code change to loosen: set `NOTIFICATION_TEST_RATE_LIMIT_WINDOW_MS` (milliseconds) and `NOTIFICATION_TEST_RATE_LIMIT_MAX` (requests per window) in the backend environment. Defaults live in `backend/src/config/index.ts` and are documented in [configuration.md](configuration.md).

### Global, ingest, and auth limiters (pre-existing)

The global, ingest, and auth limiters already existed before the per-user limiter above was added; this page documents their current, unchanged behavior rather than introducing them. All three are keyed by client IP (`express-rate-limit`'s default `keyGenerator`) and their limits are hardcoded, not env-configurable. Widening that to match the notification-test limiter's env-configurability is a reasonable follow-up but is out of scope here.

### Behind a reverse proxy (`TRUST_PROXY`)

The global, ingest, and auth limiters (and the notification-test limiter's unauthenticated fallback) key on `req.ip`. `TRUST_PROXY` is the opt-in setting that tells the backend which proxies to believe when it derives that address from `X-Forwarded-For`:

- **Unset (default): no proxy is trusted.** `req.ip` is the socket peer. A request carrying a forged `X-Forwarded-For` is keyed on the peer, not on the header. Behind a proxy this puts all clients in one bucket, and `express-rate-limit` logs `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` when it sees the header.
- **A hop count** (`1`, `2`, ... up to `10`): trust that many proxies counted from the backend. `req.ip` is the address the outermost trusted proxy saw. `1` fits Traefik alone in front of the backend, which is the production setup (no CDN or other proxy in front of Traefik). Use `2` only if a CDN or another proxy sits in front of Traefik and Traefik is configured to trust it (its entrypoint `forwardedHeaders.trustedIPs`); a count larger than the real number of hops lets a client choose its own key. `10` is the upper bound: no deployment has more proxies than that, and a larger number would only be a way to trust every hop. Non-integers, negative numbers and counts above `10` fail startup.
- **`loopback`**, or a **comma-separated list of proxy IPs/CIDRs**: trust only those peers. Ranges must be narrow: an IPv4 prefix shorter than `/8` and an IPv6 prefix shorter than `/32` are rejected, and so is any IPv6 range that contains the IPv4-mapped block `::ffff:0:0/96` (for example `::/32` or `::ffff:0:0/96`), because Express compares an IPv4 peer against IPv6 ranges in that form and would trust every IPv4 address. A mapped range such as `::ffff:10.0.0.0/104` is read as the IPv4 range of prefix length minus 96 and follows the `/8` bound. A list that is not narrow enough to be a set of proxies is an operator choice this check cannot judge; keep it to the proxy addresses.
- **`true` is rejected at startup**: it trusts every `X-Forwarded-For` entry, so any client could pick its own rate-limit key. The values with the same effect that the bounds catch are rejected too: a hop count above `10`, and any entry broader than the bounds or containing the IPv4-mapped block (`0.0.0.0/0`, `::/0`, each entry of `0.0.0.0/1,128.0.0.0/1`, `::ffff:0:0/96`). A list of narrow ranges that together cover everything, and a hop count above the real number of proxies, are not caught (see the bounds above). The error names the rejected value and the rule. A value that is not one of the forms above, including an IPv6 spelling Express cannot parse (such as `::1.2.3.4`), also fails startup with an `Invalid configuration` error.

`docker-compose.traefik.yml` sets `TRUST_PROXY` to `1` (override with the `TRUST_PROXY` variable in the compose env file). Two limits of that default:

- The compose line is `${TRUST_PROXY:-1}`, so an empty `TRUST_PROXY=` in the env file still falls back to `1`. To turn trust off in that compose file, set `TRUST_PROXY=0` (a hop count of zero trusts nothing).
- Other containers on the shared external `traefik` network can reach the backend directly, and with a hop count they could choose their own key by sending `X-Forwarded-For`. Trusting the Traefik network as a CIDR list (the subnet that `docker network inspect traefik` reports) only narrows this to peers on that network, which is exactly the set in question, so it does not close it. Closing it means trusting Traefik's own address only: give Traefik a static `ipv4_address` on the `traefik` network and list that one IP, or put the backend on a network it shares with Traefik alone. Such a list must also contain the frontend container's address on every network it shares with the backend (`traefik` and `telerithm-internal`; Docker DNS may resolve `backend` on either, so confirm the peer in the backend's request log): the `/bff` proxy is the socket peer of every browser API call except the live tail stream, and without it in the list the backend ignores the forwarded value and all `/bff` traffic shares the frontend's one bucket. The hop count is the default because it needs no knowledge of the Docker network.

`GET /api/v1/health` is deliberately not exempt from the global limiter. The Docker healthcheck polls the backend directly on `localhost` with no `X-Forwarded-For`, so with `TRUST_PROXY` set it is keyed on the loopback address and a client exhausting its own bucket cannot starve it; exempting the route would instead let any caller hammer the Postgres, ClickHouse, and Redis pings without limit.
