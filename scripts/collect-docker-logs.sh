#!/bin/bash
# Docker Log Collector for Telerithm
# Collects logs from specified Docker containers and sends to Telerithm ingest API
#
# Remembers, per source and container, the last log line that was accepted by
# the ingest API, so a one-shot (cron) run only sends new lines and a follow
# (systemd) run resumes where it stopped instead of replaying the container
# history. The contract is at-least-once: the state only moves to a timestamp
# all of whose lines were accepted, and once a send for a container fails that
# container's state is frozen for the rest of its processing, so its next run
# re-reads from the last good timestamp (a failure costs duplicates, never
# loss); a failure for one container never freezes another container's state. A
# batch the API keeps rejecting therefore stalls that container's state and its
# later lines are re-sent on every run until the cause is fixed. A one-shot run
# exits non-zero if any send in it failed (after all containers were processed),
# so cron mail or monitoring notices; a follow run exits non-zero right after a
# failed send, so a Restart=always unit restarts into the last good state.

set -euo pipefail

# Timestamps are compared as plain strings (the fixed-width RFC3339Nano form
# docker prints with --timestamps), which needs a byte-wise collation.
export LC_ALL=C

# Configuration
TELERITHM_API="${TELERITHM_API:-http://localhost:4000/api/v1}"
SOURCE_ID="${TELERITHM_SOURCE_ID:-}"
API_KEY="${TELERITHM_API_KEY:-}"
CONTAINERS="${TELERITHM_CONTAINERS:-}"
TAIL_LINES="${TELERITHM_TAIL_LINES:-100}"
FOLLOW="${TELERITHM_FOLLOW:-false}"
# An empty TELERITHM_STATE_DIR or XDG_STATE_HOME counts as unset (same style as
# the variables above); the state never goes anywhere near the API key.
STATE_DIR="${TELERITHM_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/telerithm-collector}"

# SEND_FAILED freezes ONE container's state for the rest of its processing once
# one of its sends has failed, because a later accepted batch for the same
# container says nothing about the failed batch's lines (they sit at older
# timestamps the state would move past). process_container_logs resets it at the
# start of every container, so a failure for one container cannot freeze the
# state of the containers processed after it.
SEND_FAILED=0
# Remembers that some send failed anywhere in this run, so a one-shot (cron) run
# can exit non-zero at the end even though the freeze above is only per
# container. Never reset during the run.
RUN_SEND_FAILED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Validate environment variables
if [ -z "$SOURCE_ID" ]; then
  log_error "TELERITHM_SOURCE_ID not set. Please set it to the source ID from Telerithm."
  log_info "Example: export TELERITHM_SOURCE_ID=src_abc123"
  exit 1
fi

if [ -z "$API_KEY" ]; then
  log_error "TELERITHM_API_KEY not set. Please set it to your Telerithm API key."
  log_info "Example: export TELERITHM_API_KEY=lf_abc123..."
  exit 1
fi

if [ -z "$CONTAINERS" ]; then
  log_error "TELERITHM_CONTAINERS not set. Please specify containers to monitor."
  log_info "Example: export TELERITHM_CONTAINERS='triologue-api triologue-frontend traefik'"
  exit 1
fi

INGEST_URL="${TELERITHM_API}/ingest/${SOURCE_ID}"

# Parse log level from message (heuristic)
parse_level() {
  local msg="$1"
  local msg_lower
  msg_lower=$(echo "$msg" | tr '[:upper:]' '[:lower:]')
  
  if [[ "$msg_lower" =~ (fatal|critical) ]]; then
    echo "fatal"
  elif [[ "$msg_lower" =~ error ]]; then
    echo "error"
  elif [[ "$msg_lower" =~ (warn|warning) ]]; then
    echo "warn"
  elif [[ "$msg_lower" =~ debug ]]; then
    echo "debug"
  else
    echo "info"
  fi
}

# Send log batch to Telerithm
send_logs() {
  local logs_json="$1"
  
  response=$(curl -s -w "\n%{http_code}" -X POST "$INGEST_URL" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$logs_json")
  
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)
  
  # POST /ingest/:sourceId answers 202 Accepted
  if [ "$http_code" -eq 202 ]; then
    log_info "Sent batch successfully"
    return 0
  else
    log_error "Failed to send logs (HTTP $http_code): $body"
    return 1
  fi
}

