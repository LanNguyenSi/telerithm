# Log

<!-- Add new entries at the top, newest first. -->

- 2026-10-05T04:43:18Z, ingestion-pipeline.md re-stamped after a docs/configuration.md note on the Node floor and restart behaviour for backend/.env; the "Ingestion sources" section it cites is unchanged.
- 2026-10-05T04:40:55Z, clickhouse-retention-and-memory-limits.md, compose-file-topology-and-drift.md and ingestion-pipeline.md re-stamped after CHANGELOG.md gained an [Unreleased] section (backend dev loads backend/.env) and docs/configuration.md gained a paragraph on which paths read backend/.env. The CHANGELOG [0.1.1] notes and the configuration.md "Ingestion sources" section these docs cite are unchanged.
- 2026-10-04T14:01:54Z, clickhouse-retention-and-memory-limits.md and ingestion-pipeline.md re-stamped after wording edits in DEPLOYMENT.md (demo seed skipped in production) and docs/configuration.md (OpenAI cloud snippet sets OPENAI_MODEL). Neither change touches the ClickHouse schema step or the ingestion sources table these docs cite.

- 2026-10-04T13:58:12Z, re-verified and re-stamped clickhouse-retention-and-memory-limits.md and ingestion-pipeline.md after DEPLOYMENT.md and docs/configuration.md changed (AI provider note, optional manual db push, auth-token wording); the claims each doc makes about those sources were unaffected.

- 2026-10-03T12:12:29Z, okf-staleness workflow re-synced from the okf-kit
  workflow template (fleet convergence ticket fdc01728): the workflow header
  now names the template as its source instead of calling the file a pattern
  to keep in sync, the pin moved from okf-kit@0.10.0 to okf-kit@0.16.0,
  `--require-anchors` joined the invocation, and the job stays warn-only.
  Measured on the tree before the change with `okf-kit check --json <bundle>`:
  at okf-kit@0.10.0, 0 errors, 0 warnings, 0 notices (exit 0) plain and 0
  errors, 28 warnings, 0 notices (exit 0) with `--require-anchors`; at
  okf-kit@0.16.0, 0 errors, 0 warnings, 0 notices (exit 0) plain and 0 errors,
  28 warnings, 0 notices (exit 0) with `--require-anchors`. Of the
  anchored-run warnings, 28 are anchor-required findings (full citations
  without an anchor); anchoring them is separate work and none of them blocks
  anything.

- 2026-10-02T08:53:23Z, task 10b54786: `api-authz-and-team-scoping.md` now names the config keys the route-table matrix builds (nodeEnv, multiTenant, trustProxy) and that a registration behind any other key is not built until the key is added; re-verified against `route-table.test.ts` and re-stamped.

- 2026-10-02T08:36:31Z, re-verified and re-stamped api-authz-and-team-scoping.md
  (task 10b54786): the route-table audit now rebuilds the app under every
  combination of nodeEnv, multiTenant and trustProxy, rejects `param`
  callbacks on the app and the API router, and pins every anonymous layer by
  a source fragment; a resolver held in an identifier must be a top-level
  `const`. The doc states the threat model (accidental gaps, not deliberate
  obfuscation) and no longer claims S4 is detected whatever its spelling or
  that the static scan sees any registration in `server.ts`.

- 2026-10-02T07:47:58Z, re-verified and re-stamped api-authz-and-team-scoping.md
  (task 10b54786): a runtime route-table test (`route-table.test.ts`) now
  walks the Express stack of the real app and makes the wrapper mandatory
  whatever the spelling of a registration, so the aliased-router, second-mount
  and inline `app.use` escapes are detected; the AST tests keep the call
  shapes, the factory arguments (plain identifiers, no inline schema or
  loader), the wrapper binding and a scan for code outside `createApp()`. The
  body schema is documented next to the loader as a second input that runs
  before the gate and must be free of side effects.

- 2026-10-02T07:14:07Z, re-verified and re-stamped api-authz-and-team-scoping.md
  (task 10b54786): team-scoped mutating routes are registered through the
  `writeRoute` wrapper (write-route.ts), which runs authentication, team
  resolution and the write gate before the handler. `requireResourceTeam`
  lost its mode argument and is the membership-only read resolver; the
  write-role meta-test now makes the wrapper mandatory and scans src for
  registrations on another router instance. router.ts citations were
  re-pointed after the router shrank, and the shapes the earlier placement
  check could not see are answered one by one.

- 2026-10-02T07:15:49Z, re-verified and re-stamped ingestion-pipeline.md (task 3c2adfe9):
  backend/src/types/domain.ts gained a `TeamWithRole` type; the six
  `SourceType` values this doc cites are unchanged.

- 2026-10-02T05:54:06Z, re-verified and re-stamped api-authz-and-team-scoping.md
  (task 765bb823): `canManageShared` moved next to `canManageInvites`, so the
  router.ts citations below the log-view routes were re-pointed; the saved-view
  paragraph now states the remaining gap (a non-admin owner of an already
  shared or default view can still edit, unshare and delete it, existing data
  is not migrated) and that MEMBER and VIEWER cannot set `isDefault` even on a
  private view.

- 2026-10-02T05:41:22Z, re-verified and re-stamped api-authz-and-team-scoping.md
  (task 765bb823): the saved-view routes now gate team-wide state. POST and
  PUT `/logs/views` answer 403 before any service call when a non-admin sets
  `isShared` or `isDefault` (`canManageShared`, `requestsSharedState`), while
  private views stay open to every member; router.ts citations moved with the
  inserted predicate and the line count was updated.

