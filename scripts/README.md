# Telerithm Scripts

Utility scripts for deploying and managing Telerithm.

## Tests

Every `scripts/*.test.sh` is a check you run from the repository root: it prints
what fails and exits non-zero on a failure. A script that writes does so only
into a scratch directory made by `mktemp` (never the checkout, the real HOME or
a live service). The entries below match `ls scripts/*.test.sh`; the header
comment of each script holds its full contract and prerequisites, and some
scripts check what a section above describes in full.

- `scripts/backend-migrate.test.sh`: runs every branch of the start-time migration decision (`backend/scripts/migrate.sh`, called by `backend/entrypoint.sh`) against a stub Prisma CLI, under `sh` and `dash`: migration history present, empty database, a pre-migrations database that matches or differs from the schema, and each check that errors. CI runs it in the "Backend entrypoint" job. `bash scripts/backend-migrate.test.sh`
- `scripts/backend-prisma-cli.test.sh`: requires `prisma` to be a key of `dependencies` in `backend/package.json` and requires the runtime image's production install (`npm ci --omit=dev --ignore-scripts`, in a scratch copy of the two backend package files) to leave `node_modules/.bin/prisma`, which `backend/scripts/migrate.sh` starts. Needs node and the npm registry, not docker. CI runs it in the "Backend entrypoint" job. `bash scripts/backend-prisma-cli.test.sh`
- `scripts/backup.test.sh`: runs `scripts/backup.sh` against a stub `docker` placed first on PATH, so no real Docker daemon, compose file or datastore is touched. `bash scripts/backup.test.sh`
- `scripts/baseline-second-migration.test.sh`: runs `backend/scripts/migrate.sh` against a real Postgres and the real Prisma CLI (needs `npm ci` in `backend/`) for the case the stub test cannot show: what the baseline comparison does once a second migration exists. `bash scripts/baseline-second-migration.test.sh`
- `scripts/clickhouse-config-guard.test.sh`: runs `scripts/clickhouse-config-guard.sh` (see "Check the ClickHouse Config") against mutated copies and requires each mutation to make the guard fail with the message of its own branch, not just a bare non-zero exit. `bash scripts/clickhouse-config-guard.test.sh`
- `scripts/collect-docker-logs.test.sh`: runs `scripts/collect-docker-logs.sh` against a stub `docker` and a stub `curl` with `HOME`, `XDG_STATE_HOME` and any explicit `TELERITHM_STATE_DIR` pointed into a scratch directory, so no Docker daemon, ingest API, network or real HOME state is touched. `bash scripts/collect-docker-logs.test.sh`
- `scripts/compose-image-pins.test.sh`: fails when the compose files stop pinning `clickhouse/clickhouse-server` and `redis` to the same minor tags, or fall back to a bare major tag, so `make deploy` cannot move a datastore minor version or leave the files disagreeing. `bash scripts/compose-image-pins.test.sh`
- `scripts/compose-required-password.test.sh`: reads the parsed YAML of `docker-compose.prod.yml` and fails when either use of `POSTGRES_PASSWORD` (the postgres environment, the backend `DATABASE_URL`) is not the required `${POSTGRES_PASSWORD:<message>}` interpolation: a default (`:-`), a bare or shell interpolation, an escaped `$$`, a literal, a commented-out use or an absent one. Where `docker compose` is available it also renders the file and checks the refusal with the variable unset and the rendered value with a sentinel (skipped visibly without Docker; `COMPOSE_REQUIRED_PASSWORD_REQUIRE_DOCKER=1` turns that skip into a failure, which is how the Docker-backed "ClickHouse config" job runs it). CI runs it in the "Shell script tests" job. `bash scripts/compose-required-password.test.sh`
- `scripts/dev-compose-loopback.test.sh`: fails when any published port of `docker-compose.yml` is not bound to the loopback interface (`127.0.0.1:` prefix, or `host_ip: 127.0.0.1` in the long syntax). `bash scripts/dev-compose-loopback.test.sh`
- `scripts/make-deploy.test.sh`: runs the Makefile's deploy targets in a scratch git repository with a stub `docker` and a recording `git` wrapper, and fails when they run on a dirty tree or stash or discard anything. `bash scripts/make-deploy.test.sh`
- `scripts/relay-config.test.sh`: parses `.relay.yml` the way agent-relay's loader reads it and fails on a non-string hook entry, a `pre_update` that is present but not a list, a `pre_update` entry that builds images, or any hook entry that changes the Postgres schema (`prisma db push`, `migrate deploy`, `dev`, `reset`, `resolve`; read-only `migrate diff` and `migrate status` pass). CI runs it in the "Relay config" job. `bash scripts/relay-config.test.sh` checks `.relay.yml`; `bash scripts/relay-config.test.sh path/to/.relay.yml` checks another file.
- `scripts/test-scratch-safety.test.sh`: the guard every other test script runs through: a test script whose `mktemp` fails must stop without touching the directory it was started from, because `cd ""` stays in place and a cleanup trap would then delete that directory. Every new `scripts/*.test.sh` must pass this check. `bash scripts/test-scratch-safety.test.sh`

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

