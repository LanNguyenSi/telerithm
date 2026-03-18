# LogForge

LogForge is a log analytics MVP based on the specification in `PROJECT.md`.

This first implementation provides:

- Backend API for auth, teams, sources, ingestion, search, natural query explanation, and SSE live tail
- In-memory repositories so the product can run locally without external infrastructure
- Frontend dashboard with overview, log viewer, alerts, dashboards, and settings pages
- Project scaffolding for Prisma, ClickHouse, Docker Compose, and future service expansion

## Structure

- `backend/`: Express + TypeScript API
- `frontend/`: Next.js 15 + TypeScript + Tailwind UI
- `PROJECT.md`: original product specification

## Quick start

### Full stack with Docker

```bash
make init
```

This builds and starts:

- frontend on `http://localhost:3000`
- backend on `http://localhost:4000`
- postgres on `localhost:5432`
- clickhouse on `localhost:8123`
- redis on `localhost:6379`

Useful follow-up commands:

```bash
make logs
make down
```

### Backend

```bash
cd backend
npm install
npm run dev
```

The API defaults to `http://localhost:4000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app defaults to `http://localhost:3000`.

Set `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1` if needed.

## MVP notes

- Persistence is currently in memory to keep the first implementation self-contained.
- Prisma schema and ClickHouse SQL are included for the next persistence step.
- AI endpoints use deterministic heuristics as a fallback so the natural query flow is already usable.
