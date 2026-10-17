# Log

<!-- Add new entries at the top, newest first. -->

- 2026-10-17T04:48:04Z, re-verified and re-stamped after by-id reads and the invite revoke started answering a non-member like an unknown id and a failing membership lookup became a 500. api-authz-and-team-scoping.md: the invite-revoke and read-route prose states the 404, the typed not-a-member rule is added, the `router.ts` line count and citations are re-pointed. alert-evaluation-and-incident-lifecycle.md, notification-delivery-trust-boundary.md and nlq-pipeline.md: `router.ts` citations re-pointed, claims unchanged. ingestion-pipeline.md: re-stamped after the `router.ts` edit, no citation moved. clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md: re-stamped after the `CHANGELOG.md` edit; the sections they cite are untouched.

- 2026-10-17T04:45:00Z, re-verified and re-stamped after `AlertSubscription.rule` gained `onDelete: Cascade`. alert-evaluation-and-incident-lifecycle.md: the rule-delete paragraph states the cascade and keeps the explicit subscription delete as a second layer, and the team-scoping cascade list names rule to subscriptions; new `schema.prisma` citations. api-authz-and-team-scoping.md: re-stamped after the `schema.prisma` edit, claims unchanged. clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md: re-stamped after the `CHANGELOG.md` edit; the sections they cite are untouched.

- 2026-10-16T18:34:41Z, re-stamped api-authz-and-team-scoping.md after `ENGINEERING.md` listed all twelve `writeRoute` routes (it said nine); the doc already says twelve, claims unchanged.

- 2026-10-16T18:28:35Z, re-verified and re-stamped api-authz-and-team-scoping.md after `ENGINEERING.md` (writeRoute paragraph) was aligned with the non-member 404 of the by-id write routes; the doc's claims already state it, no citation moved.

- 2026-10-16T18:24:42Z, re-stamped after the type of a gate stub in `write-route.test.ts` changed (a parameter declaration, no behaviour): api-authz-and-team-scoping.md, claims and citations unchanged.

- 2026-10-16T18:23:44Z, re-verified and re-stamped after the by-id write routes started answering a non-member of the owning team with the 404 of an unknown id. api-authz-and-team-scoping.md: the wrapper description, the gate-order diagram and the `requireTeamWriteRole` paragraph state the 404 (and that a read-only member keeps the 403, as does a non-member of a body team), a new section lists the `teamFromResource` consumers and the unchanged read routes, and the `router.ts` and `write-route.ts` citations below the edits are re-pointed by 2 to 17 lines, claims unchanged. alert-evaluation-and-incident-lifecycle.md: the rule-authoring sentence names the 404 for a stored rule of another team; four `router.ts` citations re-pointed by 10. notification-delivery-trust-boundary.md: five `router.ts` citations re-pointed by 10, claims unchanged. ingestion-pipeline.md and nlq-pipeline.md: re-stamped after the `router.ts` edit, no citation moved. clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md: re-stamped after the `CHANGELOG.md` edit; the sections they cite are untouched. `okf-kit check --json --require-anchors docs/okf`: no citation findings.

- 2026-10-16T12:14:37Z, re-stamped after the Tailwind CSS 4 migration added a Security entry to `CHANGELOG.md` under [Unreleased]: clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md; the sections they cite are untouched.

- 2026-10-16T10:03:30Z, re-stamped after a comment line in `subscription-service.ts` and the wording of the `listByUser` entry changed: api-authz-and-team-scoping.md and the CHANGELOG now say the foreign rule's name is withheld while `ruleId` keeps the id the subscriber supplied. alert-evaluation-and-incident-lifecycle.md and notification-delivery-trust-boundary.md: three `subscription-service.ts` citations re-pointed by 1, claims unchanged. clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md: re-stamped after the `CHANGELOG.md` edit; the sections they cite are untouched.

