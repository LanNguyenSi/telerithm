# Telerithm Scripts

Utility scripts for deploying and managing Telerithm.

## Log Collection

### Setup Log Sources

Create log sources in Telerithm for Docker containers:

```bash
# 1. Get your auth token from Telerithm UI
#    - Login at http://localhost:3000
#    - Open DevTools → Application → Local Storage
#    - Copy 'token' value

# 2. Set environment variables
export TELERITHM_AUTH_TOKEN='eyJhbGciOiJIUzI1NiIs...'
export TELERITHM_TEAM_ID='team_abc123'  # Get from UI or API

# 3. Run setup script
./scripts/setup-sources.sh
```

This creates log sources for:

- triologue-api
- triologue-frontend
- event-booking-app
- traefik
- health-dashboard
- telerithm-backend
- telerithm-frontend

Copy the API keys from the output for the next step.

### Collect Docker Logs

Send Docker container logs to Telerithm:

```bash
# Set configuration
export TELERITHM_API="http://localhost:4000/api/v1"
export TELERITHM_SOURCE_ID="src_abc123"  # From setup-sources.sh output
export TELERITHM_API_KEY="lf_xyz789..."  # From setup-sources.sh output
export TELERITHM_CONTAINERS="triologue-api triologue-frontend traefik"

# One-time collection (last 100 lines)
./scripts/collect-docker-logs.sh

# Follow mode (continuous streaming)
export TELERITHM_FOLLOW=true
./scripts/collect-docker-logs.sh
```

### Automated Collection (Cron)

For periodic log collection:

```bash
# Create a cron job config file
cat > /etc/cron.d/telerithm-collector <<EOF
# Collect Docker logs every minute
* * * * * root TELERITHM_API="http://localhost:4000/api/v1" TELERITHM_SOURCE_ID="src_abc123" TELERITHM_API_KEY="lf_xyz..." TELERITHM_CONTAINERS="triologue-api traefik" /root/git/telerithm/scripts/collect-docker-logs.sh >> /var/log/telerithm-collector.log 2>&1
EOF

# Restart cron
systemctl restart cron

# View logs
tail -f /var/log/telerithm-collector.log
```

### Systemd Service (Recommended for Production)

For continuous log streaming:

```bash
# Create systemd service
cat > /etc/systemd/system/telerithm-collector.service <<EOF
[Unit]
Description=Telerithm Docker Log Collector
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=root
Environment="TELERITHM_API=http://localhost:4000/api/v1"
Environment="TELERITHM_SOURCE_ID=src_abc123"
Environment="TELERITHM_API_KEY=lf_xyz..."
Environment="TELERITHM_CONTAINERS=triologue-api triologue-frontend traefik"
Environment="TELERITHM_FOLLOW=true"
ExecStart=/root/git/telerithm/scripts/collect-docker-logs.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
systemctl daemon-reload
systemctl enable telerithm-collector
systemctl start telerithm-collector

# Check status
systemctl status telerithm-collector

# View logs
journalctl -u telerithm-collector -f
```

## Configuration Options

### collect-docker-logs.sh

| Variable               | Default                        | Description                                  |
| ---------------------- | ------------------------------ | -------------------------------------------- |
| `TELERITHM_API`        | `http://localhost:4000/api/v1` | Telerithm API base URL                       |
| `TELERITHM_SOURCE_ID`  | (required)                     | Log source ID from Telerithm                 |
| `TELERITHM_API_KEY`    | (required)                     | API key for the source                       |
| `TELERITHM_CONTAINERS` | (required)                     | Space-separated list of containers           |
| `TELERITHM_TAIL_LINES` | `100`                          | Number of log lines to fetch (one-time mode) |
| `TELERITHM_FOLLOW`     | `false`                        | Follow logs continuously                     |

### setup-sources.sh

| Variable               | Default                        | Description                   |
| ---------------------- | ------------------------------ | ----------------------------- |
| `TELERITHM_API`        | `http://localhost:4000/api/v1` | Telerithm API base URL        |
| `TELERITHM_AUTH_TOKEN` | (required)                     | Bearer token from login       |
| `TELERITHM_TEAM_ID`    | (required)                     | Team ID to create sources for |

## Dependencies

Both scripts require:

- `docker` - Docker CLI
- `jq` - JSON processor
- `curl` - HTTP client

Install on Ubuntu/Debian:

```bash
apt-get install -y docker.io jq curl
```

## Log Format

Logs are sent to Telerithm in this format:

```json
{
  "logs": [
    {
      "timestamp": "2026-03-21T07:30:00.123Z",
      "level": "info",
      "service": "triologue-api",
      "message": "Message sent to room abc123"
    }
  ]
}
```

**Level Detection:**

- `fatal` - Contains "fatal" or "critical"
- `error` - Contains "error"
- `warn` - Contains "warn" or "warning"
- `debug` - Contains "debug"
- `info` - Default for everything else

