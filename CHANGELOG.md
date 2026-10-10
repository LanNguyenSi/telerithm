# Changelog — Telerithm app suite

All notable changes to the Telerithm backend + frontend are
documented in this file. The SDK has its own changelog under
[`packages/sdk-js/CHANGELOG.md`](./packages/sdk-js/CHANGELOG.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).
App-suite releases are tagged on the parent repo as `vX.Y.Z`.

> **Note**: The backend and frontend are not published as npm
> packages — they are private apps deployed via deploy-panel from
> `master`. App-suite tags are deploy provenance, not consumable
> artefacts.

## [Unreleased]

### Security

- **Log views: MEMBER and VIEWER can no longer edit, unshare, clear the default of, or delete a view that is already shared or default**, even when they own it (task 9edca718). `PUT` and `DELETE /api/v1/logs/views/:id` answer 403 with no mutation, judged on the loaded view; private non-default views stay with their owner. Shared or default views owned by non-admins are not migrated and are now managed by an OWNER or ADMIN, who can change and delete any default view in their team, including a private default view owned by another user.
- Fleet audit workflow: the raw `npm audit` output of the runtime moderate gate step is printed between a per-run random `::stop-commands::` token and its resume line, so registry-supplied text cannot act as a workflow command (task da9631f4). Gate exit codes unchanged.
- **next 15.5.27** (GHSA-mcj8-r9mp-w47p, GHSA-4jqv-mc3x-m676) in `frontend/`: the lockfile resolves 15.5.27 with its matching `@next/env` and `@next/swc-*` packages and the `next` dependency floor is now `^15.5.27`.
- **sharp 0.35.5** (GHSA-wq5f-xc86-pv6w, task aff72e2b), in `frontend/`, installed through `next`: the lockfile resolves 0.35.5 with matching `@img/*` binaries and the `sharp` override floor is now `^0.35.5`.

### Added

- NLQ retry ownership tests also pin a persistent HTTP 503 (3 attempts, the
  app loop retries `server` errors) and HTTP 408 / 409 (1 attempt each, they
  classify as `unknown` and are not retried) (task 9c7a5039).

### Fixed

- NLQ LLM error classification: connection and timeout errors from the
  OpenAI SDK are now classified `timeout` (the branch was unreachable
  because `APIConnectionError` extends `APIError`, so they were counted
  as `unknown` and never retried by the app loop), and HTTP 400/404 responses (for
  example a retired model) get a new non-retryable
  `telerithm_nlq_llm_errors_total{type="model_or_request"}` label value.
  Dashboards or alerts that enumerate `type` values need the new value.
- NLQ LLM retries now have one owner (task 74ae7b4a): the OpenAI client
  is built with `maxRetries: 0`, so the app retry loop (3 attempts total,
  1 s / 3 s backoff) is the only layer retrying timeouts, connection
  errors, 429 and 5xx. Previously each app attempt could trigger up to
  three SDK attempts. Against a hanging stub with `OPENAI_TIMEOUT_MS=1000`
  the time to the heuristic fallback dropped from about 16.7 s to about
  7.0 s; at the default 10 s timeout the worst case is about 34 s
  (3 x 10 s plus 4 s of backoff). Trade-off: the SDK no longer retries
  408 and 409 (the app loop classifies them `unknown` and does not retry
  them), and a 429 is retried on the fixed 1 s / 3 s backoff without
  honouring `Retry-After`.
