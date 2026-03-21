# Deployment Guide

## Prerequisites

1. **VPS with Traefik already running**
   - Docker network `traefik_proxy` exists
   - Traefik configured with Let's Encrypt cert resolver named `letsencrypt`
   - Ports 80 and 443 handled by Traefik

2. **DNS configured**
   - `logs.opentriologue.ai` → A record → VPS IP (87.106.147.208)

3. **Docker & Docker Compose installed**
   - Docker Engine 20.10+
   - Docker Compose v2

## Initial Setup

### 1. Clone Repository

```bash
cd /root/git  # or your preferred location
git clone https://github.com/LanNguyenSi/telerithm.git
cd telerithm
```

### 2. Create Production Environment File

```bash
cp .env.production.example .env.production
nano .env.production
```

**Required variables:**
- `POSTGRES_PASSWORD`: Strong password for PostgreSQL
- `OPENAI_API_KEY`: Optional, for AI Query Engine (falls back to heuristic without it)

### 3. Build & Start Services

```bash
docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build
```

This will:
- Create PostgreSQL, ClickHouse, Redis containers (internal network)
- Build backend & frontend with production configs
- Connect to Traefik for SSL/routing
- Initialize ClickHouse schema automatically

### 4. Run Database Migrations

```bash
# Wait for services to be healthy (30-60 seconds)
docker compose -f docker-compose.traefik.yml ps

# Run Prisma migrations
docker compose -f docker-compose.traefik.yml exec backend npx prisma migrate deploy
```

### 5. Verify Deployment

```bash
# Check service health
docker compose -f docker-compose.traefik.yml ps

# Check logs
docker compose -f docker-compose.traefik.yml logs -f backend
docker compose -f docker-compose.traefik.yml logs -f frontend

# Test endpoints
curl https://logs.opentriologue.ai/api/v1/health
curl https://logs.opentriologue.ai
```

## Architecture

```
Internet
  ↓
Traefik (ports 80/443)
  ├─→ logs.opentriologue.ai/api → backend:4000 (telerithm-backend)
  └─→ logs.opentriologue.ai     → frontend:3000 (telerithm-frontend)
       ↓
Internal Network (telerithm-internal)
  ├─→ postgres:5432 (PostgreSQL)
  ├─→ clickhouse:8123 (ClickHouse)
  └─→ redis:6379 (Redis)
```

**Security:**
- PostgreSQL, ClickHouse, Redis are NOT exposed to internet
- Only backend/frontend connected to Traefik network
- All services communicate via internal Docker network

## Resource Usage

Expected memory usage on VPS (8GB total):
- PostgreSQL: ~100MB
- ClickHouse: ~500MB-1GB
- Redis: ~50MB
- Backend: ~100MB
- Frontend: ~50MB
- **Total: ~800MB-1.3GB**

Resource limits are enforced via `docker-compose.traefik.yml`.

## Updating

### Update Code

```bash
cd /root/git/telerithm
git pull origin master
```

### Rebuild & Restart

```bash
# Rebuild images
docker compose -f docker-compose.traefik.yml --env-file .env.production build

# Restart services
docker compose -f docker-compose.traefik.yml --env-file .env.production up -d

# Run migrations (if schema changed)
docker compose -f docker-compose.traefik.yml exec backend npx prisma migrate deploy
```

### Zero-Downtime Update (advanced)

```bash
# Pull new images
docker compose -f docker-compose.traefik.yml --env-file .env.production pull

# Rebuild
docker compose -f docker-compose.traefik.yml --env-file .env.production build

# Rolling restart (Traefik handles traffic)
docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --no-deps --build backend
docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --no-deps --build frontend
```

## Monitoring

### Check Service Status

```bash
docker compose -f docker-compose.traefik.yml ps
```

### View Logs

```bash
# All services
docker compose -f docker-compose.traefik.yml logs -f

# Specific service
docker compose -f docker-compose.traefik.yml logs -f backend
docker compose -f docker-compose.traefik.yml logs -f frontend

# Last 100 lines
docker compose -f docker-compose.traefik.yml logs --tail=100 backend
```

### Prometheus Metrics

Backend exposes Prometheus metrics:
```bash
curl https://logs.opentriologue.ai/api/v1/metrics
```

## Backup

### PostgreSQL Backup

```bash
# Backup
docker compose -f docker-compose.traefik.yml exec postgres pg_dump -U telerithm telerithm > backup_$(date +%Y%m%d).sql

# Restore
cat backup_20260321.sql | docker compose -f docker-compose.traefik.yml exec -T postgres psql -U telerithm telerithm
```

### ClickHouse Backup

```bash
# Backup (exports to /var/lib/clickhouse/backup/)
docker compose -f docker-compose.traefik.yml exec clickhouse clickhouse-client --query "BACKUP DATABASE default TO Disk('default', 'backup_$(date +%Y%m%d)')"
```

### Volume Backup

```bash
# Create tarball of volumes
docker run --rm -v telerithm_pgdata:/data -v $(pwd):/backup alpine tar czf /backup/pgdata_backup.tar.gz -C /data .
docker run --rm -v telerithm_chdata:/data -v $(pwd):/backup alpine tar czf /backup/chdata_backup.tar.gz -C /data .
```

## Troubleshooting

### Services Won't Start

```bash
# Check logs
docker compose -f docker-compose.traefik.yml logs

# Check health
docker compose -f docker-compose.traefik.yml ps

# Restart specific service
docker compose -f docker-compose.traefik.yml restart backend
```

### SSL Certificate Issues

Traefik handles SSL automatically. If certificates aren't working:
1. Check DNS propagation: `nslookup logs.opentriologue.ai`
2. Check Traefik logs: `docker logs traefik`
3. Verify Let's Encrypt rate limits haven't been hit

### Database Connection Errors

```bash
# Test PostgreSQL
docker compose -f docker-compose.traefik.yml exec postgres psql -U telerithm -c "SELECT 1"

# Test ClickHouse
docker compose -f docker-compose.traefik.yml exec clickhouse clickhouse-client --query "SELECT 1"
```

### Memory Issues

If services are killed by OOM:
1. Check current usage: `docker stats`
2. Adjust memory limits in `docker-compose.traefik.yml`
3. Restart: `docker compose -f docker-compose.traefik.yml restart`

## Maintenance

### Cleanup Old Logs

ClickHouse logs can grow large. Set up automatic cleanup:

```bash
# Delete logs older than 30 days (run as cron job)
docker compose -f docker-compose.traefik.yml exec clickhouse clickhouse-client --query \
  "ALTER TABLE logs DELETE WHERE timestamp < now() - INTERVAL 30 DAY"
```

### Database Optimization

```bash
# PostgreSQL vacuum (monthly)
docker compose -f docker-compose.traefik.yml exec postgres vacuumdb -U telerithm -z telerithm

# ClickHouse optimize (weekly)
docker compose -f docker-compose.traefik.yml exec clickhouse clickhouse-client --query \
  "OPTIMIZE TABLE logs FINAL"
```

## Support

- GitHub Issues: https://github.com/LanNguyenSi/telerithm/issues
- Documentation: https://github.com/LanNguyenSi/telerithm/blob/master/README.md