## Troubleshooting

### "Container not found or not running"

Check running containers:

```bash
docker ps --format '{{.Names}}'
```

Update `TELERITHM_CONTAINERS` to match actual container names.

### "Failed to send logs (HTTP 401)"

Invalid API key. Verify:

```bash
curl -X POST http://localhost:4000/api/v1/ingest/$SOURCE_ID \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"logs":[{"level":"info","message":"test"}]}'
```

### "jq: command not found"

Install jq:

```bash
apt-get install -y jq
```

### No logs appearing in Telerithm UI

1. Check collector logs: `tail -f /var/log/telerithm-collector.log`
2. Verify source ID and API key
3. Check Telerithm backend logs: `docker compose logs -f backend`
4. Test manual ingest:
   ```bash
   curl -X POST http://localhost:4000/api/v1/ingest/$SOURCE_ID \
     -H "X-API-Key: $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"logs":[{"level":"error","service":"test","message":"Manual test log"}]}'
   ```

## Advanced: Per-Container Sources

For better organization, create one source per container:

```bash
# Setup
./scripts/setup-sources.sh

# Collect from each source separately
export TELERITHM_CONTAINERS="triologue-api"
export TELERITHM_SOURCE_ID="src_triologue_api_123"
export TELERITHM_API_KEY="lf_api_key_1"
./scripts/collect-docker-logs.sh &

export TELERITHM_CONTAINERS="traefik"
export TELERITHM_SOURCE_ID="src_traefik_456"
export TELERITHM_API_KEY="lf_api_key_2"
./scripts/collect-docker-logs.sh &
```

Or create multiple systemd services (one per container/source).

## Demo Data

### Seed Demo Logs

Generate realistic demo log data for testing and screenshots:

```bash
# Using defaults (7 days, 1000 logs/day)
TEAM_ID="demo-team" SOURCE_ID="demo-source" tsx scripts/seed-demo-logs.ts

# Custom configuration
TEAM_ID="team_abc123" \
SOURCE_ID="src_demo" \
DAYS=14 \
LOGS_PER_DAY=2000 \
CLICKHOUSE_URL="http://localhost:8123" \
tsx scripts/seed-demo-logs.ts
```

**What it generates:**

- **Realistic logs** from 5 services (triologue-api, event-booking, traefik, health-dashboard, gateway)
- **Time distribution**: Higher volume during business hours (9-18 UTC)
- **Level distribution**: 80% info, 15% warn, 5% error
- **Incident clusters**: 3 simulated incidents (error bursts)
- **Interpolated data**: Random IDs, names, values for variety

**Configuration:**

| Variable         | Default                 | Description                |
| ---------------- | ----------------------- | -------------------------- |
| `TEAM_ID`        | `demo-team`             | Team ID for logs           |
| `SOURCE_ID`      | `demo-source`           | Source ID for logs         |
| `DAYS`           | `7`                     | Number of days to generate |
| `LOGS_PER_DAY`   | `1000`                  | Logs per day               |
| `CLICKHOUSE_URL` | `http://localhost:8123` | ClickHouse connection      |

**Example output:**

```
🌱 Seeding demo logs...
  Team ID: demo-team
  Source ID: demo-source
  Days: 7
  Logs per day: 1000

  Generating day 1/7...
  Generating day 2/7...
  ...
  Adding incidents...
  Total logs: 7060

📤 Inserting into ClickHouse...
  Inserted 1000/7060
  ...

✅ Seeding complete!

📊 Summary:
  Total logs: 7060
  Services: triologue-api, event-booking, traefik, health-dashboard, gateway
  Levels: 5648 info, 1059 warn, 353 error
  Time range: 2026-03-14 09:12:34 to 2026-03-21 17:45:22

🔍 Try these queries:
  "show me errors from the last 24 hours"
  "traefik errors"
  "booking confirmations"
```

**Use cases:**

- **Demo/screenshots**: Populate empty instance for presentations
- **Testing**: Validate query engine, dashboards, alerts
- **Load testing**: Generate large datasets for performance tests

## Future Enhancements

Planned improvements:

- [ ] Structured log parsing (JSON logs from Node.js apps)
- [ ] Log filtering (skip debug in production)
- [ ] Rate limiting (prevent API overload)
- [ ] Backpressure handling (queue when API is slow)
- [ ] Multi-source collection (single script, multiple sources)
- [ ] Health check endpoint (collector status)
- [ ] Metrics (logs collected, errors, API latency)

## See Also

- [DEPLOYMENT.md](../DEPLOYMENT.md) - Production deployment guide
- [Task 003](../tasks/003-docker-log-collection.md) - Log collection task
- [Task 004](../tasks/004-demo-seed-data.md) - Demo data task