- LLM-backed natural-language search silently fell back to the heuristic
  on the Traefik (Groq) deployment: the default model
  `llama-3.3-70b-versatile` was retired by Groq and returns 404. The
  default is now `openai/gpt-oss-120b` (Groq's named replacement), sent
  with `reasoning_effort: "low"`, and `docker-compose.traefik.yml` passes
  `OPENAI_MODEL` through so the model can change without editing the file.

### Changed

- CI: the Audit workflow's full-tree high/critical gate now classifies
  `npm audit --json` output with a vendored, dependency-free
  `scripts/audit-gate.mjs` (copied from depsight commit be8c7ea) and an
  ID-scoped, dated allowlist in `.github/audit-allowlist.json`. It excepts
  only GHSA-vfj7-8cjw-p6xm (braces 3.0.3, reached in `frontend` as a dev
  dependency only, no upstream fix), with a `reviewBy` date of 2026-11-06;
  any other HIGH or CRITICAL advisory, or an expired entry, keeps the gate
  red. The moderate runtime gate is unchanged. The script's self-test runs
  in the same job (`node --test scripts/audit-gate.test.mjs`).

- The `Audit` gate is re-vendored from depsight #172: `scripts/audit-gate.mjs` now treats a report whose `metadata.vulnerabilities` HIGH plus CRITICAL tally disagrees with, or is missing against, its `vulnerabilities` map as UNCLASSIFIED (exit 3), prints npm's stderr itself through a sanitiser (each line behind an `npm stderr| ` prefix, reduced to a safe character set, length and count bounded) instead of the workflow step copying it raw, and the gate step fails (exit 3) when the classifier exits 0 without the `npm audit gate: CLEAN` line. The non-blocking report step prints npm's output between `::stop-commands::` and a per-run random resume token. The allowlist entries are unchanged. Tracker task dbbc4994.

## [0.3.0] - 2026-10-05

Minor release: a team-scoping and role-enforcement hardening of the
REST API (several cross-tenant fixes, VIEWER becomes read-only), a
stricter webhook SSRF guard, an opt-in `TRUST_PROXY` setting, a
per-user rate limit on the notification-test route, CLI pipe fixes,
ClickHouse system-log retention, and a long run of dependency
advisories closed. Backend and frontend version in lockstep as the
app suite. The SDK (`@telerithm/sdk`) has no functional change and is not part
of this release.

### Upgrade notes

- **VIEWER is now read-only on team-scoped write routes.** Existing
  VIEWER memberships lose their former write access (mute alert
  rules, acknowledge incidents, manage maintenance windows, create
  sources, reassign issues). Before deploying, check production with
  `SELECT count(*) FROM "TeamMember" WHERE role = 'VIEWER'` and tell
  affected users.
- **MEMBER and VIEWER can no longer share log views or set a default
  view** (including on their own private views), and only OWNER/ADMIN
  can list, create or revoke team invites. Existing shared or default
  views owned by non-admins are not migrated and stay editable by
  their owner; count them before deploying.
- **`TRUST_PROXY` (new, opt-in).** Unset keeps the old behaviour
  (trust no proxy), so every client behind a reverse proxy shares one
  IP-keyed rate-limit bucket. Set it to a hop count (for example `1`
  behind Traefik), `loopback`, or an IP/CIDR list. Values that would
  trust every hop are rejected at startup: the boolean `true`, hop
  counts above 10, and IPv4 CIDRs broader than /8 or IPv6 CIDRs
  broader than /32. `docker-compose.traefik.yml` now sets it to
  `1`; self-hosters on another proxy must set their own value.
- **New env vars** `NOTIFICATION_TEST_RATE_LIMIT_WINDOW_MS` and
  `NOTIFICATION_TEST_RATE_LIMIT_MAX` (defaults: 5 requests per 5
  minutes). Both are optional. `WEBHOOK_NAT64_ADDITIONAL_PREFIXES`
  (optional, empty by default): comma-separated /96-aligned prefixes
  ending in `::` whose embedded IPv4 addresses the webhook SSRF guard
  decodes before the private-range check.
- **ClickHouse system logs.** After the first restart on the new
  compose files, the system log tables that get a TTL are renamed to
  `*_N` by ClickHouse and recreated with a 7-day TTL; the renamed
  copies can be dropped. `system.text_log` is disabled but NOT removed
  or renamed, and it still holds the old rows that filled the disk:
  drop or truncate it by hand (`TRUNCATE TABLE system.text_log` or
  `DROP TABLE system.text_log`) to reclaim that space. Verify the new `system-logs.xml` mount is
  present in the compose file actually deployed (see the `[0.1.1]`
  operational note).

### Added

- **Per-user rate limit on `POST /subscriptions/:id/test`** (PR #119).
  Over-limit requests get 429 with `Retry-After` and a JSON
  `retryAfter` in seconds. The limiter keys on the resolved user id,
  after authentication, so a new login does not buy a fresh budget
  and unauthenticated callers never create a bucket.
- **Opt-in `TRUST_PROXY`** so the global, auth and ingest limiters
  key on the real client IP behind a proxy (PR #141). See Upgrade
  notes.
- **`GET /teams` items carry the caller's own membership role**
  (PR #144); the log search screen uses it to disable the share and
  default controls for MEMBER and VIEWER, with the reason shown.
- **Curated knowledge bundle under `docs/okf/`** with a warn-only
  staleness workflow (PR #111), and an `audit.yml` workflow gating on
  high advisories (full tree) and moderate-or-higher runtime
  advisories (PR #135).
- **`docs/api.md`** with the endpoint reference, rate-limit baseline
  and token recipe (PR #119, PR #136, PR #149).

### Changed

- **Team write gate is structural** (PR #105, PR #145). Team-scoped
  mutating routes register through a `writeRoute` wrapper that runs
  authentication, team resolution and the write-role check before the
  handler; `requireResourceTeam` is the shared by-id resolver. AST
  meta-tests fail CI when a mutating route is neither wrapped nor
  justified on the allowlist. Status codes and mutations are
  unchanged.
- **Saved log-view and subscription routes map errors correctly**
  (PR #104): unknown or foreign ids now answer 404/403 instead of
  500, via typed `NotFoundError` and `ForbiddenError`.
- **NLQ filter fields are allowlisted at the AI-service boundary**
  (PR #91). Fields outside the searchable columns and known facets
  are dropped and counted in the `telerithm_nlq_filter_pruned_total`
  metric; the repository
  sanitizer is unchanged.
- **Backend `npm run dev` loads `backend/.env`** (Node
  `--env-file-if-exists`), so the documented
  `cp backend/.env.example backend/.env` step takes effect in
  development; shell variables still win. Production start and Docker
  are unchanged (PR #150).
- **`OPENAI_API_KEY` is unset by default in `backend/.env.example`**,
  so a fresh copy uses the heuristic NLQ path; deployment docs now say
  the traefik compose targets Groq and how to switch (PR #149).
- **Docs** corrected against the code across README, architecture
  (Redis does not back ingestion rate limiting), configuration,
  maintenance-window semantics and deployment (PR #88, #116, #117,
  #136, #149).

### Fixed

- **`logforge-pipe` flushed partial batches early** (PR #107). The
  periodic flush compared whole-second timestamps, so crossing a
  second boundary could split a fresh batch; it now uses
  `$EPOCHREALTIME` where available, with a strict comparison on older
  bash.
- **`logforge-pipe` busy-loop under a slow trickle or an unterminated
  final line** (PR #108). The read loop now tells an idle timeout
  from EOF, so the script exits instead of spinning and re-posting
  the last line.
- **Retention for ClickHouse system logs and bounded container logs**
  (PR #110). `system.text_log` is disabled and the other system log
  tables get a 7-day TTL via a `config.d` override mounted in both
  prod composes; all services use `json-file` logging capped at
  10m x 3. Prevents the unbounded `text_log` growth that filled the
  host disk.

### Security

- **Team-scoping fixes (cross-tenant IDOR class)**, each answering
  403 or 404 before any mutation:
  - Team-invite routes require OWNER/ADMIN of the affected team;
    `revokeInvite` also matches the team in the service layer
    (PR #97). Previously any authenticated user could list a team's
    invites (including join tokens), create invites and revoke any
    invite.
  - Alert-incident actions and timeline scoped to the incident's
    team (PR #98).
  - Alert-rule mute/unmute scoped to the rule's team (PR #100).
  - Maintenance-window deletion scoped to the window's team
    (PR #101).
  - Async query jobs scoped to the team whose logs produced them
    (PR #102).
- **VIEWER is read-only on team-scoped write routes** (PR #142), and
  **setting shared or default log-view state now requires OWNER/ADMIN**
  (PR #143); existing shared views are not migrated. Private views stay
  open to every member. See Upgrade
  notes.
- **Webhook SSRF guard hardened** (PR #99, #103, #106): IPv6
  normalization gaps closed, and NAT64, 6to4, IPv4-compatible,
  Teredo embeddings plus `0.0.x.x` collapse are decoded before the
  private-range check; operator NAT64 prefixes are decoded only when
  `WEBHOOK_NAT64_ADDITIONAL_PREFIXES` is set.
- **Dependency advisories closed** across backend, frontend and
  lockfiles (PR #87, #89, #112 to #115, #120, #123 to #125, #129 to
  #131, #134, #139, #140): `next` 15.5.25 (RCE), `sharp`
  (GHSA-f88m-g3jw-g9cj), `vitest`, `vite`, `form-data`,
  `@babel/core`, `undici` (GHSA-3wwx-pv8p-q78v), `brace-expansion`,
  `fast-uri`, `body-parser`, `postcss` (GHSA-r28c-9q8g-f849,
  GHSA-fxqj-rqcc-2cmp), `nanoid` (GHSA-2v37-7h3g-55p8), `browserslist`
  (GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g), `qs`
  (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g; the override was dropped
  again once express 4.22.3 declares the fixed range),
  `postcss-selector-parser` and `deepmerge-ts`
  (GHSA-ggr8-5vv4-36mx).

### Tests

- Cold-run coverage flake in the API test suite removed (PR #109).
- Coverage added for the SSRF url-guard, webhook HMAC, notification
  dispatcher and channels, alert service and worker, team service,
  ingestion, fingerprinting, frontend auth and the CLI (bats), with
  the coverage gates raised to match (PR #92 to #96).

## [0.2.3] - 2026-06-16

Patch release closing two esbuild build-tool advisories from the
2026-06-13 CVE sweep and landing three API refactors (generic
Prisma-error helper, GET /teams requireAuth migration, dead
header-array removal) plus a test-isolation fix. No frontend
behaviour change; backend and frontend version in lockstep as the
app suite.

### Security

- **esbuild pinned to >=0.28.1 in backend** (PR #84, PR #85). Two
  advisories (GHSA-gv7w-rqvm-qjhr HIGH, GHSA-g7r4-m6w7-qqqr LOW)
  affected esbuild versions before 0.28.1, which entered the tree as
  a transitive dependency of tsx and tsup. PR #84 bumps tsx to
  ^4.22.4 in backend devDependencies (tsx >=4.22.0 depends on esbuild
  ~0.28.1 patched). PR #85 adds an `overrides` pin `esbuild: >=0.28.1`
  to backend and sdk-js package.json to close the remaining path
  through tsup. Build-time only; no runtime risk.

### Changed

- **Generic Prisma-error-to-status helper in REST router** (PR #83).
  Replaced the inline `isPrismaNotFound` (P2025 only) with
  `handlePrismaError`, mapping P2025 to 404 and P2002 to 409 and
  rethrowing everything else to the central error middleware. Applied
  to every direct Prisma write/update/delete in `router.ts`:
  alert-rule mute/unmute, maintenance-window create and delete, admin
  `user.update`, and admin `teamMember.delete`. Previously unguarded
  Prisma errors on stale IDs surfaced as 500.
- **GET /teams migrated to requireAuth** (PR #81). The route was the
  last authenticated handler using the pre-PR-#67 inline parseToken
  pattern, which masked every auth error as 401. Switched to the
  shared `requireAuth` helper and replaced `listTeamsForToken(token)`
  with `listTeamsForUser(userId)`, since `requireAuth` already
  resolves the session. Auth errors now propagate to the async error
  middleware as 5xx instead of being silently coerced to 401.
- **Dead header-array fallback removed in resolveUserId** (PR #80).
  `req.header()` returns `string | undefined`, so the `string[]`
  branch was unreachable. On a string, `header?.[0]` would have
  returned the first character rather than an array element, making
  the fallback incorrect had it ever fired. Removed; `parseToken`
  already accepts `string | undefined`.

### Tests

- **Mock-queue leak fixed in API test suite** (PR #82). `beforeEach`
  used `vi.clearAllMocks()`, which clears call history but leaves
  `mockResolvedValueOnce` queues intact, allowing an unconsumed
  once-value to leak from one test into the next. Switched to
  `vi.resetAllMocks()` and re-seeded every default, including redis
  `get`/`keys`/`ping`, in `beforeEach` as the single source of truth.
  Added a regression test that fails under the old strategy and passes
  under reset.

## [0.2.2] - 2026-06-09

Security release closing the 2026-05-30 audit findings for the
backend. The headline is a CRITICAL: the published image seeded a
publicly known ADMIN credential on every production boot. This
release also closes four HIGH findings (IDOR, ClickHouse SQLi, SSRF,
cross-tenant ingest), enforces team membership across every
tenant-scoped route, and bumps vitest off a known CVE. No frontend
behaviour change; backend and frontend version in lockstep as the
app suite.

### Security

- **CRITICAL: production no longer seeds a public ADMIN credential** (PR #73). The Docker entrypoint ran `node dist/seed.js` on every container start, and the only guard was an idempotency check on the demo email, so a fresh production database was provisioned with `demo@telerithm.dev` / `demo123` at role ADMIN (the image sets `NODE_ENV=production`). Both `backend/src/seed.ts` and `backend/prisma/seed.ts` now skip seeding when `NODE_ENV=production` unless `SEED_DEMO_DATA=true` is set explicitly. Dev / CI / test behaviour is unchanged. **Operator note**: rotate or delete any `demo@telerithm.dev` ADMIN account that a prior deploy may have created.
- **HIGH: four audit findings closed** (PR #75). ClickHouse SQLi: `log-repository.ts buildFilterCondition` now sanitises the dynamic map key against the existing allow-list regex so a crafted `filter.field` cannot break out of the `fields['<key>']` literal. Cross-tenant ingest forgery: `authenticateApiKey` rejects when the API-key source id does not match the URL `:sourceId` on both ingest routes. Issue IDOR: `GET/PUT /issues/:id` loads the issue, 404s if absent, then enforces `requireTeamRole` against the issue's own team and verifies the assignee belongs to it. SSRF: a new `assertSafeUrl` guard rejects non-http(s) schemes and private / loopback / link-local / ULA / metadata ranges, enforced at the subscription input boundary and again before every webhook / Slack / MSTeams fetch (`redirect: "manual"`).
- **HIGH: team membership enforced on tenant-scoped endpoints** (PR #74). Tenant-scoped handlers authenticated the caller but never checked that the user belonged to the `teamId` they passed, so any logged-in user could read or write another team's sources, logs, alerts, maintenance windows, dashboards, issues, and subscriptions. The two-step `requireAuth` then `requireTeamRole` gate is now applied to every `teamId`-scoped handler that previously called only `requireAuth`, returning 403 for non-members. Cross-team 403 regression tests added.
- **MEDIUM: two findings closed** (PR #78). `backend/entrypoint.sh` no longer swallows `prisma db push` / seed failures, so `set -e` aborts startup on a schema error instead of masking it. `POST /subscriptions` now enforces team membership via `requireTeamRole` before create, with a cross-team regression test.
- **vitest bumped to `^4.1.4`** (CVE-2026-47429 / GHSA-5xrq-8626-4rwp, PR #76). vitest < 4.1.0 lets the UI server read and execute arbitrary files. vitest is a devDependency; the lockfile is regenerated and four constructor-mock factories were converted from arrow functions to function expressions for the vitest-4 `[[Construct]]` change. Suite green (224 passed).

### Changed

- **Backend branch-coverage threshold re-baselined to 70** (PR #77). vitest 4's v8 coverage provider counts branches more granularly than vitest 3, so backend branch coverage measures 74.06% with no test change; lines / statements / functions stay at 80, matching the frontend job.

## [0.2.1] - 2026-05-28

Patch release closing the auth regression introduced by v0.2.0. PR
#67 hardened nine `/api/v1` routes server-side without touching the
frontend, so every logged-in dashboard page on demo.telerithm.cloud
returned 401 immediately after deploy. v0.2.1 lands the frontend
side of the same audit plus the SSE counterpart that EventSource
made non-trivial.

### Fixed

- **Frontend bearer-token plumbing** (PR #69): switched five client
  helpers (`getOverview`, `getSources`, `getAlertRules`,
  `getAlertIncidents`, `getIssues`) from the unauthenticated
  `request` to `authedRequest`, and threaded the session token
  through six SSR pages (`/`, `/dashboards`, `/alerts`,
  `/alerts/subscriptions`, `/settings`, `/issues`) plus the
  `IssueExplorer` client component. Dashboard, Alerts, Issues and
  Settings render real data again instead of returning 401.

### Security

- **SSE bearer + access-log redaction on `/stream/logs`** (PR #70):
  `EventSource` cannot set an `Authorization` header, so PR #67
  also broke the Live Tail panel on `/logs` (401 reconnect loop).
  Adds a narrow `requireStreamAuth` gate that accepts the bearer
  via `?token=` query parameter in addition to the header; every
  other authenticated route stays header-only via the existing
  `requireAuth`. The HTTP access logger in `app.ts` now strips
  `token=…` from the URL before pino writes the line, so the
  query-token does not leak into log files. OpenAPI documents the
  new query parameter and adds an explicit 401 response.
- **Cross-team isolation on `/stream/logs`**: the SSE route now
  calls `requireTeamRole` after authentication, so a logged-in
  user can no longer subscribe to another team's live log stream
  by guessing the `teamId`. Pre-existing on master since the route
  was first added; surfaced during review of the SSE-auth change.
  Non-members get 403 (consistent with every other team-scoped
  endpoint), members continue to receive the stream.

## [0.2.0] - 2026-05-27

Minor release closing the remaining unauthenticated endpoints on
`/api/v1`, rolling up two upstream CVE bumps, and landing one
docs refresh + a small ops fix. After this release every
`/api/v1` route except `/health`, `/auth/*`, and `/ingest/*` is
provably gated, verified by an in-process route-audit fixture.

### Security

- **Auth audit and `requireAuth` helper** (PR #67): closes the
  9 remaining unauthenticated routes flagged in the post-v0.1.1
  audit. `GET /sources`, `POST /sources`, `GET /alerts/rules`,
  `GET /alerts/incidents`, `GET /maintenance-windows`,
  `GET /dashboards/overview`, `GET /issues`, `GET /issues/:id`,
  and `GET /stream/logs` now reject unauthenticated requests
  with 401. Adds a `requireAuth(req, res)` helper that mirrors
  the existing `requireAdmin` pattern (returns userId on
  success, sends 401 and returns null on failure) and a paired
  `requireTeamRole` helper that returns 403 on non-membership.
  `/alerts/rules/:id/mute` and `/unmute` now return 401 (not
  400) on auth failure. All other authenticated handlers
  except `GET /teams` (still on the legacy inline-`parseToken`
  pattern, tracked as a follow-up) were refactored away from
  the broad
  `try { resolveUserId; ...body... } catch { 401 }` shape, so
  legitimate handler errors flow to the central error
  middleware as 5xx instead of being masked as 401. A new
  in-process route-audit test walks `apiRouter.stack` and
  asserts every non-public path rejects an unauthenticated
  request with 401.
- **Frontend Next.js bumped to ^15.5.18** (PR #62): patches 13
  CVEs surfaced by the dependency scanner.
- **`qs` bumped to 6.15.2** (PR #64) in both backend and
  frontend, closing CVE-2026-8723.

### Fixed

- **Stale `:id` on alert mute/unmute and maintenance-window
  delete now returns 404, not 500** (PR #67 review fixes):
  added an `isPrismaNotFound` helper that maps Prisma's `P2025`
  ("record not found") to 404, preserving the prior 4xx
  behaviour on a stale id without bringing back the broad
  try/catch that was masking auth failures.
- **`POST /api/v1/teams` post-auth errors now return 400, not
  401** (PR #67 review fixes): once `requireAuth` has run, any
  error from `teamService.createTeam` is a business-rule
  failure (single-tenant mode disabled, slug taken), not an
  auth one.
- **Makefile duplicate `Production Deploy` section removed**
  (PR #66): cleans up a duplicate target block and adds the
  missing `.PHONY` declarations.

### Docs

- **README API table refresh and CHANGELOG cross-links** (PR
  #65): the API table now matches the deployed surface, Redis
  is marked optional in the prerequisites, and the top-level
  README links the app-suite and SDK changelogs.

### Chore

- **`*.tsbuildinfo` is gitignored and the existing
  `frontend/tsconfig.tsbuildinfo` is untracked** (PR #63):
  removes incremental-build cache state from version control.

## [0.1.1] - 2026-05-11

Patch release rolling up the post-v0.1.0 auth hardening and the
two ClickHouse hotfixes from 2026-05-11. The tag at v0.1.0 no
longer matched the running production state once PRs #56 and #59
landed, so this release re-establishes deploy provenance.

### Security

- **Bearer-token requirement on logs and query endpoints** (PR #56):
  `/logs/*` and `/query/*` handlers now require a valid bearer
  token via `resolveUserId`. Previously unauthenticated callers
  reached the handlers and were filtered downstream, which was
  fragile.
- **CVE sweep 2026-05-10** (PR #58): bumps `ip-address` and
  `express-rate-limit` to versions that close advisories surfaced
  by the dependency scanner.

### Fixed

- **Logs UI in production after the auth tightening** (PR #59):
  PR #56 hardened the server but the frontend client did not yet
  attach the bearer to `getLogs`, `getLogById`, `getLogContext`,
  `getLogFacets`, `getLogHistogram`, `getLogPatterns`,
  `getNaturalExplanation`, and the internal `waitForAsyncJob`.
  Logs screens (today, search, detail) now thread the token from
  `useLogAuth` into every call. Without this fix the logs UI was
  silently 401-ing in production once #56 deployed.
- **ClickHouse OOM on the dashboard overview aggregation**
  (PR #59): the container had a 1 GiB cap and the
  `/api/v1/dashboards/overview` aggregation pushed past it,
  producing 500s and a React error #419 on the dashboard SSR.
  Container raised to 3 GiB and `backend/clickhouse/limits.xml`
  introduced with `max_server_memory_usage=2.5 GiB`, per-query
  budget 2 GiB, and 1 GiB external spill thresholds for
  group-by and order-by.
- **ClickHouse memory limits actually applied in production**
  (PR #60): PR #59 only patched `docker-compose.prod.yml`, but
  production runs via `docker-compose.traefik.yml`. The limits
  mount and 3 GiB cap are now mirrored into the traefik compose,
  so the fix lands on the deployed container.
- **ClickHouse `max_server_memory_usage_to_ram_ratio=0` footgun**
  (PR #60): ClickHouse treats `0` as "0 % of RAM", not "disabled".
  Combined with the absolute cap setting, it was resetting
  `max_server_memory_usage` to 0 (= unlimited). Replaced with a
  ratio-only setting at `0.85`, which yields about 2.55 GiB on
  the 3 GiB container; per-query and spill thresholds unchanged.

### Changed

- **postcss bumped to ^8.5.10** (PR #54) in backend and frontend
  to stay aligned with the wider toolchain.

### Docs

- **README 60-second hook + docs restructure** (PR #55): top-level
  README now leads with the one-paragraph pitch and a 60-second
  install/run path; deeper material moved into `docs/`.
- **OSS surface** (PR #57): adds `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, modern `.github/ISSUE_TEMPLATE/*.yml`, and
  `.github/ISSUE_TEMPLATE/config.yml` contact links pointing at
  `contact@lan-nguyen-si.de`.

### Operational notes

- The bearer-token requirement on `/logs/*` and `/query/*` is a
  behaviour change for any external caller of these endpoints,
  even though the published SDK does not exercise them. Out-of-
  tree integrations need to attach a bearer token going forward.
- Production deploys land via deploy-panel from `master` (no
  manual VPS step). Verify `docker-compose.traefik.yml` is what
  is in effect on the host before assuming the new limits are
  applied: `docker exec <ch-container> cat /etc/clickhouse-server/config.d/limits.xml`.

## [0.1.0] - 2026-04-26

First tagged release of the Telerithm app suite.

This is a baseline tag covering the platform as it stands at the
time of cut. Subsequent app-suite releases will list the user-visible
deltas under their own `[X.Y.Z]` heading.

### Highlights at v0.1.0

#### NLQ (natural-language query) pipeline

- **AI hardening** (PR #52): retry, timeout, Zod validation on AI
  output, per-stage metrics. Graceful fallback on validation failures.
- **Search mode separation** (PR #43, task-028): explicit modes for
  AI-assisted vs. raw text search; UI toggle in the search bar.
- **Domain stopword filtering** (PR #41, task-029): operator-defined
  stopwords stripped from NLQ before AI extraction.
- **Term recovery into text search** (PR #40): NL terms pruned by
  the structured-filter pass are still routed to text search instead
  of being dropped.
- **Filter coverage fixes** (PRs #44, #45): textTerms covered by
  AI-extracted filters are stripped to avoid double-matching;
  fully-deduped queries no longer fall back to raw NL search.
- **Payment-failures recall fix** (PR #38).

#### Logs UI

- **Relative time-range UX** + **semantic URL state** (PR #39):
  shareable URLs encode the relative range ("last 24h") rather than
  baking absolute timestamps.
- **Phase-2 time URL sharing toggle** (PR #42).

#### Quality + ops

- **Test coverage gates** (task-030, PRs around it): backend 80%
  / frontend 70% enforced in CI. Coverage rose backend 53% → 92%
  and frontend 47% → 86% across the gate-prep PRs.
- **deploy-panel integration** (PR #50): `.relay.yml` registers the
  app suite with the deploy-panel pipeline. Production at
  `logs.opentriologue.ai`.
- **Engineering docs** (`ENGINEERING.md`): Quality standards,
  reviewed by Ice + Lava agents.
- **Local LLM support** documented (`LOCAL_LLM.md`).
- **Self-hostable** (Docker Compose with `docker-compose.prod.yml`
  + `docker-compose.traefik.yml`).

### Security

- `next` bumped to 15.5.15 (frontend) — GHSA-q4gf-8mx6-v5v3 (PR #51).
- `vite` bumped in backend + frontend to patch high-severity
  CVEs (PR #49).
- Generic dependency CVE rounds (PR #48).

### Deployment

- Production: deployed via deploy-panel from `master`, no tag
  needed for the deploy itself. This `v0.1.0` tag marks the
  baseline for future deploy-provenance discussions.
- Self-host: see `docker-compose.prod.yml` + `DEPLOYMENT.md`.