- 2026-10-16T09:57:43Z, re-verified and re-stamped after `listByUser` stopped returning the rule of a subscription that points at another team. api-authz-and-team-scoping.md: the subscription allowlist entry now says the list returns `rule: null` for such a row (the row stays, its owner can delete it) instead of claiming the list can never return a foreign rule name. notification-delivery-trust-boundary.md and alert-evaluation-and-incident-lifecycle.md: the three `subscription-service.ts` citations are re-pointed by 7 lines, claims unchanged. clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md: re-stamped after the `CHANGELOG.md` edit under [Unreleased]; the sections they cite are untouched. `okf-kit@0.18.0 check --json --require-anchors docs/okf`: no citation findings.

- 2026-10-16T09:37:04Z, re-verified and re-stamped after `POST /subscriptions` started checking that `ruleId` belongs to the body's team. api-authz-and-team-scoping.md: the subscription allowlist entry states the team-scoped rule lookup and its 404, and that `PUT` takes no `ruleId`. notification-delivery-trust-boundary.md and api-authz-and-team-scoping.md: `router.ts` citations below the new lines re-pointed by 13, claims unchanged. `okf-kit check --json --require-anchors docs/okf`: no citation findings. alert-evaluation-and-incident-lifecycle.md, ingestion-pipeline.md and nlq-pipeline.md were re-verified and re-stamped after the `router.ts` edit (their claims do not touch the subscription create route). Docs that list `CHANGELOG.md` as a source were re-stamped after the Unreleased entry; the sections they cite are untouched.

- 2026-10-16T07:36:12Z, re-verified and re-stamped after the rule delete stopped filtering the subscription delete by team. alert-evaluation-and-incident-lifecycle.md: `deleteRule` deletes every subscription that targets the rule, whichever team owns it, then the rule scoped by team in the same transaction, so an other-team id still rolls back; the shifted `alert-service.ts` citations are re-pointed. nlq-pipeline.md, ingestion-pipeline.md, compose-file-topology-and-drift.md and clickhouse-retention-and-memory-limits.md: re-stamped after edits to `docs/architecture.md` (Alerting section) and `CHANGELOG.md` (Unreleased); the sections they cite are untouched. `okf-kit check --json --require-anchors docs/okf`: no citation findings.
- 2026-10-16T07:28:26Z, re-verified and re-stamped after the rule delete became a two-statement transaction. alert-evaluation-and-incident-lifecycle.md: `DELETE` removes the rule's subscriptions and then the rule in one transaction, both scoped by team, because `AlertSubscription.ruleId` has no `onDelete` and a nulled rule id would make a subscription team-wide (the incidents still cascade through the schema); `PUT` no longer takes `queryType`; `name`, `description` and `query` have length caps; the shifted `alert-service.ts` citations are re-pointed. clickhouse-tenant-row-scoping.md and notification-delivery-trust-boundary.md: `schemas.ts` citations re-pointed by one line, claims unchanged. clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md: re-stamped after the `CHANGELOG.md` edit under [Unreleased]; the sections they cite are untouched. `okf-kit check --json --require-anchors docs/okf` on the committed tree: no citation findings.

- 2026-10-16T07:13:21Z, re-verified and re-stamped after alert rules gained create, edit and delete routes. alert-evaluation-and-incident-lifecycle.md: the "Where rules come from" section now describes the three rule write routes, their body schemas (four conditions, `ANOMALY_DETECTED` and a non-`sql` `queryType` refused with 400, `windowMinutes` 1 to 1440), the team scoping in the write itself and the hard delete, instead of "no route creates a rule"; the description, the responsibility bullet, the entry-point route list and the `toAlertRule` citation follow. api-authz-and-team-scoping.md: twelve team-scoped write routes instead of nine (`POST /alerts/rules` via `teamFromBody`, `PUT` and `DELETE /alerts/rules/:id` via `teamFromResource`), and the `router.ts` line count is 1850. clickhouse-tenant-row-scoping.md, ingestion-pipeline.md, nlq-pipeline.md and notification-delivery-trust-boundary.md: citations into `router.ts`, `schemas.ts` and `domain.ts` re-pointed to the shifted lines, claims unchanged. clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md: re-stamped after the `CHANGELOG.md` entry under [Unreleased] and the `docs/architecture.md` Alerting edit; the sections they cite are untouched.

