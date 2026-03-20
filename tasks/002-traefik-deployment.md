# Task 002: Traefik Deployment

**Priority:** P0
**Estimate:** 2h
**Status:** Open

## Problem

No production deployment with Traefik/SSL. Need `logs.opentriologue.ai` live.

## Solution

Create `docker-compose.traefik.yml` that integrates with existing Traefik on the VPS.

### DNS
- `logs.opentriologue.ai` → A record → `87.106.147.208`

### Architecture

```
Internet → Traefik (existing, ports 80/443)
  ├── logs.opentriologue.ai → telerithm-frontend:3000
  ├── logs.opentriologue.ai/api → telerithm-backend:4000
  └── (existing services unchanged)
```

### Key Decisions

- **ClickHouse:** NOT exposed externally (internal network only)
- **PostgreSQL:** Separate from triologue-postgres (own container, own volume)
- **Redis:** Can share existing triologue-redis OR separate (separate is safer)
- **Frontend:** Needs `NEXT_PUBLIC_API_BASE_URL=https://logs.opentriologue.ai/api/v1`
- **Backend:** Needs `CORS_ORIGINS=https://logs.opentriologue.ai`

## Files to Create

```
docker-compose.traefik.yml  — NEW: Production Traefik config
.env.production.example     — NEW: Production env vars
```

## Resource Budget (VPS: 8GB RAM, 6 cores)

Current usage: ~3.3GB. Telerithm adds:
- PostgreSQL: ~100MB
- ClickHouse: ~500MB-1GB  
- Redis: ~50MB (shared or new)
- Backend: ~100MB
- Frontend: ~50MB
- **Total: ~800MB-1.3GB → fits within 4GB remaining**

## Notes

- Backend needs `network_mode: host` OR proper Traefik routing for `/api` prefix
- ClickHouse init.sql must run on first start (volume mount)
- Prisma migrations need to run after first deploy
- Memory limits in docker-compose to prevent ClickHouse eating all RAM
