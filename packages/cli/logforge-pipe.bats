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
