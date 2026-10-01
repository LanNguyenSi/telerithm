# Log

<!-- Add new entries at the top, newest first. -->

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