### State and Duplicates

The collector remembers per source and container which log lines it has already
sent, so a per-minute cron run sends each line once and a follow run resumes
where it stopped instead of replaying the container history:

- One small state file per source and container lives under `TELERITHM_STATE_DIR`
  (directory `0700`; a directory that already exists is `chmod 700` on every
  run too, when the running user owns it, so a pre-existing one with looser
  permissions is tightened; files `0600`), holding the
  last RFC3339Nano timestamp whose lines the ingest API accepted (HTTP 202).
  The API key is never stored.
- The next one-shot run reads with `docker logs --since <that timestamp>` (no
  `--tail` cap) and skips the boundary line, because `--since` is inclusive.
  Without state it falls back to `--tail $TELERITHM_TAIL_LINES`.
- The contract is at-least-once, per container: a batch whose send failed does
  not advance that container's state, so its lines are re-sent by the next run.
  And because a later accepted batch for the same container says nothing about
  the lines of an earlier failed one, that container's state is frozen for the
  rest of its processing once one of its sends has failed; one container's
  failure never freezes another container's state, so a container whose sends
  are accepted still advances in the same run. The next run re-reads from the
  last good timestamp, so a failure costs duplicates, never loss. If the API
  keeps rejecting a batch, that container's state stalls and its later lines are
  re-sent on every run until the cause is fixed. An empty, truncated or
  non-timestamp state file is treated as no state with a `[WARN]` (recent lines
  may be re-sent).
- A one-shot (cron) run in which any send failed exits non-zero, only after all
  containers were processed, so cron mail or monitoring notices; a run whose
  sends are all accepted exits 0. The frozen state is per container, so one
  container's failure does not stop the others from advancing.
- The state never moves to a timestamp that still has lines in a later batch:
  batches are cut by count while docker returns lines in (near) timestamp order,
  so a full batch is held back until the next timestamped line has a different
  timestamp. A saved timestamp therefore has all of its lines accepted for
  non-decreasing timestamps (docker merges stdout and stderr and can interleave
  them slightly out of order, but it does not replay a line at an older
  timestamp). Residual: the hold-back has no size cap, so one timestamp group
  spanning more lines than the batch size grows one batch without bound until a
  line with a different timestamp arrives (a container logging thousands of
  lines at one docker timestamp sends them as one large payload).
- Follow mode (`TELERITHM_FOLLOW=true`, the systemd setup below) passes
  `--follow --since <state>` and writes the state after every accepted batch,
  so `systemctl restart` resumes; a first start with no state reads only the
  last `TELERITHM_TAIL_LINES` lines. After a failed send the follow run exits
  non-zero immediately (see the systemd section below). Residual: the
  containers are processed one after another and `docker logs --follow` for the
  first one never ends, so a follow run follows only the first container of
  `TELERITHM_CONTAINERS`; run one unit per container (each with a single name
  in `TELERITHM_CONTAINERS`) instead of listing several in a follow unit.