# Remember that a send failed: that container's state is frozen for the rest of
# its processing (save_state refuses to write while SEND_FAILED is set), because
# a later accepted batch for the same container says nothing about the failed
# batch's lines, and saving past them would skip them for good. RUN_SEND_FAILED
# records the failure for the whole run so a one-shot run can exit non-zero at
# the end. A follow run has no next run of its own to lean on, so it exits
# non-zero right away instead of waiting for a stream that may never end:
# continuing could only send duplicates (the state cannot advance), and a
# systemd unit with Restart=always restarts the collector, which resumes from
# the last good timestamp. The follow run's `docker logs --follow` runs in a
# process substitution and is left running by this exit; killing it is not
# reliable across bash versions (see the README systemd section), so the unit
# must keep the default KillMode=control-group, which takes the child down too.
note_send_failure() {
  SEND_FAILED=1
  RUN_SEND_FAILED=1
  if [ "$FOLLOW" = "true" ]; then
    log_error "Follow mode exits after a failed send; the restart resumes from the last good state"
    exit 1
  fi
}

# Turn a state key (source id + container) into a safe file name: only
# A-Za-z0-9_.- survive, everything else becomes "_", so a container named
# "../x" can never put the state file outside the state directory.
sanitize_key() {
  local key="$1"
  printf '%s' "${key//[!A-Za-z0-9._-]/_}"
}

# Read the stored timestamp for a container into SINCE_TS ("" means no state).
# An empty, truncated or non-timestamp state file is treated as no state with
# a warning, never as a crash.
load_state() {
  local file="$1"
  SINCE_TS=""
  if [ ! -f "$file" ]; then
    return 0
  fi
  local ts
  ts=$(head -n 1 "$file" 2>/dev/null || true)
  if [[ "$ts" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+Z$ ]]; then
    SINCE_TS="$ts"
  else
    log_warn "State file '$file' is empty or corrupt; treating it as no state (recent logs may be re-sent)"
  fi
}

# Record the timestamp for a container (file mode 0600). Only ever called
# after send_logs returned success, and only with a timestamp all of whose
# lines were accepted (see the batch loop). The state stays frozen for the rest
# of the container's processing once one of its sends has failed (see
# note_send_failure); this freeze is per container.
save_state() {
  if [ "$SEND_FAILED" -ne 0 ]; then
    return 0
  fi
  local file="$1"
  local ts="$2"
  (
    umask 077
    printf '%s\n' "$ts" > "$file"
  )
  # Not redundant with the umask: the redirect truncates a file that already
  # exists, and a pre-existing file keeps whatever mode it had.
  chmod 600 "$file"
}

