# Telerithm Scripts

Utility scripts for deploying and managing Telerithm.

## Log Collection

### Setup Log Sources

Create log sources in Telerithm for Docker containers:

```bash
# 1. Get an auth token from the login API. The web UI keeps its session in an
#    httpOnly cookie (telerithm_token), not in Local Storage; the login API is
#    the scriptable route.
#    POST /api/v1/auth/login returns {"token": "...", "user": {...}}:
export TELERITHM_AUTH_TOKEN="$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"..."}' | jq -r .token)"

# 2. Set environment variables
export TELERITHM_TEAM_ID='team_abc123'  # Get from GET /api/v1/teams (Bearer token), or the UI

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

### Validate Sender Configs

CI check for the shipped log-sender configs: runs `vector validate --skip-healthchecks` and `fluentd --dry-run` in pinned images (the Vector tag matches `deploy/docker-compose.logging.yml`), with dummy values for `TELERITHM_URL`, `TELERITHM_SOURCE_ID` and `TELERITHM_API_KEY`. Requires `docker`. Exits non-zero on any config error.

```bash
# Validate the shipped configs (deploy/vector/vector.toml, deploy/fluentd/fluent.conf)
./scripts/validate-sender-configs.sh

# Or validate other files
./scripts/validate-sender-configs.sh path/to/vector.toml path/to/fluent.conf
```

The image pins can be overridden with `VECTOR_IMAGE` / `FLUENTD_IMAGE`.

Beyond the two validators' own exit codes, the check fails the two mistakes
`fluentd --dry-run` accepts with only a warning or silently:

- **Unknown parameter or section.** A parameter or section fluentd does not
  recognise makes the dry run exit 0 and print a warning instead:
  `[warn]: parameter '<name>' in <section> ... is not used` or
  `[warn]: section <name> is not used in <parent>` (for example a misspelled
  `<buffr>`). The check captures the dry run output, still prints it, and fails
  naming what is unused and where from that warning's header line. It
  matches the header line, not a bare `is not used`, so a config *value* that
  merely contains those words (fluentd echoes the whole config back) is not a
  false failure.
- **Unset `#{ENV[...]}` reference.** fluentd substitutes an empty string for an
  unset variable, so the dry run exits 0 with no warning at all.

ENV decision: rather than let an unset `#{ENV[...]}` reference pass, the check
extracts every `#{ENV['NAME']}` / `#{ENV["NAME"]}` name from the fluentd config
and fails, naming the variable, when it is not one of the names the script
passes to the container (the same set behind `TELERITHM_URL`,
`TELERITHM_SOURCE_ID` and `TELERITHM_API_KEY`). The shipped
`deploy/fluentd/fluent.conf` sets all three names it references, so it keeps
passing; a typo or a new variable added to the config but not to the check is
caught instead of shipping as an empty string. A variable that must be empty in
some deployment should be passed explicitly as empty (`-e NAME=`) rather than
omitted.

Fixtures live in `scripts/fixtures/sender-configs/`. Four are negative
controls, each passed as the second argument and each making the check fail with
its own message: `unused-param.conf` (unknown parameter), `unused-section.conf`
(misspelled `<buffr>` section), `unset-env.conf`
(`#{ENV['UNSET_NAME']}`) and `bad-plugin.conf` (a `<match>` with an unregistered
`@type`, which makes `fluentd --dry-run` itself exit non-zero). One is a positive
control, `value-text.conf`, whose only oddity is a record value containing the
words `is not used`; it must keep passing.

The CI `Sender configs` job runs all five. It does not use `!` to invert the exit
status: bash does not apply `errexit` to a `!`-negated command, so a line like
`! ...` can never fail the step and only the last line of a block counts. Each
negative fixture instead captures the output, fails the step when the script
exits 0, and then asserts the specific message its branch prints, so the step
still fails if the script breaks for another reason (the positive fixture asserts
a zero exit):

```bash
out=$(bash scripts/validate-sender-configs.sh deploy/vector/vector.toml scripts/fixtures/sender-configs/unused-param.conf 2>&1) && { echo "$out"; echo "unused-param.conf passed but must fail"; exit 1; }
echo "$out" | grep -qF "fluentd config has an unused parameter or section (the dry run warned 'is not used'):" || { echo "$out"; echo "unused-param.conf failed for another reason"; exit 1; }
```

### Check the ClickHouse Config