- A container recreated under the same name starts its log at a new time: the
  stored timestamp is then newer than the new log, and `--since` returns
  nothing until the new log passes it. Delete the container's state file to
  start from now.
- Lines from stdout and stderr are merged and the order inside one timestamp is
  not guaranteed; at-least-once is the contract. Across containers there is no
  ordering guarantee either: containers are collected one after another in the
  order `TELERITHM_CONTAINERS` lists them and their batches are sent per
  container, so interleaving between containers follows neither wall clock nor
  log time.
- Overlapping runs would double-send; the cron example below guards against
  them with `flock`.

### Automated Collection (Cron)

For periodic log collection:

```bash
# Create a cron job config file. The line below is an /etc/cron.d file line:
# the "root" field is the user column, which exists only in /etc/cron.d files
# (a user crontab opened with crontab -e has no user field and would treat
# "root" as part of the command).
cat > /etc/cron.d/telerithm-collector <<EOF
# Collect Docker logs every minute. The state file (see "State and Duplicates")
# makes each line go once even though the run repeats; flock -n skips a run
# that would overlap the previous one (an overlapping run would double-send).
* * * * * root TELERITHM_API="http://localhost:4000/api/v1" TELERITHM_SOURCE_ID="src_abc123" TELERITHM_API_KEY="lf_xyz..." TELERITHM_CONTAINERS="triologue-api traefik" flock -n /var/lock/telerithm-collector.lock /root/git/telerithm/scripts/collect-docker-logs.sh >> /var/log/telerithm-collector.log 2>&1
EOF

# Restart cron
systemctl restart cron

# View logs
tail -f /var/log/telerithm-collector.log
```

### Systemd Service (Recommended for Production)

For continuous log streaming. The service resumes after a restart: the state
file is written after every accepted batch (see "State and Duplicates"), so
`systemctl restart` continues where the collector stopped instead of replaying
the container history, and a first start reads only the last
`TELERITHM_TAIL_LINES` lines. A failed send makes the follow run exit non-zero
immediately, without waiting for the log stream to end: that container's state
is frozen for the rest of its processing either way, so continuing could only
send duplicates, and exiting lets `Restart=always` restart the collector a few
seconds later, where it resumes from the last good timestamp and can save state
again (nothing more is sent after the failed send, so `RestartSec` is the delay
before the collector resumes, not a bound on a growing duplicate window).

In follow mode the collector follows only the first container named in
`TELERITHM_CONTAINERS` (containers are processed one after another and
`docker logs --follow` on the first never returns), so run one unit per
container: the unit below is instantiated per container name (the `%i` in the
file name and `Environment`), e.g. `telerithm-collector@triologue-api.service`
and `telerithm-collector@traefik.service` for two containers. Listing several
containers in one follow unit is not supported (only the first would be
followed); it is correct only for a one-shot (cron) run, which does process
every container in the list:

```bash
# Create systemd service (one instance per container: %i is the container name)
cat > /etc/systemd/system/telerithm-collector@.service <<EOF
[Unit]
Description=Telerithm Docker Log Collector for %i
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=root
Environment="TELERITHM_API=http://localhost:4000/api/v1"
Environment="TELERITHM_SOURCE_ID=src_abc123"
Environment="TELERITHM_API_KEY=lf_xyz..."
Environment="TELERITHM_CONTAINERS=%i"
Environment="TELERITHM_FOLLOW=true"
ExecStart=/root/git/telerithm/scripts/collect-docker-logs.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start (one instance per container)
systemctl daemon-reload
systemctl enable telerithm-collector@triologue-api
systemctl start telerithm-collector@triologue-api

# Check status
systemctl status telerithm-collector@triologue-api

# View logs
journalctl -u telerithm-collector@triologue-api -f
```