- 2026-10-14T05:23:33Z, corrections and re-stamp after the `MAX_PAGE_SIZE` clamp (task 6f12b5d6). alert-evaluation-and-incident-lifecycle.md: only the trailing `Z` of an ISO string makes ClickHouse reject a `DateTime64` parameter (measured on 24.10.2.80, `2026-10-14T04:44:41.318` is accepted); the `T` is replaced to match `LogRepository`; the `server.ts` citations moved by two lines for the startup config warnings. notification-delivery-trust-boundary.md: a doubled comma removed and the `config/index.ts` citation re-pointed. clickhouse-retention-and-memory-limits.md, clickhouse-tenant-row-scoping.md, compose-file-topology-and-drift.md and ingestion-pipeline.md re-verified and re-stamped after edits to CHANGELOG.md, docs/configuration.md and a comment in the alert worker, which none of their claims depend on. `okf-kit check --json --require-anchors docs/okf` on the committed tree: no findings.

- 2026-10-14T05:10:45Z, reopen widened and re-stamped (task 6f12b5d6). alert-evaluation-and-incident-lifecycle.md: reopen applies to `RESOLVED` and `ACKNOWLEDGED` incidents, as docs/architecture.md's state diagram shows, and refuses an `OPEN` one. clickhouse-retention-and-memory-limits.md, compose-file-topology-and-drift.md, ingestion-pipeline.md and nlq-pipeline.md re-verified and re-stamped after the CHANGELOG and docs/architecture.md edits (the reopen sentence and diagram), which none of their claims depend on. `okf-kit check --json --require-anchors docs/okf` on the committed tree: no findings.

- 2026-10-14T05:04:06Z, re-verified and re-stamped after the ingest, alerting and subscription fixes (task 6f12b5d6). alert-evaluation-and-incident-lifecycle.md: the evaluation flowchart and a new bullet cover the skipped `ANOMALY_DETECTED` condition (one warning per rule and process), the window bounds sent as ClickHouse text, the single demo seed (`prisma/seed.ts` re-imports `src/seed.ts`, the rule text is `Payment failed`), and the human-transition paragraph states the allowed transitions, the 409 for the rest and the status repeated in the update's `where`. notification-delivery-trust-boundary.md: the subscription schemas refuse `EMAIL`, so only older rows reach `sendEmail`. ingestion-pipeline.md: the `/raw` content type and the bare array the Fluentd and Vector configs post. compose-file-topology-and-drift.md: the dev backend has a health check. api-authz-and-team-scoping.md, clickhouse-tenant-row-scoping.md and nlq-pipeline.md: only `router.ts`, `schemas.ts` and worker line numbers moved, so their citations were re-pointed; clickhouse-retention-and-memory-limits.md claims nothing the CHANGELOG and architecture edits touch. `okf-kit check --json --require-anchors docs/okf` on the committed tree: no findings.

- 2026-10-11T16:39:03Z, corrections and re-stamp. notification-delivery-trust-boundary.md: the diagram shows `AlertEvaluationWorker` and `POST /subscriptions/:id/test` as two callers of `dispatch`, and only the sender, `assertSafeUrl` and the fetch sit in the per-attempt group; only `config.email` is unvalidated, the fallback is the account's address that signup validates. alert-evaluation-and-incident-lifecycle.md: an unbreached rule ends in its own node, the condition node notes the second `CHANGES_BY` count, the suppressed-period bullet states that the first run after it comes up to one interval late and counts only its own window, and `notification-dispatcher.ts` is a source. index.md lists Modules before Invariants. ingestion-pipeline.md names the `/raw` ingest route. api-authz-and-team-scoping.md, clickhouse-retention-and-memory-limits.md and nlq-pipeline.md re-verified and re-stamped after edits to ENGINEERING.md (pull request gate), DEPLOYMENT.md (schema step comment) and docs/architecture.md (ingest diagram and entrypoint, rule authoring), which none of their claims depend on. `okf-kit check --json --require-anchors docs/okf` on the committed tree: no findings.

- 2026-10-11T16:23:10Z, test-route paragraph. notification-delivery-trust-boundary.md: the test-route paragraph states what the route builds from the subscription (a synthetic `LOW` incident with its rule and team), that it calls `dispatch`, what it answers and its own limiter. alert-evaluation-and-incident-lifecycle.md: the pointer to that doc names the test route only. `okf-kit check --json --require-anchors docs/okf` on the committed tree: no findings.

