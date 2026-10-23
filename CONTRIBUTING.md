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

To run backend and frontend outside Docker you need Node.js 22.9 or newer (`npm run dev` uses Node's `--env-file-if-exists` flag, which older versions reject with `node: bad option`; CI and the Docker images use Node 22). Start only the datastores in Docker. This also creates the ClickHouse tables from `backend/clickhouse/init.sql`; the backend does not create them itself. `make setup` runs these steps for you (datastores, example env files, `npm install` in both packages, `db:push`); the manual version:

```bash
docker compose up -d postgres clickhouse redis
cp backend/.env.example backend/.env
cd backend && npm install && npm run db:push && npm run dev
```

`npm run dev` reads `backend/.env`. The backend exits at startup without `DATABASE_URL` and `CLICKHOUSE_URL`. `REGISTRATION_MODE` defaults to `approval`, so set `REGISTRATION_MODE=open` or `ADMIN_EMAIL` to your own address in `backend/.env` before you sign up locally. In another shell:

```bash
cp frontend/.env.local.example frontend/.env.local
cd frontend && npm install && npm run dev
```

See [docs/configuration.md](docs/configuration.md) for all variables.

## Before Submitting

Run the checks CI runs (`.github/workflows/ci.yml`) in each package you changed:

- backend: `cd backend && npx tsc --noEmit && npm run lint && npm run format:check && npm run test:coverage`
- frontend: `cd frontend && npx tsc --noEmit && npm test && npm run build`
- packages/sdk-js: `cd packages/sdk-js && npx tsc --noEmit && npm test`
- CLI: `bats packages/cli/logforge-pipe.bats`

CI also enforces coverage floors for the backend, frontend and SDK tests; `.github/workflows/ci.yml` has the numbers.

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