- 2026-10-01T11:32:19Z, re-verified and re-stamped api-authz-and-team-scoping.md
  (task 2a52b2b1): the write-gate placement claim now states the actual
  guarantee (a syntactic check that does not see side effects in gate
  arguments, middleware arguments, handler default parameters or tagged
  templates and `new` expressions), and the duplicate saved-view route is
  described as checking `canRead` and keeping `isShared` only with
  `canManageShared` (log-view-service.ts:121, 129).

- 2026-10-01T11:19:40Z, re-verified and re-stamped api-authz-and-team-scoping.md
  after the write-role meta-test gained gate-placement rules (task 2a52b2b1):
  the gate must be the first step after authentication and validation and its
  null result must end the handler; both router guards now flag aliased,
  element-access and detached `apiRouter` registrations; `requireResourceTeam`
  fails closed. The saved-view statements were corrected: those routes check
  ownership, not `canWrite`, so a VIEWER can share its own view and clear the
  team's default flags (tracked in a follow-up task). `router.ts` citations
  re-pointed after the file grew by one line.

- 2026-10-01T10:58:00Z, re-verified and re-stamped api-authz-and-team-scoping.md
  after VIEWER became read-only on team-scoped write routes (task 2a52b2b1):
  the "open, undecided" section is replaced by the implemented rule
  (`canWrite`, `requireTeamWriteRole`, write-mode `requireResourceTeam`
  resolvers, the new `router-write-role.test.ts` meta-test, now listed under
  `sources`), the factory signature and its five instantiations are updated,
  and every `router.ts` and `ENGINEERING.md` line citation was re-pointed
  after the file grew from 1774 to 1824 lines. Re-checked against the code:
  the three caller models, the by-id guard, the allowlist categories and
  `canManageInvites` are unchanged. index.md summary line updated to match.

- 2026-10-01T07:35:34Z, re-verified and re-stamped ingestion-pipeline.md after another
  wording change to the `TRUST_PROXY` row in docs/configuration.md; its
  ingestion-source claims are unaffected.

- 2026-10-01T07:24:15Z, re-verified and re-stamped ingestion-pipeline.md after the
  `TRUST_PROXY` row in docs/configuration.md was reworded (which values are
  rejected): its ingestion-source claims are unaffected.

- 2026-10-01T07:01:35Z, re-verified and re-stamped ingestion-pipeline.md again after
  docs/configuration.md changed further (the `TRUST_PROXY` row now states its
  bounds and the production note says how to disable it): its "Ingestion
  sources" claims (six `SourceType` values, forwarder config paths) still hold.
  `okf-kit check docs/okf` (0.10.0) is clean.

- 2026-10-01T06:45:55Z, re-verified and re-stamped two docs after the `TRUST_PROXY` change
  (docs/configuration.md gained a variable row and a production-deploy note;
  docker-compose.traefik.yml gained the backend `TRUST_PROXY` env).
  ingestion-pipeline.md: its "Ingestion sources" claims (six `SourceType`
  values, forwarder config paths) re-checked against docs/configuration.md and
  unchanged. compose-file-topology-and-drift.md: re-checked the three-file
  roles and the mirrored ClickHouse mounts and logging anchor (unchanged) and
  added the deliberate traefik-only `TRUST_PROXY` setting so it is not read as
  drift. `okf-kit check docs/okf` (0.10.0) was clean afterwards.

- 2026-09-02T04:49:48Z, okf-kit CI pin raised 0.3.1 -> 0.9.0 (fleet parity,
  measured: 0.8.0 and 0.9.0 report identical findings
  here). Cleared the bundle's 7 pre-upgrade findings (4 `sources-fresh`
  STALE, 3 `citations-resolve` drifted `router.ts` citations) by
  re-verifying every claim against current sources and re-stamping:
  api-authz-and-team-scoping.md (`backend/src/api/rest/router.ts` grew
  1706 -> 1774 lines; every cited symbol moved, re-pointed all of them
  -- resolveUserId, requireAuth, resolveStreamUserId/requireStreamAuth,
  authenticateApiKey, the ingest-route gate, requireAdmin,
  requireResourceTeam, the four `requireXTeam` instantiations,
  requireTeamRole/resolveTeamRole, the `/query/jobs/:id` IDOR comment, and
  canManageInvites; the VIEWER-passes-write-gates invariant and the
  membership-only `requireTeamRole` check still hold as described),
  ingestion-pipeline.md (only its `authenticateApiKey` cross-reference had
  drifted; content re-verified unchanged against docs/architecture.md and
  docs/configuration.md), nlq-pipeline.md (re-verified unchanged against
  docs/architecture.md's "NLQ pipeline" section, no drift, timestamp
  refreshed). clickhouse-tenant-row-scoping.md, clickhouse-retention-and-
  memory-limits.md, compose-file-topology-and-drift.md were not flagged
  stale and were not re-stamped. `okf-kit check --json docs/okf`: 7
  findings before, 0 after.

- 2026-07-16T05:55:12Z, initial 6 docs authored and verified against sources
  at master b3744ec (backend 0.2.3): api-authz-and-team-scoping,
  clickhouse-tenant-row-scoping, clickhouse-retention-and-memory-limits,
  compose-file-topology-and-drift, nlq-pipeline (pointer), ingestion-pipeline
  (pointer). Also corrected a stale `docs/configuration.md` line (`prisma
  migrate deploy` -> `prisma db push`, matching DEPLOYMENT.md and
  `.relay.yml`; the backend has no `prisma/migrations/` directory).
