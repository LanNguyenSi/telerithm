#!/usr/bin/env bash
# Telerithm stdin pipe — ships stdin lines to Telerithm ingest API
#
# Usage:
#   my-app 2>&1 | ./telerithm-pipe.sh
#   tail -f /var/log/app.log | TELERITHM_URL=http://localhost:4000 TELERITHM_SOURCE_ID=xxx TELERITHM_API_KEY=lf_xxx ./telerithm-pipe.sh
#
# Environment variables:
#   TELERITHM_URL       - Telerithm backend URL (default: http://localhost:4000)
#   TELERITHM_SOURCE_ID - Source ID to ingest into (required)
#   TELERITHM_API_KEY   - API key for the source (required)
#   BATCH_SIZE         - Max lines per batch (default: 50)
#   FLUSH_INTERVAL     - Seconds between flushes (default: 5)

set -euo pipefail

: "${TELERITHM_URL:=http://localhost:4000}"
: "${TELERITHM_SOURCE_ID:?TELERITHM_SOURCE_ID is required}"
: "${TELERITHM_API_KEY:?TELERITHM_API_KEY is required}"
: "${BATCH_SIZE:=50}"
: "${FLUSH_INTERVAL:=5}"

ENDPOINT="${TELERITHM_URL}/api/v1/ingest/${TELERITHM_SOURCE_ID}"
BUFFER=()
LAST_FLUSH=$(date +%s)

flush() {
  if [ ${#BUFFER[@]} -eq 0 ]; then
    return
  fi

  # Build JSON array of log strings
  local json="["
  local first=true
  for line in "${BUFFER[@]}"; do
    if [ "$first" = true ]; then
      first=false
    else
      json+=","
    fi
    # Escape JSON special chars
    escaped=$(printf '%s' "$line" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g')
    json+="\"${escaped}\""
  done
  json+="]"

  local payload="{\"logs\":${json}}"

  curl -s -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${TELERITHM_API_KEY}" \
    -d "$payload" > /dev/null 2>&1 || true

  BUFFER=()
  LAST_FLUSH=$(date +%s)
}

trap flush EXIT

while IFS= read -r -t "$FLUSH_INTERVAL" line || {
  # Timeout: flush buffered lines
  flush
  [ -n "${line:-}" ]
}; do
  if [ -n "$line" ]; then
    BUFFER+=("$line")
  fi

  if [ ${#BUFFER[@]} -ge "$BATCH_SIZE" ]; then
    flush
  fi

  # Check time-based flush
  now=$(date +%s)
  if (( now - LAST_FLUSH >= FLUSH_INTERVAL )); then
    flush
  fi
done

# Final flush
flush