# Process logs from a container
process_container_logs() {
  local container="$1"
  # Freeze is per container: a failed send for another container must not stop
  # this container's state from advancing (RUN_SEND_FAILED keeps the run-level
  # record for the end-of-run exit). See note_send_failure and save_state.
  SEND_FAILED=0
  local batch_size=50
  local logs_array="[]"
  local count=0
  # Last docker timestamp in the current batch; the state advances to it only
  # once the batch itself was accepted (per batch, not per line: the loop runs
  # in this shell, but a failed send must roll the whole batch back).
  local batch_last_ts=""
  # A batch may never end on a timestamp that has lines in a later batch:
  # batches are cut by count, but docker returns lines in (near) timestamp
  # order, so one timestamp can span the cut, and a state at that timestamp
  # would make the next run's --since skip the rest of the group for good. A
  # full batch is therefore held back until a timestamped line with a different
  # timestamp arrives (lines without a timestamp join the held batch; they are
  # not docker log lines and cannot split a group); at the stream end the last
  # group is complete by definition. This holds while timestamps do not
  # decrease: docker merges stdout and stderr and can interleave them slightly
  # out of order, so a saved timestamp guarantees all its lines accepted only
  # for non-decreasing timestamps.
  local batch_full=0
  
  log_info "Collecting logs from: $container"
  
  # Check if container exists and is running
  if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    log_warn "Container '$container' not found or not running. Skipping."
    return 0
  fi
  
  local state_file
  state_file="${STATE_DIR}/$(sanitize_key "${SOURCE_ID}__${container}")"
  load_state "$state_file"
  local since_ts="$SINCE_TS"
  
  # Build docker logs command. With state: --since that timestamp and no
  # --tail cap, so nothing between the last sent line and now is skipped.
  # Without state: the tail window (also in follow mode, so a first start
  # does not replay the whole container history).
  local docker_cmd="docker logs --timestamps"
  if [ "$FOLLOW" = "true" ]; then
    docker_cmd="$docker_cmd --follow"
  fi
  if [ -n "$since_ts" ]; then
    docker_cmd="$docker_cmd --since $since_ts"
  else
    docker_cmd="$docker_cmd --tail $TAIL_LINES"
  fi
  docker_cmd="$docker_cmd $container 2>&1"
  
  # Process logs line by line. The loop reads from a process substitution, not a
  # pipe: a piped loop runs in a subshell, so the batch left over after the loop
  # (fewer than $batch_size lines) would never be sent.
  while IFS= read -r line; do
    # Parse timestamp (Docker format: 2026-03-21T07:30:00.123456789Z)
    if [[ "$line" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+Z)\ (.*)$ ]]; then
      timestamp="${BASH_REMATCH[1]}"
      message="${BASH_REMATCH[2]}"
      # docker logs --since is inclusive, so the stored boundary line comes
      # back on every run; skip everything at or before the stored timestamp.
      if [ -n "$since_ts" ] && [[ ! "$timestamp" > "$since_ts" ]]; then
        continue
      fi
      # A held-back full batch ends only here: this timestamped line has a
      # different timestamp, so the last timestamp of the batch is complete
      # and saving it cannot skip lines that belong to a later batch.
      if [ "$batch_full" -eq 1 ] && [ "$timestamp" != "$batch_last_ts" ]; then
        payload=$(jq -n --argjson logs "$logs_array" '{logs: $logs}')
        if send_logs "$payload"; then
          log_info "Sent $count logs from $container"
          if [ -n "$batch_last_ts" ]; then
            save_state "$state_file" "$batch_last_ts"
          fi
        else
          note_send_failure
        fi
        logs_array="[]"
        count=0
        batch_last_ts=""
        batch_full=0
      fi
      batch_last_ts="$timestamp"
    else
      # No timestamp, use current time (such lines never advance the state:
      # this timestamp is not one docker would show for the line again)
      timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
      message="$line"
    fi
    
    # Parse log level
    level=$(parse_level "$message")
    
    # Escape JSON
    message_escaped=$(printf '%s' "$message" | jq -Rs .)
    
    # Add to batch
    log_entry=$(cat <<EOF
{
  "timestamp": "$timestamp",
  "level": "$level",
  "service": "$container",
  "message": $message_escaped
}
EOF
)
    
    logs_array=$(echo "$logs_array" | jq ". += [$log_entry]")
    count=$((count + 1))
    
    # The batch is full once the size is reached; it is sent when the next
    # timestamped line proves the trailing timestamp group complete (above),
    # so a saved timestamp never splits a group across batches.
    if [ $count -ge $batch_size ]; then
      batch_full=1
    fi
  done < <(eval "$docker_cmd")
  
  # Send remaining logs: the stream ended, so the last timestamp seen is
  # complete and safe to save.
  if [ $count -gt 0 ]; then
    payload=$(jq -n --argjson logs "$logs_array" '{logs: $logs}')
    if send_logs "$payload"; then
      log_info "Sent final $count logs from $container"
      if [ -n "$batch_last_ts" ]; then
        save_state "$state_file" "$batch_last_ts"
      fi
    else
      note_send_failure
    fi
  fi
}

# Main
main() {
  log_info "Starting Docker log collection"
  log_info "API: $TELERITHM_API"
  log_info "Source ID: $SOURCE_ID"
  log_info "Containers: $CONTAINERS"
  log_info "Follow mode: $FOLLOW"
  log_info "State dir: $STATE_DIR"
  
  # Check dependencies
  if ! command -v docker &> /dev/null; then
    log_error "docker command not found. Please install Docker."
    exit 1
  fi
  
  if ! command -v jq &> /dev/null; then
    log_error "jq command not found. Please install jq (sudo apt install jq)"
    exit 1
  fi
  
  if ! command -v curl &> /dev/null; then
    log_error "curl command not found. Please install curl."
    exit 1
  fi
  
  # State directory: 0700, it holds one small file per source and container.
  # A directory that already exists is tightened on every run (an older run
  # or a hand-made directory may have looser permissions); only when the
  # running user owns it, so a chmod that could not work is not attempted.
  if [ ! -d "$STATE_DIR" ]; then
    if ! mkdir -p "$STATE_DIR"; then
      log_error "Cannot create state directory $STATE_DIR"
      exit 1
    fi
    chmod 700 "$STATE_DIR"
  elif [ -O "$STATE_DIR" ]; then
    chmod 700 "$STATE_DIR"
  fi
  
  # Process each container
  for container in $CONTAINERS; do
    process_container_logs "$container"
  done
  
  log_info "Collection complete"
  
  # A one-shot (cron) run signals a failed send to cron mail or monitoring by
  # exiting non-zero, only after every container was processed (a follow run
  # already exited from note_send_failure). Each container whose send failed had
  # its own state frozen and will re-read from its last good timestamp next run;
  # containers whose sends were accepted kept their own state.
  if [ "$RUN_SEND_FAILED" -ne 0 ]; then
    log_error "One or more sends failed; the state of those containers did not advance (their lines are re-sent next run)"
    exit 1
  fi
}

# Run
main