- 2026-10-11T16:12:06Z, corrections and re-stamp. alert-evaluation-and-incident-lifecycle.md: `backend/prisma/seed.ts` runs through `npm run db:seed` or `npx prisma db seed` (the `prisma.seed` key), and the skipped-evaluation bullet now states which logs a suppressed period loses (older than `windowMinutes` before it ends, twice that for `CHANGES_BY`) and that a breach near its end can still open an incident on the first run after it. notification-delivery-trust-boundary.md: the Teams card carries no `ruleId`; the input-boundary paragraph and the test-route paragraph were reduced to the router check not running on every write and the test route dispatching through `findForIncident`. nlq-pipeline.md, ingestion-pipeline.md and clickhouse-retention-and-memory-limits.md re-verified and re-stamped after edits to docs/architecture.md (Alerting) and docs/configuration.md (Notification channels), sections none of them cites. `okf-kit check --json --require-anchors docs/okf` on the committed tree: no findings.

- 2026-10-11T15:47:36Z, two new docs. notification-delivery-trust-boundary.md (invariant) states that each of the three outbound `fetch` calls in `backend/src` (`sendWebhook`, the dispatcher's `sendSlackMessage`, `sendMsTeamsMessage`) is preceded by `assertSafeUrl` on the same URL and sent with `redirect: "manual"`, that this delivery-time check is the only one on every path because `validateSubscriptionWebhook` in router.ts does not run on every write, and records who can set a target, what the payloads carry and how the test route dispatches. alert-evaluation-and-incident-lifecycle.md (module) points to docs/architecture.md's "Alerting" section for the evaluation rules and the state diagram and records the cross-file couplings it does not state: the per-process `running` guard with an unlocked dedupe, skipped evaluations that are not made up, no rule-authoring route and the demo seed's SQL-text rule in both seed files, the fixed `MEDIUM` severity against subscription severity filters, team scoping through the rule relation, and what the alert metrics count. Both are listed in index.md, the alert doc under a new "Modules" section. Every citation is anchored on the last content line of its range. `okf-kit check --json --require-anchors docs/okf` on the committed tree: no findings.

- 2026-10-11T12:57:41Z, re-verified and re-stamped after the human docs were aligned with the code (ENGINEERING.md, DEPLOYMENT.md, docs/architecture.md, docs/configuration.md, docs/queries.md). clickhouse-tenant-row-scoping.md now names `AlertEvaluationWorker.queryLogCount` as the one `logs` reader outside `LogRepository` (it places `team_id` first by hand and binds the rule text as a parameter) and lists `alert-evaluation-worker.ts` in its sources. ingestion-pipeline.md summarises the corrected "Ingestion sources" section (source type is a label, every sender posts to the one HTTP endpoint, the fluentd and vector configs collect Docker logs only) and the post-insert issue grouping, re-points `authenticateApiKey` to its signature line, and adds `router.ts`, `deploy/fluentd/fluent.conf` and `deploy/vector/vector.toml` to its sources. nlq-pipeline.md states that the async job hand-off belongs to the facet, histogram and pattern handlers, not to `POST /query/natural`, and adds `router.ts` and `query-service.ts` to its sources. clickhouse-retention-and-memory-limits.md gained a section on the fixed 30-day `logs` TTL and the stored but unenforced per-source `retentionDays`, and no longer says that no doc states `init.sql`'s run-once behaviour (docs/architecture.md now does). api-authz-and-team-scoping.md gained a "Gate order" sequence diagram for `writeRoute` and no longer calls ENGINEERING.md a German write-up. Every bare `router.ts`, `log-repository.ts` and `schemas.ts` citation in the bundle is now anchored; function citations point at the signature line, so a line shift fails the anchor check. `okf-kit check --json --require-anchors docs/okf` on the committed tree: no anchor-required findings and no STALE doc.

- 2026-10-10T18:10:03Z, re-verified and re-stamped api-authz-and-team-scoping.md (task 9edca718): on another user's private default view `LogViewService.update` now lets OWNER/ADMIN only clear the default flag (a `PUT` whose sole effect is `isDefault: false`, written with fixed data and answered without `name` and `definition`) or delete it; `isShared: true`, a rename, a definition change, `isDefault: true` and an empty body are 403 with no write. The `log-view-service.ts` citations in the saved-view paragraph were re-anchored (the two `updateMany` sites, `isTeamWideState`, the `update` and `remove` gates, `canRead`, the duplicate `isShared` line, `return false;`) and three new anchors added (`isForeignPrivateDefault`, `clearsDefaultOnly`, `mapViewStub`); the router.ts citations are unchanged. ENGINEERING.md was edited in the same change.

- 2026-10-10T18:10:03Z, clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md re-stamped after the CHANGELOG.md Security entry under [Unreleased] (log-view gate) was reworded again. Re-verified: the CHANGELOG [0.1.1] notes these docs cite are unchanged.

- 2026-10-10T17:55:27Z, re-verified and re-stamped api-authz-and-team-scoping.md (task 9edca718): `LogViewService.canMutate` now lets OWNER/ADMIN act on any shared or default view of their team (the `isTeamWideState` predicate), a private default view owned by a MEMBER, a VIEWER or a demoted admin included; the non-admin owner of such a view stays refused and a private non-default view stays with its owner. The `return false;` citation in the saved-view paragraph moved from line 176 to 178 and the `isTeamWideState` citation from 166 to 168; the other citations were re-checked against the source and hold. ENGINEERING.md was edited in the same change.

- 2026-10-10T17:55:27Z, clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md re-stamped after the CHANGELOG.md Security entry under [Unreleased] (log-view gate) was reworded. Re-verified: the CHANGELOG [0.1.1] notes these docs cite are unchanged.

- 2026-10-10T17:46:45Z, clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md re-stamped after CHANGELOG.md gained a Security entry under [Unreleased] (log-view gate). Re-verified: the CHANGELOG [0.1.1] notes these docs cite (PR #59 3 GiB cap and limits.xml, the limits.xml verification command) are unchanged.

- 2026-10-10T17:46:27Z, re-verified and re-stamped api-authz-and-team-scoping.md (task 9edca718): `LogViewService.update` and `remove` now refuse (403, no mutation) a MEMBER or VIEWER on a loaded view that is shared or default, owner included, so the gap the saved-view paragraph named is closed and the paragraph states the rule instead. The log-view-service.ts citations in that paragraph were re-pointed and anchored; the router.ts citations and the rest of the doc are unchanged. The ENGINEERING.md source was edited in the same change.

- 2026-10-06T08:17:36Z: clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md re-stamped after CHANGELOG.md gained a CI entry under [Unreleased] (audit gate allowlist) and earlier NLQ entries there. Re-verified: the CHANGELOG [0.1.1] notes these docs cite (PR #59 3 GiB cap and limits.xml, PR #60 traefik mirror, the limits.xml verification command) are unchanged.
- 2026-10-05T14:08:41Z: nlq-pipeline.md re-stamped after docs/queries.md's Tuning paragraph named the current default model; the sections this pointer doc cites (how translation works, endpoint, fallback, stop words) are unchanged.
- 2026-10-05T14:05:02Z: Groq model fix. compose-file-topology-and-drift.md gained one sentence on the LLM env (OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL) living only in docker-compose.traefik.yml, and was re-stamped with clickhouse-retention-and-memory-limits.md and ingestion-pipeline.md after DEPLOYMENT.md, docs/configuration.md, CHANGELOG.md and docker-compose.traefik.yml changed. The ClickHouse mounts, logging anchor, [0.1.1] notes and "Ingestion sources" section these docs cite are unchanged.
- 2026-10-05T13:27:56Z: CHANGELOG.md 0.3.0 section corrected after review (upgrade notes for text_log, log views and the NAT64 env var); the two docs listing CHANGELOG.md cite only the [0.1.1] note, which is unchanged. Re-stamped.
- 2026-10-05T13:20:01Z, clickhouse-retention-and-memory-limits.md and compose-file-topology-and-drift.md re-stamped after CHANGELOG.md was cut to 0.3.0. Re-verified: the CHANGELOG [0.1.1] notes and the config.d verification command these docs cite are unchanged.
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
