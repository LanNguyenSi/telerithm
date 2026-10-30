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

### Upgrade notes

- **The backend now applies versioned Prisma migrations at start instead of `prisma db push`, and its first start records the existing database as migrated.** Back up before that deploy (`./scripts/backup.sh /backups/telerithm`). The first start of this version compares the existing database (tables, no `_prisma_migrations`) with `backend/prisma/baseline.prisma`, the frozen schema of the baseline migration (not with the current `schema.prisma`, which later migrations change). When they match, as they do for a database last started by v0.4.0 or later with no schema change by hand since, it records the baseline migration `20261027132152_baseline` as applied without running it, and the server starts as before; the log shows `migrate: the database matches the baseline schema prisma/baseline.prisma, recording the baseline migration 20261027132152_baseline as applied.` When they differ, the backend logs the difference and `Database migrations did not complete; the server is not started.`, changes nothing and restarts; under deploy-panel the relay's `compose up` step fails (`dependency failed to start: container ... is unhealthy`; the Prisma output is in `docker compose logs backend`) and `rollback: true` redeploys the previous release, which still runs `prisma db push`. The recovery is in DEPLOYMENT.md, "Database migrations"; an installation older than v0.4.0 deploys v0.4.0 first. From now on a relay rollback does not undo a migration, so every migration has to keep the previous release working (expand/contract, same section). A migration that fails part way can leave part of itself applied (the enum value removals Prisma wraps in their own `BEGIN`/`COMMIT`), so check what was applied before choosing `--rolled-back`; DEPLOYMENT.md, "When a migration fails".
- **The ClickHouse per-query limits now apply, so a query that needed more than 2 GiB fails.** `max_memory_usage` is 2 GiB per query, and `GROUP BY` and `ORDER BY` spill to disk from 1 GiB. Until now only the server-wide ratio applied and a single query could grow until it hit the server limit (about 2.55 GiB in the 3 GiB container). The deploy recreates the ClickHouse container once (the `chdata` volume is kept) because both prod composes gain a `users.d` mount and an environment variable. Check afterwards that `SELECT name, value FROM system.settings WHERE name IN ('max_memory_usage', 'max_bytes_before_external_group_by', 'max_bytes_before_external_sort')` returns `2147483648`, `1073741824` and `1073741824`. The ClickHouse service also gets `CLICKHOUSE_SKIP_USER_SETUP: "1"`: newer clickhouse-server images (measured on 24.12.6.70) write `users.d/default-user.xml` on every start, which fails on the read-only mount, and the variable makes them skip it (24.10, the current `:24`, ignores it). Do not set `CLICKHOUSE_USER` (other than `default`), `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_PASSWORD_FILE` or `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT` on the service either: on 24.10 the entrypoint then cannot write its user file to the read-only mount and the container exits at start, and on newer images the skip variable makes it ignore them (DEPLOYMENT.md, "ClickHouse configuration changes", shows how to define a user in a file instead, and what to check when the image tag moves). If a query now fails: the sign is the error code `MEMORY_LIMIT_EXCEEDED` with the 2.00 GiB maximum in the message (on 24.10 worded "Memory limit (for query) exceeded") in the backend logs, or an HTTP 500 on the dashboard or patterns routes. The way back without a redeploy is to raise `max_memory_usage` in `backend/clickhouse/users.d/limits.xml` on the host (ClickHouse applies it to new queries within seconds, no restart) and commit the change so the next `git pull` does not conflict with it; the other way is to revert this change or roll back with the relay. A per-query cap does not bound concurrent queries: several 2 GiB queries at once can still reach the server-wide limit, which stays at about 2.55 GiB.

### Security

- **The dev stack's backend and frontend ports are published on the loopback interface only.** `docker-compose.yml` published `4000:4000` and `3000:3000` without a host IP, so with the stack up anyone on the same network could open http://<host>:3000, and, because the dev stack registers `admin@telerithm.local` as instance admin with open signup by default, register that address first and own the instance. Both entries are now `127.0.0.1:4000:4000` and `127.0.0.1:3000:3000` (the datastore ports were already loopback), so nothing is reachable from another machine; reach the stack from one with an SSH tunnel (`ssh -L 3000:localhost:3000 -L 4000:localhost:4000 <host>`) (README, DEPLOYMENT.md). `docker-compose.prod.yml` keeps its all-interface `4000`/`3000` publishes by design: it is the non-Traefik reference variant, fronted by a firewall or reverse proxy of the operator's choosing. `scripts/dev-compose-loopback.test.sh` (a step in the CI job "Shell script tests") fails when any published port of `docker-compose.yml` is not bound to `127.0.0.1` (long syntax needs `host_ip: 127.0.0.1`), with controls on mutated copies.
- Lockfile-only bumps for GHSA-6pq8-jhm2-2vcw (`qs.stringify` with `arrayFormat: 'comma'` throws on array elements with a non-callable own `toString`): `backend/package-lock.json` qs 6.16.0 -> 6.16.2, `frontend/package-lock.json` qs 6.16.0 -> 6.17.0 (dev only), within the existing manifest ranges.

### Added

