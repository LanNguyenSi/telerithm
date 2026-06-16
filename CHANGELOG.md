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
