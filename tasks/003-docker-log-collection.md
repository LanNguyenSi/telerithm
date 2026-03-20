# Task 003: Docker Log Collection

**Priority:** P0
**Estimate:** 3h
**Status:** Open

## Problem

Telerithm is deployed but has no real logs. Need to collect logs from existing Docker containers (Triologue, Event Booking, Traefik, Health Dashboard).

## Solution

### Option A: Lightweight Log Shipper Script (recommended)

Simple bash/node script that reads Docker logs and POSTs to Telerithm ingest API.

```bash
#!/bin/bash
# Reads Docker container logs and sends to Telerithm
CONTAINERS="triologue-api triologue-frontend event-booking-app traefik"
API="http://localhost:4000/api/v1/ingest/<sourceId>"
API_KEY="lf_..."

for container in $CONTAINERS; do
  docker logs --since 1m --timestamps $container 2>&1 | while read line; do
    curl -s -X POST $API \
      -H "X-API-Key: $API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"logs\":[{\"level\":\"info\",\"service\":\"$container\",\"message\":\"$line\"}]}"
  done
done
```

Run via cron every minute, or as a daemon.

### Option B: Telerithm SDK in Triologue (deeper integration)

Add `@telerithm/sdk` to Triologue backend → structured logs with levels, services, fields.

```typescript
import { init, log } from "@telerithm/sdk";
init({ dsn: "https://apiKey@logs.opentriologue.ai/sourceId" });

// In triologue-api:
log.info("Message sent", { roomId, senderId, messageLength: content.length });
log.error("WebSocket error", { error: err.message });
```

### Option C: Docker Logging Driver

Configure Docker to send logs directly to Telerithm.

```yaml
# In each service's docker-compose:
logging:
  driver: "fluentd"
  options:
    fluentd-address: "localhost:24224"
```

Needs Fluentd → Telerithm adapter. More complex.

## Recommendation

**Start with Option A** (script, 1h), then **add Option B** to Triologue for structured logs (2h).

## Files to Create

```
scripts/collect-docker-logs.sh  — NEW: Docker log collector
scripts/setup-sources.sh        — NEW: Create log sources via API
```

## Steps

1. Deploy Telerithm (Task 002)
2. Create team + user via seed/API
3. Create log sources (one per service: triologue-api, event-booking, traefik, etc.)
4. Run collector script
5. Verify logs appear in Telerithm UI
6. (Optional) Add SDK to Triologue for structured logging

## Testing

```bash
# Verify logs are ingested
curl http://localhost:4000/api/v1/logs/search \
  -H "Authorization: Bearer TOKEN" \
  -d '{"teamId": "...", "query": "error"}'

# Test natural language (after Task 001)
curl http://localhost:4000/api/v1/query/natural \
  -H "Authorization: Bearer TOKEN" \
  -d '{"query": "show me triologue errors from the last hour"}'
```
