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

# Sub-second-safe elapsed-time tracking for the periodic (idle) flush below.
#
# Bash 5+ exposes $EPOCHREALTIME as "<seconds>.<microseconds>" without
# forking `date`; we use that microsecond counter when available. On bash
# builds without it (e.g. macOS's system /bin/bash 3.2) we fall back to
# whole-second timestamps from `date +%s`. Those are floor-rounded, so
# naively comparing elapsed time with ">=" can report a full FLUSH_INTERVAL
# as having passed after only a few milliseconds, whenever the process
# happens to straddle a wall-clock second boundary between two checks. That
# was the root cause of a flaky CLI test: a fresh batch could get split into
# two POSTs before BATCH_SIZE lines had even been read. On the fallback path
# we therefore compare with strict ">" instead of ">=", which can delay a
# time-based flush by up to ~1-2 extra seconds but never fires it early.
HAVE_SUBSECOND_CLOCK=0
[ -n "${EPOCHREALTIME:-}" ] && HAVE_SUBSECOND_CLOCK=1
FLUSH_INTERVAL_US=$(( FLUSH_INTERVAL * 1000000 ))

now_us() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    # $EPOCHREALTIME honors LC_NUMERIC's radix character: on comma-decimal
    # locales (e.g. LC_NUMERIC=de_DE.UTF-8) it is "<sec>,<usec>", not
    # "<sec>.<usec>". Normalize the separator to '.' before splitting, or a
    # literal-dot pattern silently fails to split and the resulting
    # concatenation is parsed as garbage.
    local ert="${EPOCHREALTIME/,/.}"
    local whole="${ert%%[.,]*}"
    local frac="${ert#*[.,]}"
    printf '%d\n' "$((10#${whole}${frac}))"
  else
    printf '%d\n' "$(( $(date +%s) * 1000000 ))"
  fi
}

LAST_FLUSH=$(now_us)

flush() {
  if [ ${#BUFFER[@]} -gt 0 ]; then
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
  fi

  # Always reset the flush clock, even when there was nothing to send, so a
  # long idle period never leaves a stale LAST_FLUSH that would force the
  # next freshly-arrived line to flush immediately.
  LAST_FLUSH=$(now_us)
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
  elapsed_us=$(( $(now_us) - LAST_FLUSH ))
  if [ "$HAVE_SUBSECOND_CLOCK" -eq 1 ]; then
    if (( elapsed_us >= FLUSH_INTERVAL_US )); then
      flush
    fi
  else
    if (( elapsed_us > FLUSH_INTERVAL_US )); then
      flush
    fi
  fi
done

# Final flush
flush
