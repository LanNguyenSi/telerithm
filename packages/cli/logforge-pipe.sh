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

# Main read loop, restructured to avoid a busy-loop/flush-storm under a slow
# trickle of input that ends near a read timeout (agent-tasks 73da842f).
#
# The previous `while read -t ... || { flush; [ -n "$line" ]; }` structure
# could not tell a genuine timeout apart from EOF: both make `read` return
# non-zero, and bash never clears `line` when a read fails, so it kept
# whatever value it held from the last successful read. At real EOF that
# left a stale non-empty `line` behind forever, so `[ -n "$line" ]` stayed
# true, the while-condition kept evaluating true, and the loop body kept
# re-appending that same stale value to BUFFER and re-flushing on every
# spin, as fast as the CPU could iterate (no read ever blocked again, since
# a closed fd returns immediately). That is the busy-loop/flush-storm.
#
# The fix needs to tell "genuine timeout, more input may still come" apart
# from "EOF/error, no more input is coming" without ever spinning. `read`'s
# own exit status is NOT a reliable way to do that: bash is documented to
# return > 128 for an expired -t timeout, but that is not honored
# consistently across builds. Measured directly on macOS's system bash 3.2,
# a genuine mid-stream timeout (input still open, just idle) and a true EOF
# both return plain status 1, indistinguishable by exit code alone.
#
# Instead this measures how long the failed `read` call itself actually
# took. A `read -t N` timeout is defined to cost at least N seconds of real
# wall time before it can fail that way; EOF (or another read error) on an
# already-exhausted/closed descriptor fails immediately, every time, since
# there is nothing left to wait for. That timing difference is a property
# of what `read -t` does, not of any version's exit-code convention, so it
# holds on bash 3.2 and bash 5 alike:
#   - read succeeds:              a line arrived; buffer it.
#   - failed, took >= FLUSH_INTERVAL: a genuine timeout. Flush (if there is
#     anything buffered) and loop back to another real, bounded read. This
#     cannot spin: every pass through this branch is preceded by an actual
#     wait of roughly FLUSH_INTERVAL seconds.
#   - failed, took far less than FLUSH_INTERVAL: can only happen once the
#     input is exhausted, since a genuine timeout always costs real time.
#     Buffer whatever partial final line `read` may have captured before
#     failing (see below), then eventually stop reading for good instead
#     of looping forever.
#
# On the whole-second fallback clock (no $EPOCHREALTIME, e.g. macOS's
# system bash), that per-read duration is floor-rounded like the periodic
# flush check below, so a near-instant EOF read can occasionally look like
# it took a full second if it happens to straddle a wall-clock second
# boundary. INSTANT_FAIL_CAP bounds how many consecutive near-instant
# failures get the benefit of the doubt before this concludes EOF anyway:
# each such retry is itself a real `read -t` call bounded by FLUSH_INTERVAL,
# so the loop can never take more than INSTANT_FAIL_CAP consecutive
# near-instant passes without either reading a line or hitting a genuine
# timeout, which rules out an unbounded spin regardless of clock
# resolution.
#
# `line` is reset before every read so a failed read never leaves a stale
# value behind to be misread as a pending partial line. `read` only
# populates `line` on a failed call at true EOF with a final,
# newline-less line; a genuine mid-stream timeout that catches a partial
# line never does (verified: bash silently drops those in-flight bytes
# instead, a separate pre-existing `read -t` limitation this fix does not
# change). So that partial content, whenever present, is captured
# immediately below, before the near-instant retry/backoff logic runs, or
# a later retry resetting `line` to empty would discard it.
INSTANT_FAIL_CAP=3
instant_fail_streak=0

while true; do
  line=""
  read_start_us=$(now_us)
  if IFS= read -r -t "$FLUSH_INTERVAL" line; then
    read_status=0
  else
    read_status=$?
  fi

  if [ "$read_status" -eq 0 ]; then
    instant_fail_streak=0
    BUFFER+=("$line")

    if [ ${#BUFFER[@]} -ge "$BATCH_SIZE" ]; then
      flush
    elif [ ${#BUFFER[@]} -gt 0 ]; then
      # Lines can keep trickling in faster than FLUSH_INTERVAL, so `read`
      # may never actually time out even though a full interval has passed
      # since the last flush. Only bother checking when there is something
      # buffered to flush.
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
    fi
    continue
  fi

  # `read` only ever populates `line` on a *failed* call when it has hit
  # true EOF with a final line that had no trailing newline (verified: a
  # genuine mid-stream timeout that catches a partial, not-yet-terminated
  # line does NOT populate `line` here - bash silently drops those partial
  # bytes instead, a separate pre-existing `read -t` limitation unrelated
  # to this fix). So a non-empty `line` at this point is buffered
  # immediately, before the retry/backoff logic below runs, or it would be
  # discarded the moment a following retry resets `line` to empty.
  if [ -n "$line" ]; then
    BUFFER+=("$line")
  fi

  read_elapsed_us=$(( $(now_us) - read_start_us ))

  if [ "$read_elapsed_us" -ge "$FLUSH_INTERVAL_US" ]; then
    # Genuine timeout: this read call just performed a real bounded wait.
    instant_fail_streak=0
    if [ ${#BUFFER[@]} -gt 0 ]; then
      flush
    fi
    continue
  fi

  instant_fail_streak=$((instant_fail_streak + 1))
  if [ "$instant_fail_streak" -lt "$INSTANT_FAIL_CAP" ]; then
    continue
  fi

  # Confirmed end of input: only a truly exhausted/closed stream can
  # produce this many consecutive near-instant read failures in a row.
  break
done

# Final flush
flush
