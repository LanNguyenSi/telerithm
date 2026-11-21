# Contributing to Telerithm

Thanks for your interest in contributing. This guide covers the basics.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Create a feature branch (`git checkout -b feature/my-change`)
4. Make your changes
5. Push and open a pull request

## Development Setup

```bash
# Start the full stack
make init
```

To run backend and frontend outside Docker you need Node.js 22.9 or newer (`npm run dev` uses Node's `--env-file-if-exists` flag, which older versions reject with `node: bad option`; CI and the Docker images use Node 22). Start only the datastores in Docker. This also creates the ClickHouse tables from `backend/clickhouse/init.sql`; the backend does not create them itself. `make setup` runs these steps for you (datastores, example env files, `npm install` in both packages, `db:migrate`); the manual version:

```bash
docker compose up -d postgres clickhouse redis
cp backend/.env.example backend/.env
cd backend && npm install && npm run db:migrate && npm run dev
```

`npm run db:migrate` applies the committed migrations, the same step the container runs at start. `npm run db:push` (`prisma db push`) is only a shortcut for a throwaway database, since it records no migration history. `npm run dev` reads `backend/.env`. The backend exits at startup without `DATABASE_URL` and `CLICKHOUSE_URL`. `REGISTRATION_MODE` defaults to `approval`, so set `REGISTRATION_MODE=open` or `ADMIN_EMAIL` to your own address in `backend/.env` before you sign up locally. In another shell:

```bash
cp frontend/.env.local.example frontend/.env.local
cd frontend && npm install && npm run dev
```

See [docs/configuration.md](docs/configuration.md) for all variables.

## Before Submitting

Run the checks CI runs (`.github/workflows/ci.yml`) in each package you changed:

- backend: `cd backend && npx tsc --noEmit && npm run lint && npm run format:check && npm run test:coverage`
- frontend: `cd frontend && npx tsc --noEmit && npm test && npm run build`, then `cd frontend && node scripts/check-token-absent.mjs` after the build (the "Session token absent from rendered pages" step: it starts the build against a stub backend, loads every authenticated page with a known session cookie and fails when the session token appears in any page's HTML or RSC payload)
- packages/sdk-js: `cd packages/sdk-js && npx tsc --noEmit && npm test`
- CLI: `bats packages/cli/logforge-pipe.bats`

CI also enforces coverage floors for the backend, frontend and SDK tests; `.github/workflows/ci.yml` has the numbers.

The backend job also guards the Prisma migrations before type checking (the steps from "Check baseline.prisma matches the baseline migration" to "Baseline against a second migration" in `.github/workflows/ci.yml`). These need a running Postgres: point `DATABASE_URL` at a fresh, empty database, which the first `migrate.sh` below fills (CI uses its `postgres:15` service, `postgresql://telerithm:telerithm@localhost:5432/telerithm`). From `backend/`:

```bash
# the frozen baseline schema must still render byte-for-byte into the baseline migration (CI writes the diff to $RUNNER_TEMP, any scratch path works)
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/baseline.prisma --script | sed '1,3d;$d' > baseline.sql
cmp baseline.sql prisma/migrations/20261027132152_baseline/migration.sql || { echo "baseline.prisma no longer produces the baseline migration byte for byte"; exit 1; }
# apply the committed migrations to the empty database (the step the container entrypoint runs)
sh scripts/migrate.sh
# the applied schema must equal schema.prisma, so a schema change without a migration fails (exit 2)
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
# a second run must find the migration history the first run wrote and apply nothing new
out=$(sh scripts/migrate.sh 2>&1) || { echo "$out"; exit 1; }; echo "$out"; grep -qF "migrate: migration history found" <<< "$out" || { echo "the second run did not detect the migration history"; exit 1; }
```

The two "database from before migrations" steps then check the baseline path of `scripts/migrate.sh` against scratch databases built with `npx prisma db push --schema prisma/baseline.prisma --skip-generate` (`legacy`: the baseline is recorded once, one `_prisma_migrations` row; `drifted`, with one extra column: exit 1 and no migration history). Their exact blocks are those steps of the backend job in `.github/workflows/ci.yml`; they create the databases with `psql` against `postgresql://telerithm:telerithm@localhost:5432`. From the repository root, the extended case:

```bash
MIGRATE_TEST_PG=postgresql://telerithm:telerithm@localhost:5432 bash scripts/baseline-second-migration.test.sh
```

CI also runs five cross-cutting jobs (Sender configs, Shell script tests, ClickHouse config, Backend entrypoint, Relay config); if you changed a compose file, `deploy/`, `.relay.yml`, `backend/entrypoint.sh` or `scripts/`, run the commands of the jobs that guard them locally:

- any compose file: `bash scripts/compose-image-pins.test.sh`
- compose files (dev): `bash scripts/dev-compose-loopback.test.sh`
- compose files and `backend/clickhouse/` (prod): `bash scripts/clickhouse-config-guard.sh`, controls `bash scripts/clickhouse-config-guard.test.sh`
- `docker-compose.prod.yml`: `bash scripts/compose-required-password.test.sh`
- `backend/Dockerfile` and `frontend/Dockerfile` (and the app services of the three compose files): `bash scripts/app-containers-non-root.test.sh`
- `deploy/` sender configs (needs Docker): `bash scripts/validate-sender-configs.sh`
- `scripts/` shell scripts: `shellcheck --severity=warning scripts/*.sh backend/entrypoint.sh backend/scripts/*.sh`, `bash scripts/backup.test.sh`, `bash scripts/make-deploy.test.sh`, `bash scripts/collect-docker-logs.test.sh`, `bash scripts/setup-sources.test.sh`, `bash scripts/scripts-readme-inventory.test.sh`, `bash scripts/test-scratch-safety.test.sh`
- `backend/entrypoint.sh`, `backend/scripts/migrate.sh` and `backend/package.json`: `bash scripts/backend-migrate.test.sh`, `bash scripts/backend-prisma-cli.test.sh`
- `.relay.yml`: `npm ci` at the repository root, then `bash scripts/relay-config.test.sh`

- New state-changing API routes are registered through `writeRoute` or need a justified allowlist entry in `backend/tests/unit/route-guards.ts`; see [docs/okf/api-authz-and-team-scoping.md](docs/okf/api-authz-and-team-scoping.md).
- Keep commits focused. One logical change per commit.

Cross-file invariants and operational facts are collected in the knowledge bundle at [docs/okf/index.md](docs/okf/index.md).

## Pull Requests

- Open an issue first to discuss larger changes
- Keep PRs small and focused
- Add a clear description of what changed and why
- Make sure CI passes

## Code Style

- TypeScript strict mode
- Prettier for formatting: run `npm run format` in `backend/`, or Prettier from inside `frontend/` (it has its own `.prettierrc`), never from the repo root
- No unused imports or variables

## Reporting Bugs

Open an issue with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Environment (OS, Node version, browser)

## Feature Requests

Open an issue describing:

- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