- **The Subscriptions page can create, switch off and delete alert subscriptions.** `/alerts/subscriptions` was a read-only list that told the user to `POST /api/v1/subscriptions`. It now has a New subscription dialog (rule or all rules in the team, channel Webhook, Slack or Microsoft Teams, the URL, a signing secret for webhooks, severities; the API's own message is shown when it refuses, for example a private-range host) and a Subscribe shortcut on each rule. Each subscription has an Enabled switch, Send test (not for `EMAIL`, which sends nothing) and Delete with a confirmation naming channel and rule. No control is hidden by role, because the API lets every team member manage their own subscriptions. Frontend only; `POST`, `PUT`, `DELETE` and `/test` on `/api/v1/subscriptions` are unchanged.
- **A CI check for the ClickHouse config and its mounts.** `scripts/clickhouse-config-guard.sh` (job "ClickHouse config" in `.github/workflows/ci.yml`) renders `docker-compose.prod.yml` and `docker-compose.traefik.yml` and fails when the `clickhouse` service does not mount `init.sql`, `config.d` and `users.d` read-only in both with the same set, when an XML file in `backend/clickhouse/config.d` or `users.d` is malformed or lacks the `<clickhouse>` root element, when `config.d` holds a `<profiles>` block (ClickHouse ignores it there), or when the service sets `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_PASSWORD_FILE` or `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT` or drops `CLICKHOUSE_SKIP_USER_SETUP`. `scripts/clickhouse-config-guard.test.sh` runs the guard against mutated copies and requires each to fail with its own message.

### Changed

- **The `frontend` service has a healthcheck in all three compose files, and the ClickHouse config guard now also compares the prod composes' logging and limits.** The probe is `node -e fetch(...)` against `http://127.0.0.1:3000/` without following the redirect (not `localhost`, which resolves to `::1` first inside the container while Next listens on `0.0.0.0` only) (the image has no curl or wget; `/login` renders with a call to the backend and answers 500 while the backend is down, `/` is answered by the middleware alone); the prod composes use the backend's values (30 s interval, 10 s timeout, 3 retries, 30 s start period), the dev compose its dev values. The deployed Traefik v2.11 routes only to containers that are healthy or have no healthcheck, so the next deploy leaves `demo.telerithm.cloud` without a frontend route from the recreate until the first probe succeeds (about 5 s on Docker Engine 25 and later, up to the 30 s interval on older engines); nothing to do by hand, check that `docker compose ps` lists the frontend as `healthy`. Compose does not restart an unhealthy container, and Traefik stops routing to it until a probe succeeds again, so alert on `unhealthy` (DEPLOYMENT.md, "Monitoring"). `scripts/clickhouse-config-guard.sh` renders with `--profile '*'` (a service behind a compose profile is checked too) and fails when a service of either prod compose lacks a bounded `json-file` log, memory and cpu limits or a healthcheck, or when the rendered `logging`, `healthcheck` or the limits of a service differ between `docker-compose.prod.yml` and `docker-compose.traefik.yml`; `scripts/clickhouse-config-guard.test.sh` has a control per branch.
- **`make deploy`, `make deploy-backend` and `make deploy-frontend` now pull newer base images.** The build line is `build --pull --no-cache`; without `--pull` the rebuild without cache still reused the base image already on the host, so a security update in a base image only arrived after a manual `build --pull`. The next `make deploy` re-downloads the base images of the Dockerfiles (a longer first build, and it needs the registry reachable); nothing else changes and no manual step is needed. DEPLOYMENT.md, "Updating", no longer says `make deploy` skips the re-pull. `scripts/make-deploy.test.sh` pins `--pull --no-cache` for each of the three targets.
- **The Postgres schema is versioned as Prisma migrations instead of being pushed on every start.** `backend/prisma/migrations` holds a baseline migration of the current schema, the file `prisma migrate dev --create-only` writes as a first migration; the `prisma migrate diff --from-empty --to-schema-datamodel` script differs from it only by a leading `CREATE SCHEMA IF NOT EXISTS "public"` (Postgres refuses that statement to a role without CREATE on the database even when the schema exists) and a trailing blank line. `backend/scripts/migrate.sh`, run by `backend/entrypoint.sh` before the server and by `npm run db:migrate` (which `make setup` now uses), runs `prisma migrate deploy` when the database has a migration history or is empty; for a database from before migrations it records the baseline as applied only when `prisma migrate diff` finds the database equal to `baseline.prisma`, and otherwise exits 1 without changing anything. It never runs `prisma db push`, and it calls the Prisma CLI from `node_modules`, so a start cannot fetch another Prisma version through npx. The `.relay.yml` `post_update` hook, a second `prisma db push` that applied `schema.prisma` outside the migrations, is gone; the entrypoint is the only schema writer, and a failed migration keeps the backend unhealthy, so the relay's `compose up` step fails (`dependency failed to start: container ... is unhealthy`) and the deploy rolls back, with the Prisma error in `docker compose logs backend`. CI applies the migrations to its empty Postgres service and fails when the result differs from `schema.prisma`, so a schema change without a migration fails; `scripts/backend-migrate.test.sh` (job "Backend entrypoint") runs every branch of the start step against a stub Prisma CLI, and `scripts/relay-config.test.sh` now fails when a relay hook changes the database schema. `npm run db:push` stays only as a shortcut for a throwaway local database.
- **Deploys through deploy-panel / agent-relay no longer rebuild images before the pull.** `.relay.yml`'s `pre_update` held one entry, `docker compose -f docker-compose.traefik.yml build --no-cache backend frontend` (58.6 s measured per deploy), but agent-relay runs `pre_update` against the pre-pull tree, so it built the old commit and agent-relay then built the pulled commit again from cache (0.9 s). The key is gone, so deploys build the pulled commit once; a hard rebuild for a changed base image or a stale layer stays a manual step (`make deploy`, DEPLOYMENT.md "Updating"). `scripts/relay-config.test.sh` (job "Relay config" in `.github/workflows/ci.yml`) parses `.relay.yml` the way the relay loader does: entries must be strings, a present-but-empty `pre_update` (null) fails every deploy at load time, and any `pre_update` entry that builds images fails with its own message.

### Fixed

- **The backend healthcheck probes `127.0.0.1` in all three compose files, like the frontend's already did.** Inside the container `localhost` resolves to `::1` first while the backend (`HOST: 0.0.0.0` in all three files) listens on `0.0.0.0` only, so the `fetch` probe against `http://localhost:4000/api/v1/health` depended on the Node IPv6 fallback; it now asks `http://127.0.0.1:4000/api/v1/health`. `scripts/clickhouse-config-guard.sh` fails when the backend healthcheck of `docker-compose.prod.yml` or `docker-compose.traefik.yml` does not probe that URL, and `scripts/clickhouse-config-guard.test.sh` controls the branch with copies whose probe host was reverted to `localhost` (the guard and its test now also take their scratch directory from a fail-closed `mktemp` under `$TMPDIR`, like the other shell tests). After the deploy check that `docker compose ps` lists the backend as `healthy` and the demo API answers 200 on `/api/v1/health`, else roll back.
- **`scripts/collect-docker-logs.sh` sends each container log line once instead of re-sending the tail on every cron run, and follow mode resumes instead of replaying the container history.** The script keeps a state file per source and container under `TELERITHM_STATE_DIR` (default `${XDG_STATE_HOME:-$HOME/.local/state}/telerithm-collector`, directory `0700` and re-applied with `chmod` on every run so a pre-existing looser one is tightened, files `0600`, the API key never stored) holding the newest timestamp all of whose lines the ingest API accepted with 202; the next run reads `docker logs --since <that timestamp>` and skips the inclusive boundary line. The state never moves past a line whose send failed: a failed send leaves that container's state where it was and freezes it for the rest of its processing (a later accepted batch for the same container says nothing about the failed batch's lines); the freeze is per container, so a failure for one container never freezes another, and a batch the API keeps rejecting stalls that container's state so its later lines are re-sent on every run until the cause is fixed. A one-shot (cron) run exits non-zero, after all containers were processed, if any send failed, so cron mail or monitoring notices (a run whose sends are all accepted still exits 0). Batches are held back on a shared timestamp so a saved timestamp never has lines in a later batch, so nothing is lost silently (at-least-once: a failure costs duplicates, a container recreated under the same name needs its state file deleted until its new log passes the stored timestamp). A follow (systemd) run passes `--follow --since <state>` and writes the state after every accepted batch, so `systemctl restart` resumes; a first start reads only the last `TELERITHM_TAIL_LINES` lines; after a failed send it exits non-zero immediately so a `Restart=always` unit restarts and resumes from the last good timestamp (the unit keeps systemd's default `KillMode=control-group`, which takes the follow-mode `docker logs --follow` child with it on that restart, since the script cannot kill that process-substitution child itself across bash versions). An empty or corrupt state file is treated as no state with a `[WARN]`. The cron recipe in `scripts/README.md` and the hint `scripts/setup-sources.sh` prints now run the script under `flock -n /var/lock/telerithm-collector.lock` (an overlapping run would double-send) and say the line is an `/etc/cron.d/telerithm-collector` line (the `root` user field is valid only in `/etc/cron.d` files, not in a user crontab), the README documents the state and splits the dependency list per script (`collect-docker-logs.sh`: docker, jq, curl; `setup-sources.sh`: jq, curl). New `scripts/collect-docker-logs.test.sh` (stub docker and curl, failure-injection stubs for the frozen-state and timestamp-boundary cases; also run by the "Shell script tests" CI job).
- **`scripts/backup.sh` retention removes only backup directories this script wrote.** The cleanup step ran `ls -d */` and `find -maxdepth 1 -type d -mtime +10 -exec rm -rf` over the whole backup directory, so a cron line that named `/backups` instead of `/backups/telerithm` deleted every other application's directory there that was older than 10 days, and everything beyond the newest 10 directories regardless of name. It now considers only real directories (not symlinks) named `YYYYMMDD_HHMMSS` that hold both `postgres.sql.gz` and `clickhouse_logs.native.gz`, ranks the newest 10 by the timestamp in the name, never removes the backup the run just wrote, and leaves every other entry alone with one stderr line saying how many (a timestamp directory without both dumps, for example one left by a killed run, stays and is counted there; remove it by hand). A correct `/backups/telerithm` setup prints no note. A failed removal of an old backup prints a warning on stderr per entry and the loop goes on; the off-host hook still runs for the new backup, and the run then exits 2 with `ERROR: retention could not remove N old backup(s); the backup is complete` (a failed hook exits 1 and wins over 2), so a cron job or monitor notices that housekeeping has stopped. When `rm` removed an old backup's dumps but not the rest (a locked subdirectory), only that run exits 2: the entry is no longer a complete backup, so later runs leave it alone, exit 0 and report it only in the "left alone" line; an old backup `rm` cannot remove at all stays complete, so every later run exits 2 again until it is removed. Every other failure exits 1 whatever the failing command's own status, so a dump that exits 2 (or 137 after a kill) cannot look like the retention failure; a failed dump or rename names the step on stderr and leaves no backup directory. The timestamp pattern is an explicit `[0123456789]` class, so under a UTF-8 locale on glibc a directory named with fullwidth digits is not taken for a backup. New cases in `scripts/backup.test.sh` cover foreign directories, symlinks, incomplete directories, names with spaces, newlines and leading dashes, the count and age rules, a clock that ranks the new backup oldest, a dangling symlink at the backup path, a directory created between the existence check and `mkdir`, a non-removable old backup on the age and the count path with each prune and hook outcome and the run after it (skipped as root), a failed dump or rename that exits 2 or 137, and a fullwidth-digit directory under a UTF-8 locale (run only where `[0-9]` matches a fullwidth digit, which glibc's `en_US.UTF-8` does and `C.UTF-8` does not; skipped otherwise).
- **The shell test scripts no longer delete the directory they were started from when `mktemp` fails.** `scripts/backup.test.sh`, `scripts/backend-migrate.test.sh` and `scripts/make-deploy.test.sh` used the `mktemp -d` result unchecked: when it failed (for example a `TMPDIR` that does not exist), `cd ""` stayed in the current directory under bash 3.2 and 5.2, that became the scratch path, and the `EXIT` trap ran `rm -rf` on it (started from the repository root, that is the checkout with `.git`). Each now exits 2 when `mktemp` fails or prints no directory, resolves the path only after that check, and its trap removes the path only when its last component is the script's own template name; each pins that cleanup with a decoy directory. The new `scripts/test-scratch-safety.test.sh` (step "Test scratch directory safety" in the CI job "Shell script tests") starts every `scripts/*.test.sh` from a directory holding one canary file with a `TMPDIR` that does not exist, under each bash it finds (bash on `PATH`, and `/bin/bash` when it is another version), and fails when the directory loses the canary or gains a file; each run has its own process group and a time limit, and four controls run first (a script that deletes the canary and one that writes a file must be caught, one that never ends and ignores SIGTERM must be stopped with its whole group, a child left running must be killed).
- **When a confirmed dialog action removes the element that opened the dialog, focus lands on a surviving neighbour instead of the page body.** The remove flows (admin team chip, alert rule delete, source delete, subscription delete) close the dialog on Confirm and remove the opener only when the awaited API call resolves, so the restore-to-opener ran while the opener was still there and focus died with it. The dialog now keeps the opener's ancestors it captured on open and watches briefly after close (a bounded `MutationObserver`: ends on the removal handled, any user focus, keyboard or pointer activity, a 3 s timeout, or unmount); when the removal lands and focus has nowhere of its own, focus moves once to the nearest captured ancestor that is still connected (made focusable with `tabindex="-1"`, so the user card region or the list), else to the `main` landmark. A click, keypress or focus of the user's own cancels the watch, so nothing is stolen, and Cancel, Escape, backdrop and an opener that survives behave exactly as before. Generic to the dialog; no consumer changed. New cases in `frontend/tests/dialog-focus.test.tsx`.
- **Confirm dialogs manage keyboard focus, and the page behind the mobile navigation drawer is inert.** A dialog (confirm, prompt, save view) now moves focus into itself when it opens (the Cancel button for the confirm variant, the text input for the other two), keeps Tab and Shift+Tab inside, and gives focus back to the element that opened it on every way of closing (Cancel, Confirm, Escape, backdrop click) as long as that element is still on the page; before, focus stayed on the opener behind the dialog. While the mobile drawer is open, the top bar with its toggle, the desktop sidebar and the page content carry `inert`, so assistive technology and the keyboard no longer reach them; the attribute is removed on every close path (Escape, overlay click, choosing a link, growing past 1024 px, the toggle) before focus returns to the toggle. Frontend only; the dialog props and the drawer markup order and look are unchanged.
- **`scripts/backup.sh` reports a real `mkdir` failure as itself and ignores `CDPATH`; the shell tests now run in CI.** The "backup directory already exists" message was printed for every `mkdir` failure (a read-only backup directory looked like a same-second collision); the script now decides by `[ -e ]` before `mkdir`, and any other failure shows mkdir's own error. An exported `CDPATH` could send the backup directory, the off-host hook path or the script's own directory to a same-named directory elsewhere (and `cd` printed the path into the command substitution); every `cd` in the script now runs with an empty `CDPATH`. New cases in `scripts/backup.test.sh` (read-only directory, skipped as root; `CDPATH` with decoy directories). The job "Shell script tests" in `.github/workflows/ci.yml` runs `scripts/backup.test.sh` and `scripts/make-deploy.test.sh`, which no job ran before.
- **The start-time baseline compares a database from before migrations with a frozen `backend/prisma/baseline.prisma`, not with the current `schema.prisma`.** `baseline.prisma` is the schema of the baseline migration `20261027132152_baseline` and never changes. With the old comparison, the first migration added after the baseline would have made the start refuse a database at the baseline, and would have recorded a database equal to the new schema as baselined just before `prisma migrate deploy` re-applied the new migration and failed (`P3018`, then `P3009` on every start). Now the start records the baseline for a database equal to `baseline.prisma` and `prisma migrate deploy` applies the later migrations on top; a differing database, or a missing `baseline.prisma`, exits 1 without changing anything. The runtime image already ships the file (the Dockerfile copies `backend/prisma/` whole). The job "Backend" fails when `baseline.prisma` stops reproducing the baseline migration's SQL (step "Check baseline.prisma matches the baseline migration"; Prisma's `CREATE SCHEMA` header and trailing blank line are cut before the byte comparison), builds its before-migrations fixtures from `baseline.prisma`, and runs `scripts/baseline-second-migration.test.sh` against the real Postgres service: a scratch second migration is applied on top of a baselined database, and a database equal to the extended schema is refused untouched. DEPLOYMENT.md, "Database migrations", describes the comparison and the recovery.
- **Every dashboard page now has exactly one h1 naming the page.** The overview, dashboards, logs (today, search, detail), issues, alerts, subscriptions, settings and admin pages had no level-one heading (axe `page-has-heading-one`); existing page titles (`Alerts`, `My Subscriptions`, the `Issues` and `Admin` card eyebrows) were promoted to `h1` with their classes unchanged, the pages without a title got one, and the facet groups on the search page moved under an `h2` so no heading level is skipped. New tests: `frontend/tests/page-headings.test.tsx`.
- **The auth pages have a main landmark and the two dashboard navs are distinguishable.** `LoginForm` and `RegisterForm` now render their page in `<main>` (axe `landmark-one-main`, `region`); the app sidebar nav is labelled "Main", the logs tabs nav "Logs sections", and the single back control on `/logs/<id>` is a plain `div` instead of an unnamed `nav` (axe `landmark-unique`). New tests: `frontend/tests/auth-page-main.test.tsx`, `frontend/tests/nav-landmark-labels.test.tsx`.
- **The wide desktop tables can be scrolled with the keyboard.** The issues table container (measured: 39 px of sideways overflow at 1280 px viewport) and the log table container are now labelled focusable regions (`tabIndex={0}`, `role="region"`, `aria-label`, plus a 2 px slate focus ring drawn inside the box), so a keyboard user can tab to them and scroll sideways with the arrow keys (axe `scrollable-region-focusable`). New test: `frontend/tests/scrollable-table-regions.test.tsx`.
- **Dark-theme muted text now reaches at least 4.5:1 contrast on every dark surface it is used on.** `--color-muted` in `.dark` was `#8892a4`: 3.53:1 on the admin table's team chips (`#363c47`) and 4.10:1 on select backgrounds (`#2c323e`), both under the WCAG AA threshold. The token is `#a8b1c1` (5.13:1 and 5.95:1 on those surfaces, 8.76:1 on the darkest, the page background), verified with axe on `/admin`, `/logs`, `/logs/l1` and `/alerts` in dark. The light theme is unchanged.
- **A desktop table scroll region is a tab stop only while it overflows, and the dark muted contrast is pinned by a test.** `tabIndex={0}` was put on both desktop table regions unconditionally, so a table that fits still took a tab stop that could not scroll (at 1280 px the log table fits: `scrollWidth` 966 of `clientWidth` 966, and the stop stayed). The region is now measured (`scrollWidth > clientWidth`) when it is attached, whenever its columns or rows change, and on every `ResizeObserver` notification for the region or for the content inside it (the same observer watches the region and its first child, the table, so the tab stop also follows table growth the review key cannot see: refetched cell content, a webfont swap, expanded rows); `tabIndex` is set only while it overflows, `role="region"`, the label and the focus ring stay either way, and a missing `ResizeObserver` (older browsers, jsdom) falls back to the plain measurement instead of crashing. New hook `frontend/src/components/ui/use-overflow-tabindex.ts`, states in `frontend/tests/scrollable-table-regions.test.tsx`. The second half: the dark `--color-muted` bump above is now pinned by `frontend/tests/dark-muted-contrast.test.ts`, which reads `--color-muted` and `--color-paper` out of the `.dark` block of `globals.css` and requires 4.5:1 on the dark page background and on the two surfaces the old value failed (5.13:1 and 5.95:1 now); the CSS token values are unchanged by this entry. The two surfaces, `#363c47` (admin team chips) and `#2c323e` (select backgrounds), are translucent white composited over the dark card over the page: they exist in no CSS token, are named constants in the test, and were measured with axe on the rendered pages, which is the limit of what that test can pin.
- **Small click targets on the log table, log detail, admin and alerts screens are now at least 24x24 CSS px (WCAG 2.5.8).** The `details` buttons (44x19), the field `filter` link (32x19) and the admin `Remove` button (45x16) got `min-h-6 min-w-6` targets, and the alert rule Enabled checkbox (13x13) got a 16px box inside a label that is part of the target (68x26 measured). Text sizes are unchanged.
- **Removing a team member on the admin page asks for confirmation first.** The chip's `Remove` button called the API directly; it now opens the shared confirm dialog naming the user and the team, with Remove and Cancel buttons, and only calls the admin remove-team endpoint on confirm.
- **The shared confirm dialog has an accessible name.** `role="dialog"` carried no name, so every open confirm (log search views, subscription delete, team member removal) triggered axe `aria-dialog-name` (serious). The dialog now sets `aria-labelledby` to its title (`useId`, unique per dialog) and `aria-describedby` to its body when one exists, and `useDialog().confirm` passes `confirmLabel`/`cancelLabel` through, so imperative callers can set English button labels; callers that pass labels on the `Dialog` element keep working.
- **`docker compose -f docker-compose.prod.yml up` can no longer recreate the production containers.** `docker-compose.prod.yml` set no `name:`, so from the production checkout (directory `telerithm`) it resolved to the same project and volumes as `docker-compose.traefik.yml`, and recreated the production containers without the Traefik labels, `OPENAI_*` and `TRUST_PROXY` (the drift behind PRs #59/#60). It now sets `name: telerithm-standalone`, so its containers, network and volumes are separate. `docker-compose.traefik.yml` is unchanged and keeps project `telerithm`. `scripts/clickhouse-config-guard.sh` fails when the prod compose has no `name:`, when the two composes share a project name, volume or network, or when the Traefik compose's project or volume names change. The next production deploy is unaffected.
- **The ClickHouse `default` profile (`max_memory_usage` 2 GiB, `max_bytes_before_external_group_by` and `max_bytes_before_external_sort` 1 GiB) is now read by ClickHouse.** The block sat in `backend/clickhouse/config.d/limits.xml`, but ClickHouse reads profiles only from the users config, so `system.settings` showed all three at 0 and only `max_server_memory_usage_to_ram_ratio` applied. The profile moved to `backend/clickhouse/users.d/limits.xml`, a directory mounted read-only over `/etc/clickhouse-server/users.d` in `docker-compose.prod.yml` and `docker-compose.traefik.yml` (same pattern as `config.d`, so a file replaced by `git pull` is seen without recreating the container). Measured on a local container: before, the three settings read 0 and a 3.6 GiB `groupArray` aggregation was stopped by the server-wide limit ("Memory limit (total) exceeded"); after, they read 2147483648, 1073741824 and 1073741824 and the same query fails with "Memory limit (for query) exceeded". `config.d/limits.xml` keeps the server-wide ratio. The heaviest dashboard and search queries stay under the cap (peak memory below 1 GiB on 8 million rows over 7 days, patterns aggregation 1.0 GiB with spill).
- **The mobile navigation drawer now works from the keyboard and for assistive technology.** The toggle reports `aria-expanded` and `aria-controls`; the drawer is a labelled modal dialog, takes focus when it opens, keeps Tab and Shift+Tab inside it, closes on Escape, on a click on the overlay, on choosing a link and when the window grows to the desktop layout, and gives focus back to the toggle (except after a link, where the navigation decides). The desktop sidebar is unchanged.

### Security

- **The reference log shippers under `deploy/` no longer give a host root lever or an open unauthenticated port by default.** The Fluentd forward input in `deploy/fluentd/fluent.conf` bound `0.0.0.0` without authentication, so anyone who could reach port 24224 could inject log lines; it now binds `127.0.0.1`, with a commented shared-key `security` block and the container and multi-host steps documented in the file header. The Vector service in `deploy/docker-compose.logging.yml` mounted `/var/run/docker.sock`, which is full control of the Docker host even with `:ro`; it now sits behind the `docker-socket` compose profile and starts only with `--profile docker-socket`, and the three files and `docs/configuration.md` say they are references for local or single-host use and what to change for production. A unit test (`backend/tests/unit/deploy-reference-configs.test.ts`) pins the loopback bind, the comment-only auth block, and that a service mounting the socket has a profile. Operational note: a deploy does not touch these files; anyone who copied them must re-copy, and `docker compose ... up` with the logging overlay no longer starts Vector unless `--profile docker-socket` is given.

### Docs

- **The relay env-file contract is written down, and two doc lows are corrected.** DEPLOYMENT.md, "Updating", now says which env file a deploy reads: a relay deploy runs compose in the app checkout without `--env-file` (as of agent-relay commit `b5c6f7effb96`; the relay app config has no env-file option and silently drops an `env_file:` key in `.relay.yml`), so Docker Compose reads the checkout's `.env` there and never `.env.production`, while `make deploy` and the manual commands read `.env.production` via `--env-file`. On a relay-managed host `.env` is the file that counts (the deploy-panel env editor and secret provisioning write it), `.env.production` is kept as an identical copy, and a symlink between them is not recommended because the editor replaces `.env` with a regular file; `config --quiet` and `cmp .env .env.production` validate the setup. `.relay.yml` carries a comment pointing at that section. LOCAL_LLM.md takes the served model name from the server: step 2 says to copy `data[0].id` from the `/v1/models` response into `OPENAI_MODEL` verbatim, and the verification snippet calls `process.env.OPENAI_MODEL` instead of a hardcoded model file name. `docs/api.md` names the spec's alert-rule and incident-list routes where it said "alert-list" (re-checked against `backend/src/api/openapi.ts`).

## [0.4.0] - 2026-10-25

Minor release: tenant-isolation fixes on the by-id API routes, log
source management (rename, delete, ingest-key rotation, list keys only
to OWNER and ADMIN), alert-rule create, edit and delete from the API
and Settings, a URL guard that pins the vetted address, ClickHouse
config files delivered as a directory mount, a zod 4 backend and a
Tailwind CSS 4 frontend, and a run of dependency advisories closed.
Backend and frontend version in lockstep as the app suite. The SDK
(`@telerithm/sdk`) has its own changelog and release (0.1.1).

### Upgrade notes

- **First deploy recreates the ClickHouse container once** because its
  mounts changed (the `chdata` volume is kept). The compose project is
  now pinned to `telerithm` in `docker-compose.traefik.yml`; confirm
  the deployed stack already runs under that project name before the
  deploy.
- **Schema change:** `prisma db push` makes `AlertSubscription.rule`
  `ON DELETE CASCADE`.
- **API contract changes:** `GET /api/v1/sources` omits `apiKey` for
  MEMBER and VIEWER; incident actions answer 409 on a wrong status;
  channel `EMAIL` is rejected with 400 on create and update;
  `MAX_PAGE_SIZE` above 500 is clamped to 500; ids that belong to
  another team answer 404 instead of 403.
- **Known gap:** the `<profiles>` block of `limits.xml` is not applied
  by ClickHouse from `config.d`, so only the server-level memory ratio
  takes effect. A follow-up is open; this release does not change it.

### Security

- **Webhook, Slack and MS Teams deliveries now connect to the address the URL guard checked.** The guard resolved the target host and the HTTP client then resolved it a second time, so a host that answered a public address first and a private one second (DNS rebinding) could steer a delivery, including the one from `POST /api/v1/subscriptions/:id/test`, to an internal address. A delivery now resolves the name once, checks every address it returned, and connects only to one of those checked addresses; the Host header, the TLS server name and the certificate check stay on the URL's host name, and an IP-literal URL behaves as before. Redirects are still never followed (a 3xx counts as a failed delivery). A URL with embedded credentials (`https://user:pass@host/`) used to fail locally and is now delivered, without an Authorization header; the credentials are not sent. These requests no longer go through the Node runtime's `fetch`, so an environment proxy for `fetch` (`NODE_USE_ENV_PROXY` with `HTTPS_PROXY` or `HTTP_PROXY`, on Node versions that support it) is not used for them: a deployment that must send notifications through a proxy has to allow direct egress to the targets, or run without that proxy setting for the backend. The repository's own compose files set none. No schema change and no deploy step beyond the usual rebuild.
- **Ingest keys of log sources are no longer listed to every team member.** `GET /api/v1/sources` returned each source's `apiKey` to any member of the team, including a read-only `VIEWER`. The field is now present only for `OWNER` and `ADMIN` and absent from the response (not masked) for `MEMBER` and `VIEWER`. `POST /api/v1/sources` still returns the new key once to the creating writer, a `MEMBER` included, so a new source stays usable; no later read returns it to that member. A `MEMBER` who needs the key of an existing source has to ask an `OWNER` or `ADMIN`. Clients that read `apiKey` from the list must treat it as optional; the Settings page already renders a source without a key.
- **By-id write routes no longer reveal whether an id exists in another team.** `PUT` and `DELETE /api/v1/alerts/rules/:id`, `POST /api/v1/alerts/rules/:id/mute` and `/unmute`, `DELETE /api/v1/maintenance-windows/:id`, `POST /api/v1/alerts/incidents/:id/acknowledge`, `/resolve` and `/reopen`, and `PUT /api/v1/issues/:id` answered 404 for an unknown id but 403 for an id owned by a team the caller is not in. A caller who is not a member of the owning team now gets the same 404 and the same body (`Alert rule not found`, `Maintenance window not found`, `Incident not found`, `Issue not found`) as for an unknown id. A member of the owning team without write access (`VIEWER`) still gets 403, and routes that take the team from the request body (`POST /sources`, `POST /alerts/rules`, `POST /maintenance-windows`) keep their 403 for a non-member. Clients that treated 403 on these routes as "not your team" should expect 404.
- **By-id read routes and the invite revoke no longer reveal whether an id exists in another team.** `GET /api/v1/issues/:id`, `GET /api/v1/alerts/incidents/:id/timeline`, `GET /api/v1/query/jobs/:id` and `DELETE /api/v1/invites/:id` answered 404 for an unknown id but 403 for a resource of a team the caller is not in. A non-member now gets the same 404 and the same body (`Issue not found`, `Incident not found`, `Job not found`, `Invite not found`) as for an unknown id. Own-team answers are unchanged, and a member of the invite's team who may not manage invites still gets 403. Clients that treated 403 on these routes as "not your team" should expect 404.
- **A failing team-membership lookup now answers 500 instead of 403 or 404.** The team-membership check treated every error from the membership lookup as "not a member", so a transient database error told a member of the owning team `Alert rule not found` (or `Incident not found`, `Issue not found`) on a by-id write route, or `Forbidden` elsewhere, for a resource that exists. Only the lookup's "no membership" outcome maps to 403 or 404 now; any other error reaches the error handler as a 500 `Internal server error`.
- **`POST /api/v1/subscriptions` now rejects a `ruleId` that does not belong to the body's `teamId`** with 404 `Alert rule not found`, the same answer as for a nonexistent rule, so a member of one team can no longer subscribe to another team's rule and read its name through the subscription list. `PUT /api/v1/subscriptions/:id` takes no `ruleId` and is unchanged. Subscriptions created before this check are not migrated; one that already points at a rule of another team stays listed for its owner (who can still delete it), but `GET /api/v1/subscriptions` now returns it with `rule: null` instead of the rule object, so the rule's name is no longer shown (`ruleId` keeps the id the subscriber supplied). No schema change and no deploy step beyond the usual rebuild.
- **Log views: MEMBER and VIEWER can no longer edit, unshare, clear the default of, or delete a view that is already shared or default**, even when they own it (task 9edca718). `PUT` and `DELETE /api/v1/logs/views/:id` answer 403 with no mutation, judged on the loaded view; private non-default views stay with their owner. Shared or default views owned by non-admins are not migrated and are now managed by an OWNER or ADMIN, who can change and delete any shared view in their team. On another user's private default view an OWNER or ADMIN may only clean up: `PUT` with only `isDefault: false` (its 200 omits `name` and `definition`) and `DELETE`; every other request there (`isShared: true`, rename, definition change, `isDefault: true`, empty body) is 403 with no mutation.
- Fleet audit workflow: the raw `npm audit` output of the runtime moderate gate step is printed between a per-run random `::stop-commands::` token and its resume line, so registry-supplied text cannot act as a workflow command (task da9631f4). Gate exit codes unchanged.
- **next 15.5.27** (GHSA-mcj8-r9mp-w47p, GHSA-4jqv-mc3x-m676) in `frontend/`: the lockfile resolves 15.5.27 with its matching `@next/env` and `@next/swc-*` packages and the `next` dependency floor is now `^15.5.27`.
- **next 15.5.28** (GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r) in `frontend/`: the lockfile resolves 15.5.28 with its matching `@next/env` and `@next/swc-*` packages and the `next` dependency floor is now `^15.5.28`, superseding the 15.5.27 entry above.
- **Tailwind CSS 4** (GHSA-rj75-hqrm-r3gf) in `frontend/`: the frontend is migrated from Tailwind CSS 3.4 to 4, which drops `postcss-selector-parser` 6.x (quadratic selector parsing, no fix on the 6.x line) from the lockfile. The theme moves into `src/app/globals.css` (`@theme`), `tailwind.config.ts` is removed (and no longer copied by `frontend/Dockerfile`), and PostCSS uses `@tailwindcss/postcss`. Opacity modifiers on the custom colours (for example `bg-panel/85`, `bg-danger/10`, `border-line/70`) were silently dropped by Tailwind 3 and are now rendered, so cards, error icons, table rules and the sidebar avatar look slightly different, as intended. No API change.
- **sharp 0.35.5** (GHSA-wq5f-xc86-pv6w, task aff72e2b), in `frontend/`, installed through `next`: the lockfile resolves 0.35.5 with matching `@img/*` binaries and the `sharp` override floor is now `^0.35.5`.
- **ip-address 10.7.4** (GHSA-rxp7-6hxx-x8q5) in `backend/`: the lockfile resolves 10.7.4, which fixes quadratic-time matching of a zone identifier in `Address6`, so a long input string can no longer stall a process. It is installed through `express-rate-limit`.
- **body-parser 1.20.9** (GHSA-27r3-jxmh-p828): the lockfile resolves 1.20.9, so trailing bytes after a compressed request body no longer cause a denial of service.
- **undici 7.30.1** (GHSA-xjj6-f33q-929c, GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472): the lockfile resolves 7.30.1, which fixes a denial of service via excessive content-encodings, unbounded memory in the EventSource parser and a Subresource Integrity bypass. It is a development dependency (installed through `jsdom`).
- **zod 4.6.7** (GHSA-mrhx-c7xc-m3w5): the lockfile resolves 4.6.7, so validating an oversized constrained collection no longer exhausts memory. It is a development dependency.
- **zod 4** (GHSA-mrhx-c7xc-m3w5) in `backend/`: the backend's direct dependency moves from zod ^3.24.2 to ^4.6.7 (the lockfile resolves 4.6.7, no zod 3 left), with the schemas migrated to the native v4 API and no `zod/v3` import. The v3 accept sets and outputs are kept where zod 4 changed semantics: config URL fields still return the input unchanged (a padded env value keeps its spaces), datetime fields still accept the minute-precision form (`2026-01-01T10:00Z`) and still reject offsets, integer fields still accept values above `Number.MAX_SAFE_INTEGER`, free-form number fields still accept `Infinity`, and records now carry an explicit key schema. The 400 error body keeps its exact shape (`{ error: { formErrors, fieldErrors } }`, nested paths flattened under the top-level key). Every default (non-custom) zod message that reaches a 400 body is reworded to zod 4's wording (for example "Invalid email" becomes "Invalid email address"); the body shape is unchanged and the frontend shows that text verbatim in its `field: message` error line, so the wording users see changes even though the JSON shape does not. Custom messages, paths, keys and HTTP statuses are unchanged. No API change and no deploy step beyond the usual rebuild.

### Added

- **Log sources can be renamed.** New route `PUT /api/v1/sources/:id` with body `{ "name": "..." }` (at least 2 characters). `OWNER`, `ADMIN` and `MEMBER` may rename, a `VIEWER` gets 403, and a source of a team the caller is not in answers 404 with the same body as an unknown id. The response carries `apiKey` only for `OWNER` and `ADMIN`.
- **Log sources can be deleted and their ingest key rotated, from the API and from Settings.** New routes `DELETE /api/v1/sources/:id` (204) and `POST /api/v1/sources/:id/rotate-key` (200, `{ "source": { ..., "apiKey": "<new key>" } }`) are for `OWNER` and `ADMIN` only: a `MEMBER` or `VIEWER` gets 403, and a source of a team the caller is not in answers 404 with the same body as an unknown id. Delete removes the source row and its key stops authenticating at once (`403 Invalid API key`), but logs already stored for it are not deleted: they stay until the table-wide ClickHouse retention of 30 days expires (the per-source `retentionDays` value is stored but not enforced). Rotation is a hard cutover with no grace window: the new key replaces the old one in place, the old key is rejected from the next request, and the new key is returned in the rotate response and afterwards appears only in the `OWNER`/`ADMIN` source list, so senders must be updated at once. Settings gets Rename, Rotate key (with a confirm step, the new key shown once with a copy button) and Delete (with a confirm step) per source, visible to `OWNER` and `ADMIN` only; `MEMBER` can still rename through the API. No schema migration and no deploy step beyond the usual rebuild.
- **Alert rules can be created, edited, enabled or disabled and deleted**, and log sources can be created from Settings. New routes `POST /api/v1/alerts/rules`, `PUT /api/v1/alerts/rules/:id` (partial update) and `DELETE /api/v1/alerts/rules/:id` (hard delete in one transaction: every subscription to that rule is deleted with it, whichever team owns it, so none can turn into a team-wide subscription, and its incidents go with it) are team write routes: OWNER, ADMIN and MEMBER may use them, a VIEWER, or a caller who is not a member of the rule's team, gets 403; an unknown id gets 404. `condition` must be `GREATER_THAN`, `LESS_THAN`, `EQUALS` or `CHANGES_BY`, `windowMinutes` 1 to 1440 and `threshold` a non-negative integer; `ANOMALY_DETECTED` (the worker skips it) and a `queryType` other than `sql` on create are rejected with 400 (an update cannot change `queryType`; `name`, `description` and `query` are capped at 200, 1000 and 1000 characters), because `query` is matched as a substring of the log message. `GET /api/v1/alerts/rules` now also returns `condition` and `windowMinutes`. The Alerts page gets New rule, Edit, an enabled toggle and Delete with a confirm dialog, and Settings gets a New source dialog over the existing `POST /api/v1/sources` that shows the new API key once with a copy button; write controls are hidden for a VIEWER. No schema migration and no deploy step beyond the usual rebuild.
- NLQ retry ownership tests also pin a persistent HTTP 503 (3 attempts, the
  app loop retries `server` errors) and HTTP 408 / 409 (1 attempt each, they
  classify as `unknown` and are not retried) (task 9c7a5039).
- `scripts/validate-sender-configs.sh` now fails on two fluentd config mistakes that `fluentd --dry-run` accepts: an unknown parameter or section (the dry run exits 0 and only warns `[warn]: parameter '<name>' in <section> ... is not used` or `[warn]: section <name> is not used in <parent>`; the check fails naming what is unused from that warning's header line, so a config value that merely contains the words "is not used" is not a false failure), and a `#{ENV[...]}` reference to a variable the check does not pass to the container (fluentd substitutes an empty string silently; the check extracts every ENV name and fails naming any it does not set). A dry run that itself exits non-zero still fails the check and is now reported with its own message. Fixtures in `scripts/fixtures/sender-configs/` (negative: `unused-param.conf`, `unused-section.conf`, `unset-env.conf`, `bad-plugin.conf`; positive control: `value-text.conf`) run in the CI job, which fails on each negative control's own message rather than a bare non-zero exit. The shipped `deploy/fluentd/fluent.conf` keeps passing.

### Fixed

- **A deploy that changes the ClickHouse config files (`limits.xml`, `system-logs.xml`, now under `backend/clickhouse/config.d/`) now reaches the running ClickHouse.** Both prod composes (`docker-compose.traefik.yml`, `docker-compose.prod.yml`) mounted the two files one by one. A single-file bind mount pins the file's inode, `git pull` replaces a changed file with a new one, and `docker compose up -d` does not recreate a container whose compose file did not change, so the running ClickHouse kept the old file until someone restarted the container by hand. The composes now mount the directory `backend/clickhouse/config.d/` (the two files moved there) over `/etc/clickhouse-server/config.d`. ClickHouse picks up a changed server setting such as `max_server_memory_usage_to_ram_ratio` within seconds on its own; `system-logs.xml` changes are read at server start, so restart ClickHouse once after changing them. The directory mount hides the image's own `config.d`, so `docker_related_config.xml` (the image's `listen_host` file) is copied into the directory; compare it with the image's file when the ClickHouse image tag changes. Upgrade note: the first deploy recreates the ClickHouse container once because its mounts changed (the `chdata` volume is kept). `init.sql` stays a single-file mount at `docker-entrypoint-initdb.d`: it runs only on an empty data directory, so a stale inode does not matter there. Anyone who added their own `config.d` file by mounting it next to the two shipped files puts it into `backend/clickhouse/config.d/` instead.
- **`scripts/backup.sh` backs up the production stack and fails when it is not running.** It ran `docker compose` without `-f`, which targets `docker-compose.yml` (the local development stack), not the stack `DEPLOYMENT.md` deploys. It now uses `docker-compose.traefik.yml` with `.env.production` (override with `BACKUP_COMPOSE_FILE` and `BACKUP_ENV_FILE`), exits non-zero before writing anything when the file is missing or the `postgres` or `clickhouse` service is not running, writes the ClickHouse dump in Native format as `clickhouse_logs.native.gz` (the format the restore steps in `DEPLOYMENT.md` read; it was JSONEachRow as `clickhouse_logs.json.gz`), removes the directory of a run that fails midway (and refuses to start when the directory for its second already exists, so a run never deletes another run's finished backup), and its retention step works when the backup directory is given as a relative path (the old script changed into that directory and then ran `find` on the same relative path, which failed with exit 1 after the dumps were written). New optional `BACKUP_OFFHOST_HOOK`: an executable (a relative path is taken from where the script is started) called with the finished backup directory, for a copy off the host; unset means local only. Operator step: if cron calls the script, the new file name is the only visible change; point any restore tooling at `clickhouse_logs.native.gz`. Tests: `scripts/backup.test.sh`.
- **`make deploy`, `make deploy-backend` and `make deploy-frontend` no longer stash local changes.** They ran `git stash || true` and never restored the stash, so a documented local edit such as the domain in `docker-compose.traefik.yml` was dropped at the next deploy and the stack came back up with the default domain while the deploy printed success. They now stop before doing anything when a tracked file has staged or unstaged changes, and update with `git pull --rebase origin master`. They also refuse while a rebase or merge is in progress or HEAD is detached. Operator step: commit a local edit on the server checkout before deploying (see `DEPLOYMENT.md`); an edit dropped by an earlier deploy may still be in `git stash list`, and the first deploy after this update still runs the old recipe, because `make` reads the Makefile before `git pull` replaces it. Tests: `scripts/make-deploy.test.sh`.

- **`POST /api/v1/subscriptions/:id/test` notifies only the caller's own subscription.** The route used the rule/team fan-out, so every enabled subscriber of the same rule and team received the test, while the caller's own subscription was skipped when it was disabled or its `severities` excluded LOW. The test now goes to exactly the loaded subscription, also when it is disabled or filters out LOW, and a channel failure after the retries is answered with 500 instead of `ok: true`. The 500 body depends on the failure: a URL guard refusal or a missing URL keeps its own message (it describes the caller's own configuration), a non-2xx answer from the webhook, Slack or Teams target is the generic `The channel rejected the test notification`, and every other failure (a refused connection, a timeout, a resolution failure at send time after the guard passed) is the generic `The channel could not be reached`. The target's HTTP status, status text and network error text are logged server-side only. The route still tells "reached but rejected" apart from "not reached", and its response time differs by failure mode; a name the guard cannot resolve is a guard refusal and keeps its message. Real incident dispatch is unchanged.
- **`scripts/validate-sender-configs.sh` reports a missing parent directory** of a config path with its own message (`parent directory does not exist: ...`, exit 2) instead of a bare `cd` error, and mounts the configs with `--mount type=bind,...,readonly` so a host path containing `:` works. Paths containing `,` are still not supported by `--mount`.
- **Deleting an alert rule can no longer leave a subscription behind as a team-wide one.** `AlertSubscription.rule` is now `onDelete: Cascade`, so the database removes a rule's subscriptions with the rule, even one created concurrently with the delete (previously the foreign key nulled `ruleId`, and the subscription then matched every incident of its team). Subscriptions created without a rule stay team-wide by design and are unaffected. Schema change: the foreign key constraint is replaced by `prisma db push`, which the backend container runs on every start (`backend/entrypoint.sh`), so a normal redeploy applies it with no manual step; for a running container, `docker compose -f docker-compose.traefik.yml exec backend npx prisma db push` applies it by hand.
- Ingestion and senders (task 6f12b5d6): `POST /api/v1/ingest/:sourceId/raw` now parses `text/plain` bodies (a text body used to reach the handler as `[object Object]` and ingest nothing); other content types, JSON included, answer 415, and CRLF line ends are handled. `POST /api/v1/ingest/:sourceId` accepts a bare JSON array as the `logs` list, which is all Fluentd's `out_http` (`json_array`) and Vector's `http` sink can post; before, both configs got 400. The shipped `deploy/vector/vector.toml` did not compile (fallible VRL, a disk buffer below Vector's minimum) and `deploy/docker-compose.logging.yml` never loaded it (the image reads `vector.yaml` unless given `--config`); `deploy/fluentd/fluent.conf` sent the unexpanded `#{ENV[...]}` text as the API key and posted raw Docker records without a `message`. All three are fixed and each was run against a backend. `docker-compose.yml` now has the backend health check the logging overlay waits on.
- `scripts/setup-sources.sh` sends the uppercase source type and reads `.source.id` and `.source.apiKey`; `scripts/collect-docker-logs.sh` treats 202 as success, sends the batch left over after the loop (a pipe ran the loop in a subshell, so fewer than 50 lines were never sent) and no longer appends a newline to every message. The 401 entry in `scripts/README.md` names the real causes.
- Alerting (task 6f12b5d6): the worker passed ISO timestamps (`...T...Z`) as `DateTime64` query parameters, which ClickHouse 24 rejects, so every rule evaluation failed and no rule could fire; it now sends `YYYY-MM-DD HH:MM:SS.mmm`. The demo seed rule matches the message `Payment failed` that `scripts/seed-demo-logs.ts` writes instead of SQL text, and `backend/prisma/seed.ts` (which set a `plan` field the schema does not have, so it failed after creating the user) now runs `backend/src/seed.ts`, leaving one demo dataset. A rule with the reserved `ANOMALY_DETECTED` condition is skipped with one warning instead of silently never triggering.
- `backend/.env.example` and `frontend/.env.local.example` list `REGISTRATION_MODE`, `ADMIN_EMAIL`, `MAX_PAGE_SIZE`, `WEBHOOK_HOST_ALLOWLIST`, `WEBHOOK_NAT64_ADDITIONAL_PREFIXES` and `INTERNAL_API_BASE_URL`; the alert and source empty states in the UI say how rules and sources are created today.
- The subscriptions empty state in the UI says how subscriptions are created today (POST /api/v1/subscriptions, channel WEBHOOK, SLACK or MSTEAMS).
- Subscriptions page: a legacy subscription whose `ruleId` points at another team's rule (returned with `rule: null` since the `POST /api/v1/subscriptions` ownership check) is labeled `Rule unavailable` instead of `All rules in team`, so a subscription that can never fire no longer looks team-wide; rows with a rule and true team-wide rows (`ruleId` null) keep their labels.
- OpenAPI: `SavedViewUpdateResponse.view` (the `PUT /api/v1/logs/views/:id` 200 body) is now `anyOf` full view or stub instead of `oneOf`. Neither schema forbids extra properties, so a full view matched both branches and strict validators rejected every response (task 24167dd9). A log search screen test pins that a stub returned by an update refetches the list and is not applied as a view.
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

- **ClickHouse no longer writes its unused per-second metric and trace logs.** `system-logs.xml` (now `backend/clickhouse/config.d/system-logs.xml`) disables `system.metric_log`, `system.asynchronous_metric_log`, `system.trace_log`, `system.processors_profile_log` and `system.query_metric_log` (`remove="1"`, as for `text_log`). telerithm never reads them; on the production host `metric_log` had grown to 2.16 GiB in 516 active parts and its background merges kept about two CPU cores busy, while the 7-day TTL did not keep it small. `query_log`, `query_thread_log`, `part_log` and `error_log` keep their 7-day TTL. Operational note: the config takes effect when the ClickHouse container restarts; the tables that already exist stay on disk but are no longer written, and can be dropped (`DROP TABLE system.metric_log` and so on; ClickHouse-internal data only).
- **Compose project names are explicit and the obsolete `version` key is gone.** `docker-compose.traefik.yml` sets `name: telerithm`, the name the deployed stack already had when cloned into a directory called `telerithm`, so containers and volumes keep their names; a checkout in a directory with another name keeps its old volume prefix only if `COMPOSE_PROJECT_NAME=<old prefix>` is set in `.env.production` (see `DEPLOYMENT.md`). `docker-compose.yml` sets `name: telerithm-dev`, so it no longer shares a project with the production stack, and publishes Postgres, ClickHouse and Redis on `127.0.0.1` only. Existing development stacks started under the old name stay behind as orphans: run `docker compose down` in the old project (or remove its containers) once. The `version: "3.8"` line of `docker-compose.traefik.yml` is removed (Compose v2 ignored it and warned on every command). The backend heap is not capped by a flag: Node 22 already sizes its default heap from the container limit (about half of the 512M limit), and a measurement in a 512M container showed that an explicit `--max-old-space-size=384` raised the heap above that default and turned a JavaScript heap error (exit 133) into an OOM kill (exit 137).
- `.env.production.example` documents `PUBLIC_API_URL` and `CORS_ORIGINS`, which `docker-compose.prod.yml` reads and silently defaults to localhost values. `DEPLOYMENT.md` gains the PostgreSQL password rotation procedure, a section on `backend/clickhouse/init.sql` running on an empty data directory only (with an `ALTER TABLE` example), and the backup script usage. README and CONTRIBUTING state the Node.js 22.9 prerequisite for running outside Docker, and `backend/package.json` declares it in `engines`.
- **Source names are trimmed and capped at 100 characters.** The `name` of `POST /api/v1/sources` and `PUT /api/v1/sources/:id` is trimmed before it is validated, and the trimmed value is what gets stored; a name of only whitespace, or of one character after trimming, is now 400 instead of being stored (it previously passed the 2-character minimum), and a name longer than 100 characters after trimming is 400. Existing sources are not renamed, and a valid padded name now stores the trimmed value. Settings caps both source name inputs at 100 characters.
- Incident actions check the current status (task 6f12b5d6): acknowledge applies to `OPEN`, resolve to `OPEN` or `ACKNOWLEDGED`, reopen to `RESOLVED` or `ACKNOWLEDGED`. Any other combination answers 409 with a message and writes no status change or timeline event. Clients that relied on any transition being accepted (for example resolving a resolved incident, or acknowledging a resolved one) now get 409.
- `POST /api/v1/subscriptions` and `PUT /api/v1/subscriptions/:id` reject `channel: "EMAIL"` with 400, since no mail transport exists. Existing `EMAIL` subscriptions are not migrated and stay usable (update without `channel`, test, delete).
- `MAX_PAGE_SIZE` is capped at 500: the search request schema caps `limit` at 500, so the values between 501 and 2000 it used to accept never took effect. A value above 500 is now clamped to 500 and the backend logs one startup warning naming the configured value and the cap; startup does not fail. Values from 50 to 500 behave as before, and a non-numeric value or one below 50 still fails startup.
- `make setup` starts the datastores, copies the example env files, installs dependencies and applies the schema; `make backend` and `make frontend` point to it when the env file is missing. The repo root declares `@clickhouse/client` and `tsx` as dev dependencies for `scripts/seed-demo-logs.ts`, which now requires `TEAM_ID` and `SOURCE_ID` instead of defaulting to ids that match no team. The unused `db:migrate` script (the repo has no migrations; the schema is applied with `db push`) is removed.
- CI: the Audit workflow's full-tree high/critical gate now classifies
  `npm audit --json` output with a vendored, dependency-free
  `scripts/audit-gate.mjs` (copied from depsight commit be8c7ea) and an
  ID-scoped, dated allowlist in `.github/audit-allowlist.json`. It excepts
  only GHSA-vfj7-8cjw-p6xm (braces 3.0.3, reached in `frontend` as a dev
  dependency only, no upstream fix), with a `reviewBy` date of 2026-11-06;
  any other HIGH or CRITICAL advisory, or an expired entry, keeps the gate
  red. The moderate runtime gate is unchanged. The script's self-test runs
  in the same job (`node --test scripts/audit-gate.test.mjs`).

- CI: a new `sender-configs` job runs `scripts/validate-sender-configs.sh`, which validates `deploy/vector/vector.toml` with `vector validate --skip-healthchecks` in `timberio/vector:0.41.1-alpine` (the tag `deploy/docker-compose.logging.yml` uses) and `deploy/fluentd/fluent.conf` with `fluentd --dry-run` in `fluent/fluentd:v1.17-debian-1`; both images are additionally pinned by digest and any non-zero validator exit fails the job. The script takes optional config paths (defaulting to the shipped ones) so developers can run it locally, and the job also runs `shellcheck --severity=warning` over `scripts/*.sh` (one warning in `collect-docker-logs.sh` fixed).

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