`clickhouse-config-guard.sh` renders `docker-compose.prod.yml` and `docker-compose.traefik.yml` and checks the ClickHouse mounts (`init.sql`, `config.d`, `users.d`, read-only and identical in both), the root element and well-formedness of every XML file under `backend/clickhouse/config.d` and `users.d`, and the `clickhouse` service environment (`CLICKHOUSE_SKIP_USER_SETUP=1`, none of the variables that make the image entrypoint write `users.d/default-user.xml`), plus that the two composes share no project name, volume or network (`docker-compose.traefik.yml` keeps project `telerithm`, `docker-compose.prod.yml` must set its own `name:`). It needs docker compose and python3 and reads no `.env`. CI runs it in the "ClickHouse config" job; `clickhouse-config-guard.test.sh` runs it against mutated copies and requires each to fail with its own message.

```bash
bash scripts/clickhouse-config-guard.sh
bash scripts/clickhouse-config-guard.test.sh
```

### Check the Backend Migration Step

`backend-migrate.test.sh` runs every branch of the start-time migration decision (`backend/scripts/migrate.sh`, called by `backend/entrypoint.sh`) against a stub Prisma CLI, under `sh` and `dash`: migration history present, empty database, a database from before migrations that matches the schema (baseline recorded) or differs from it, and each check that errors. CI runs it in the "Backend entrypoint" job; the "Backend" job additionally runs the script against real Postgres.

```bash
bash scripts/backend-migrate.test.sh
```

### Check the Relay Config

`relay-config.test.sh` parses `.relay.yml` with js-yaml (root devDependency) the way agent-relay's loader reads it and fails when a `pre_update` or `post_update` entry is not a string or when `pre_update` is present but not a list (an empty `pre_update:` key parses as null and every deploy then fails), flags any `pre_update` entry that builds images (pre_update runs against the pre-pull tree, so such a build uses the old code; the deploy system builds the pulled commit itself), and flags any hook entry that changes the Postgres schema (`prisma db push`, `migrate deploy`, `dev`, `reset`, `resolve`; the backend entrypoint is the only schema writer, read-only `migrate diff` and `migrate status` pass). A file without hooks is accepted, which is the committed state. Self-check lists of build and non-build and of schema-changing and read-only samples guard the matchers. CI runs it in the "Relay config" job.

```bash
bash scripts/relay-config.test.sh

# Or check another file (for example the config before the build entry was dropped)
bash scripts/relay-config.test.sh path/to/.relay.yml
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

### "Failed to send logs (HTTP 401)" or "(HTTP 403)"

The backend answers 401 `Missing X-API-Key header` when a request carries no `X-API-Key` header at all. The collector always sets it, so a 401 means something between the script and the backend dropped the header (a reverse proxy, for example). A wrong key answers 403 `Invalid API key`, and a valid key used with another source's ID answers 403 `API key does not match source`. A successful batch answers 202. Check the key and source ID with:

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

Generate realistic demo log data for testing and screenshots. The script writes straight to ClickHouse. Install the repo-root dev dependencies once (`@clickhouse/client` and `tsx` are declared there):

```bash
npm ci
```

`TEAM_ID` and `SOURCE_ID` are required and must be real ids (UUIDs) from `GET /api/v1/teams` and `GET /api/v1/sources`; rows written under any other id never show up in the UI. The script exits with a message when either is missing.

```bash
# 7 days, 1000 logs/day
TEAM_ID=<team uuid> SOURCE_ID=<source uuid> npx tsx scripts/seed-demo-logs.ts

# Custom configuration
TEAM_ID=<team uuid> \
SOURCE_ID=<source uuid> \
DAYS=14 \
LOGS_PER_DAY=2000 \
CLICKHOUSE_URL="http://localhost:8123" \
npx tsx scripts/seed-demo-logs.ts
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
| `TEAM_ID`        | (required)              | Team UUID for the logs |
| `SOURCE_ID`      | (required)              | Source UUID for the logs |
| `DAYS`           | `7`                     | Number of days to generate |
| `LOGS_PER_DAY`   | `1000`                  | Logs per day               |
| `CLICKHOUSE_URL` | `http://localhost:8123` | ClickHouse connection      |

**Example output:**

```
🌱 Seeding demo logs...
  Team ID: <team uuid>
  Source ID: <source uuid>
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
- [docs/configuration.md](../docs/configuration.md#ingestion-sources) - Ingestion sources and forwarder configs
