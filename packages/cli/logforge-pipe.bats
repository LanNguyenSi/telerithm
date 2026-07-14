#!/usr/bin/env bats
# Smoke tests for logforge-pipe.sh: env validation + happy-path ingest POST.

SCRIPT="$BATS_TEST_DIRNAME/logforge-pipe.sh"

setup() {
  FAKE_BIN_DIR="$(mktemp -d)"
  CAPTURE_FILE="$(mktemp)"
  export FAKE_CURL_CAPTURE="$CAPTURE_FILE"

  # Fake `curl` that records every invocation (args, one per line) instead of
  # making a real network call. The real script redirects curl's own stdout
  # to /dev/null, so we record to a separate capture file instead.
  cat > "$FAKE_BIN_DIR/curl" <<'EOF'
#!/usr/bin/env bash
{
  printf 'CALL\n'
  for arg in "$@"; do
    printf '%s\n' "$arg"
  done
  printf 'END\n'
} >> "$FAKE_CURL_CAPTURE"
exit 0
EOF
  chmod +x "$FAKE_BIN_DIR/curl"
}

teardown() {
  rm -rf "$FAKE_BIN_DIR"
  rm -f "$CAPTURE_FILE"
}

@test "exits non-zero when TELERITHM_SOURCE_ID is missing" {
  unset TELERITHM_SOURCE_ID
  export TELERITHM_API_KEY="key123"

  run bash "$SCRIPT" </dev/null

  [ "$status" -ne 0 ]
  [[ "$output" == *"TELERITHM_SOURCE_ID is required"* ]]
}

@test "exits non-zero when TELERITHM_API_KEY is missing" {
  export TELERITHM_SOURCE_ID="src123"
  unset TELERITHM_API_KEY

  run bash "$SCRIPT" </dev/null

  [ "$status" -ne 0 ]
  [[ "$output" == *"TELERITHM_API_KEY is required"* ]]
}

@test "posts buffered stdin lines to the ingest endpoint with the API key header" {
  export TELERITHM_SOURCE_ID="src123"
  export TELERITHM_API_KEY="key123"
  export TELERITHM_URL="http://fake-host:4000"
  export BATCH_SIZE=1
  export FLUSH_INTERVAL=1
  export PATH="$FAKE_BIN_DIR:$PATH"

  run bash -c "printf 'hello world\n' | \"$SCRIPT\""

  [ "$status" -eq 0 ]
  [ -s "$CAPTURE_FILE" ]

  grep -qF "http://fake-host:4000/api/v1/ingest/src123" "$CAPTURE_FILE"
  grep -qF "X-API-Key: key123" "$CAPTURE_FILE"
  grep -qF '{"logs":["hello world"]}' "$CAPTURE_FILE"
}

@test "joins a full batch of multiple lines into a single JSON array in one POST" {
  export TELERITHM_SOURCE_ID="src123"
  export TELERITHM_API_KEY="key123"
  export TELERITHM_URL="http://fake-host:4000"
  export BATCH_SIZE=2
  export FLUSH_INTERVAL=1
  export PATH="$FAKE_BIN_DIR:$PATH"

  run bash -c "printf 'line one\nline two\n' | \"$SCRIPT\""

  [ "$status" -eq 0 ]
  [ -s "$CAPTURE_FILE" ]

  grep -qF '{"logs":["line one","line two"]}' "$CAPTURE_FILE"
  # Exactly one flush/POST for the full batch.
  [ "$(grep -c '^CALL$' "$CAPTURE_FILE")" -eq 1 ]
}

@test "paces periodic flushes for a slow trickle without spinning or hanging" {
  # Regression test for agent-tasks 73da842f: a slow trickle of input that
  # never fills BATCH_SIZE and ends shortly after a read-timeout boundary
  # used to make the script busy-loop (bash never blocked in `read -t`
  # again once the input pipe hit EOF, because a stale non-empty `line`
  # from the last real read kept the old `read ... || { flush; [ -n
  # "$line" ]; }` loop condition true forever). That produced 500+ spurious
  # POSTs full of duplicated content, or an outright hang. This test pins
  # the fixed behavior: bounded, interval-paced flushes, no duplicated or
  # dropped lines, and a clean exit.
  export TELERITHM_SOURCE_ID="src123"
  export TELERITHM_API_KEY="key123"
  export TELERITHM_URL="http://fake-host:4000"
  export BATCH_SIZE=100
  export FLUSH_INTERVAL=1
  export PATH="$FAKE_BIN_DIR:$PATH"

  FIFO="$(mktemp -u)"
  mkfifo "$FIFO"

  (
    for i in 1 2 3 4 5 6; do
      printf 'line %d\n' "$i"
      sleep 0.4
    done
  ) > "$FIFO" &
  writer_pid=$!

  bash "$SCRIPT" < "$FIFO" &
  script_pid=$!

  # Safety watchdog: this test exists specifically to prove the script does
  # NOT hang/spin under a slow trickle. If that regresses, kill it instead
  # of wedging the suite; the assertions below still fail either way.
  (
    sleep 8
    kill -9 "$script_pid" 2>/dev/null
  ) &
  watchdog_pid=$!

  wait "$script_pid"
  status=$?

  kill "$watchdog_pid" 2>/dev/null
  wait "$writer_pid" 2>/dev/null
  rm -f "$FIFO"

  [ "$status" -eq 0 ]
  [ -s "$CAPTURE_FILE" ]

  call_count="$(grep -c '^CALL$' "$CAPTURE_FILE")"
  # Bounded, interval-paced flushing: FLUSH_INTERVAL=1s against a ~2.4s
  # trickle should produce a small number of periodic flushes. Previously
  # this was 500+ (a storm) or the process never returned (a hang).
  [ "$call_count" -ge 1 ]
  [ "$call_count" -le 4 ]

  # No lines lost or duplicated across the periodic flushes.
  total_lines="$(grep -o '"line [0-9]"' "$CAPTURE_FILE" | wc -l | tr -d ' ')"
  [ "$total_lines" -eq 6 ]
}