Keep the default `KillMode=control-group` (do not set `KillMode=process`). On a
failed send the follow run exits from inside a `while` loop that reads
`docker logs --follow` through a process substitution, and it does not kill that
`docker logs` child itself: killing it reliably across bash 3.2 and 5 is not
possible, because the process-substitution pid is not the `docker logs` process
(it runs under an `eval`, so docker is a grandchild) and `$!` names a different
process between bash versions. With the default `KillMode=control-group` systemd
stops the whole control group when the service exits, which takes the leftover
`docker logs --follow` with it; `KillMode=process` would leave it orphaned.

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

`clickhouse-config-guard.sh` renders `docker-compose.prod.yml` and `docker-compose.traefik.yml` (with `--profile '*'`, so services behind a compose profile are checked too) and checks the ClickHouse mounts (`init.sql`, `config.d`, `users.d`, read-only and identical in both), the root element and well-formedness of every XML file under `backend/clickhouse/config.d` and `users.d`, and the `clickhouse` service environment (`CLICKHOUSE_SKIP_USER_SETUP=1`, none of the variables that make the image entrypoint write `users.d/default-user.xml`), plus that the two composes share no project name, volume or network (`docker-compose.traefik.yml` keeps project `telerithm`, `docker-compose.prod.yml` must set its own `name:`). It also requires every service of both composes to have a bounded `json-file` log (`max-size` and `max-file`), memory and cpu limits and a healthcheck, and a service present in both to have the same rendered `logging` block, the same rendered `healthcheck` and the same limits in both. The comparison is on the rendered config, not the YAML text; `docker-compose.yml` (dev) is not part of it. It needs docker compose and python3 and reads no `.env`. CI runs it in the "ClickHouse config" job; `scripts/clickhouse-config-guard.test.sh` (see Tests) mutates a copy for each of its branches and requires the guard to fail with the message of that branch. That job also runs `scripts/compose-required-password.test.sh` (see Tests) with `COMPOSE_REQUIRED_PASSWORD_REQUIRE_DOCKER=1`, so its behaviour assertion against real Compose runs where Docker is available.

```bash
bash scripts/clickhouse-config-guard.sh
```

## Configuration Options

### collect-docker-logs.sh

| Variable               | Default                                                  | Description                                           |
| ---------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `TELERITHM_API`        | `http://localhost:4000/api/v1`                           | Telerithm API base URL                                |
| `TELERITHM_SOURCE_ID`  | (required)                                               | Log source ID from Telerithm                          |
| `TELERITHM_API_KEY`    | (required)                                               | API key for the source                                |
| `TELERITHM_CONTAINERS` | (required)                                               | Space-separated list of containers                    |
| `TELERITHM_TAIL_LINES` | `100`                                                    | Number of log lines to fetch (one-time mode)          |
| `TELERITHM_FOLLOW`     | `false`                                                  | Follow logs continuously                              |
| `TELERITHM_STATE_DIR`  | `${XDG_STATE_HOME:-$HOME/.local/state}/telerithm-collector` | Directory for the per-container state files (see "State and Duplicates"); an empty value counts as unset |

### setup-sources.sh

| Variable               | Default                        | Description                   |
| ---------------------- | ------------------------------ | ----------------------------- |
| `TELERITHM_API`        | `http://localhost:4000/api/v1` | Telerithm API base URL        |
| `TELERITHM_AUTH_TOKEN` | (required)                     | Bearer token from login       |
| `TELERITHM_TEAM_ID`    | (required)                     | Team ID to create sources for |

## Dependencies

`collect-docker-logs.sh` requires:

- `docker` - Docker CLI
- `jq` - JSON processor
- `curl` - HTTP client

`setup-sources.sh` only calls the API and needs no Docker:

- `jq` - JSON processor
- `curl` - HTTP client

Install on Ubuntu/Debian:

```bash
# collect-docker-logs.sh
apt-get install -y docker.io jq curl

# setup-sources.sh only
apt-get install -y jq curl
```

The cron example above additionally uses `flock` (from util-linux, standard on
Linux hosts that run cron). macOS has no `flock`, which is why the lock lives
in the cron line and not inside the script.

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
