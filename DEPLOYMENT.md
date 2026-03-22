# Deployment Guide

## Prerequisites

1. **VPS with Traefik already running**
   - Docker network `traefik` exists
   - Traefik configured with Let's Encrypt cert resolver named `letsencrypt`
   - Ports 80 and 443 handled by Traefik

2. **DNS configured**
   - Your domain → A record → VPS IP

3. **Docker & Docker Compose installed**
   - Docker Engine 20.10+
   - Docker Compose v2

## Initial Setup

### 1. Clone Repository

```bash
cd /root/git
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

**Optional:**
- `OPENAI_API_KEY`: Only needed if using OpenAI cloud. For local LLM setup, see [LOCAL_LLM.md](LOCAL_LLM.md)

### 3. Configure Domain

Update `docker-compose.traefik.yml` — replace all occurrences of the default domain with yours:

```bash
sed -i 's/logs.opentriologue.ai/yourdomain.example/g' docker-compose.traefik.yml
```

### 4. Build & Start Services

```bash
docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build
```

This will:
- Create PostgreSQL, ClickHouse, Redis containers (internal network)
- Build backend & frontend with production configs
- Connect to Traefik for SSL/routing
- Initialize ClickHouse schema automatically

### 5. Initialize Database

```bash
# Wait for services to be healthy (30-60 seconds)
docker compose -f docker-compose.traefik.yml ps

# Sync Prisma schema
docker compose -f docker-compose.traefik.yml exec backend npx prisma db push
```

### 6. Verify Deployment

```bash
# Check service health
docker compose -f docker-compose.traefik.yml ps

# Test endpoints
curl https://yourdomain.example/api/v1/health
curl https://yourdomain.example
```

## Architecture

```
Internet
  ↓
Traefik (ports 80/443, Let's Encrypt)
  ├─→ yourdomain/api  → backend:4000
  └─→ yourdomain/     → frontend:3000
       ↓
Internal Network (telerithm-internal)
  ├─→ postgres:5432
  ├─→ clickhouse:8123
  └─→ redis:6379
```

**Security:**
- PostgreSQL, ClickHouse, Redis are NOT exposed to the internet
- Only backend/frontend are connected to the Traefik network
- All services communicate via internal Docker network

## Resource Usage

Expected memory usage (8GB VPS):

| Service    | Memory  |
|------------|---------|
| PostgreSQL | ~100MB  |
| ClickHouse | ~500MB-1GB |
| Redis      | ~50MB   |
| Backend    | ~100MB  |
| Frontend   | ~50MB   |
| **Total**  | **~800MB-1.3GB** |

## Updating

```bash
cd /root/git/telerithm
git pull origin master

# Rebuild and restart
docker compose -f docker-compose.traefik.yml --env-file .env.production build
docker compose -f docker-compose.traefik.yml --env-file .env.production up -d

# Run migrations if schema changed
docker compose -f docker-compose.traefik.yml exec backend npx prisma db push
```

## Monitoring

```bash
# Service status
docker compose -f docker-compose.traefik.yml ps

# Logs (all or specific)
docker compose -f docker-compose.traefik.yml logs -f
docker compose -f docker-compose.traefik.yml logs -f backend

# Resource usage
docker stats
```

## Backup

### PostgreSQL

```bash
# Backup
docker compose -f docker-compose.traefik.yml exec postgres \
  pg_dump -U telerithm telerithm > backup_$(date +%Y%m%d).sql

# Restore
cat backup.sql | docker compose -f docker-compose.traefik.yml exec -T postgres \
  psql -U telerithm telerithm
```

### ClickHouse

```bash
docker compose -f docker-compose.traefik.yml exec clickhouse \
  clickhouse-client --query "BACKUP DATABASE default TO Disk('default', 'backup_$(date +%Y%m%d)')"
```

## Maintenance

```bash
# Delete logs older than 30 days
docker compose -f docker-compose.traefik.yml exec clickhouse \
  clickhouse-client --query "ALTER TABLE logs DELETE WHERE timestamp < now() - INTERVAL 30 DAY"

# PostgreSQL vacuum (monthly)
docker compose -f docker-compose.traefik.yml exec postgres \
  vacuumdb -U telerithm -z telerithm
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Services won't start | `docker compose logs` to check errors |
| SSL certificate issues | Check DNS propagation with `nslookup yourdomain` |
| Database connection errors | Test with `docker compose exec postgres psql -U telerithm -c "SELECT 1"` |
| Memory issues (OOM) | Check `docker stats`, adjust limits in compose file |
| AI queries not working | See [LOCAL_LLM.md](LOCAL_LLM.md) for setup |
