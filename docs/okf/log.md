# Log

<!-- Add new entries at the top, newest first. -->

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
