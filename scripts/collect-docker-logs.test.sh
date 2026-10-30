#!/usr/bin/env bash
# Tests for scripts/collect-docker-logs.sh. Runs the collector against a stub
# `docker` and a stub `curl` placed first on PATH (jq is real), so no Docker
# daemon, no ingest API and no network are touched. HOME, XDG_STATE_HOME and
# any explicit TELERITHM_STATE_DIR point into a scratch directory made by
# mktemp, so the real HOME is never written to.
#
# Usage: bash scripts/collect-docker-logs.test.sh
# Must pass under bash 3.2 (/bin/bash on macOS) and bash 5.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLLECT_SH="${SCRIPT_DIR}/collect-docker-logs.sh"

# A failed mktemp must stop the run before the cleanup trap exists: an empty
# SCRATCH would otherwise point the trap at the caller's directory.
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/collect-docker-logs-test.XXXXXX")" \
  || { echo "FATAL: mktemp failed" >&2; exit 2; }
if [ -z "${SCRATCH}" ] || [ ! -d "${SCRATCH}" ]; then
  echo "FATAL: no scratch directory" >&2
  exit 2
fi
remove_scratch() {
  case "$1" in /*) ;; *) return 0 ;; esac
  case "${1##*/}" in collect-docker-logs-test.?*) ;; *) return 0 ;; esac
  rm -rf "$1"
}
trap 'remove_scratch "${SCRATCH}"' EXIT

export HOME="${SCRATCH}/home"
mkdir -p "${HOME}"
case "${HOME}" in
  "${SCRATCH}"/*) ;;
  *) echo "FATAL: HOME is not inside the scratch directory" >&2; exit 2 ;;
esac

# --- stub docker --------------------------------------------------------------
# Steered by environment variables:
#   STUB_RUNNING    container names `ps --format {{.Names}}` lists (space separated)
#   STUB_LOG_FILE   file whose content `docker logs` prints (docker's own
#                   --timestamps format: fixed-width 9-digit fractions, the
#                   assumption that makes the collector's string comparison
#                   and docker's --since filtering agree)
# Every docker invocation is appended to $STUB_DOCKER_LOG as one argv line.
STUB_DIR="${SCRATCH}/stubbin"
mkdir -p "${STUB_DIR}"
cat > "${STUB_DIR}/docker" <<'STUB'
#!/bin/bash
echo "docker $*" >> "${STUB_DOCKER_LOG}"
case "${1:-}" in
  ps)
    # shellcheck disable=SC2086
    printf '%s\n' ${STUB_RUNNING:-} ;;
  logs)
    cat "${STUB_LOG_FILE:?stub docker: STUB_LOG_FILE not set}" ;;
  *) exit 98 ;;
esac
exit 0
STUB
cat > "${STUB_DIR}/curl" <<'STUB'
#!/bin/bash
payload=""
prev=""
for a in "$@"; do
  if [ "${prev}" = "-d" ]; then payload="$a"; fi
  prev="$a"
done
printf '%s\n' "$payload" >> "${STUB_CURL_LOG}"
printf 'accepted\n'
printf '\n%s\n' "${STUB_HTTP:-202}"
exit 0
STUB
chmod +x "${STUB_DIR}/docker" "${STUB_DIR}/curl"
export PATH="${STUB_DIR}:${PATH}"
export STUB_DOCKER_LOG="${SCRATCH}/docker.log"
export STUB_CURL_LOG="${SCRATCH}/curl.log"
: > "${STUB_DOCKER_LOG}"
: > "${STUB_CURL_LOG}"
export STUB_LOG_FILE="${SCRATCH}/logs.txt"
export STUB_RUNNING="c1"

API_KEY_USED="lf_secret_zzz999"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

# run_collector [VAR=val ...]: clears both stub logs, runs the collector with a
# clean set of TELERITHM_* variables, leaves the status in RC and the output
# (stdout and stderr) in OUT. Scenario toggles are passed as arguments so no
# scenario can inherit another one's environment.
run_collector() {
  : > "${STUB_DOCKER_LOG}"
  : > "${STUB_CURL_LOG}"
  OUT="$(env -u XDG_STATE_HOME -u TELERITHM_STATE_DIR -u TELERITHM_FOLLOW \
    -u TELERITHM_TAIL_LINES -u STUB_HTTP \
    TELERITHM_API="http://stub.invalid/api/v1" \
    TELERITHM_SOURCE_ID="src_test" \
    TELERITHM_API_KEY="${API_KEY_USED}" \
    TELERITHM_CONTAINERS="c1" \
    "$@" \
    bash "${COLLECT_SH}" 2>&1)"
  RC=$?
}

# logs_lines <file> <ts1> <text1> [<ts2> <text2> ...]: write docker log output
logs_lines() {
  local f="$1"; shift
  : > "${f}"
  while [ "$#" -gt 0 ]; do
    printf '%s %s\n' "$1" "$2" >> "${f}"
    shift 2
  done
}

# messages: comma-joined message field of every payload received since reset
messages() {
  jq -s -r '[.[].logs[].message] | join(",")' "${STUB_CURL_LOG}" 2>/dev/null
}

batches() {
  grep -c '"logs"' "${STUB_CURL_LOG}" 2>/dev/null || true
}

mode_of() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

TS1="2026-03-21T07:30:01.000000000Z"
TS2="2026-03-21T07:30:02.000000000Z"
TS3="2026-03-21T07:30:03.000000000Z"
TS4="2026-03-21T07:30:04.000000000Z"

# --- 1. first run, no state: today's behaviour, state written ------------------
logs_lines "${STUB_LOG_FILE}" "${TS1}" "first" "${TS2}" "second" "${TS3}" "third"
run_collector
if [ "${RC}" -eq 0 ]; then ok "first run: exit 0"; else bad "first run: rc=${RC} out=${OUT}"; fi
if grep -q '^docker logs --timestamps --tail 100 c1$' "${STUB_DOCKER_LOG}"; then
  ok "first run: --tail 100, no --since"
else bad "first run: docker argv: $(cat "${STUB_DOCKER_LOG}")"; fi
if ! grep -q -- '--since' "${STUB_DOCKER_LOG}"; then ok "first run: no --since at all"; else bad "first run: unexpected --since"; fi
if [ "$(messages)" = "first,second,third" ]; then ok "first run: all three lines sent"; else bad "first run: messages=$(messages) out=${OUT}"; fi
if [ "$(batches)" = "1" ]; then ok "first run: one batch"; else bad "first run: batches=$(batches)"; fi
STATE="${HOME}/.local/state/telerithm-collector"
if [ "$(cat "${STATE}/src_test__c1" 2>/dev/null)" = "${TS3}" ]; then
  ok "first run: default state file (XDG unset -> \$HOME/.local/state) holds the last timestamp"
else bad "first run: state=$(cat "${STATE}/src_test__c1" 2>/dev/null) state_dir=$(find "${HOME}" -type d 2>/dev/null)"; fi
if [ "$(mode_of "${STATE}")" = "700" ]; then ok "state dir created 0700"; else bad "state dir mode=$(mode_of "${STATE}")"; fi
if [ "$(mode_of "${STATE}/src_test__c1")" = "600" ]; then ok "state file created 0600"; else bad "state file mode=$(mode_of "${STATE}/src_test__c1")"; fi
if ! grep -q "${API_KEY_USED}" "${STATE}/src_test__c1" && ! grep -q "${API_KEY_USED}" <<< "${OUT}"; then
  ok "API key appears in neither the state file nor the output"
else bad "API key leaked"; fi

# --- 2. second run over the same stub output: nothing re-sent ------------------
run_collector
if grep -q "^docker logs --timestamps --since ${TS3} c1\$" "${STUB_DOCKER_LOG}"; then
  ok "second run: --since <state>"
else bad "second run: docker argv: $(cat "${STUB_DOCKER_LOG}")"; fi
if ! grep -q -- '--tail' "${STUB_DOCKER_LOG}"; then ok "second run: no --tail cap with state"; else bad "second run: --tail still applied"; fi
if [ "$(batches)" = "0" ]; then ok "second run: boundary and older lines not re-sent"; else bad "second run: batches=$(batches) messages=$(messages)"; fi
if [ "$(cat "${STATE}/src_test__c1")" = "${TS3}" ]; then ok "second run: state unchanged"; else bad "second run: state advanced to $(cat "${STATE}/src_test__c1")"; fi

# --- 3. third run with one new line: only the new line is sent -----------------
logs_lines "${STUB_LOG_FILE}" "${TS1}" "first" "${TS2}" "second" "${TS3}" "third" "${TS4}" "fourth"
run_collector
if [ "$(messages)" = "fourth" ]; then ok "new line only: just the fourth line sent"; else bad "new line only: messages=$(messages)"; fi
if [ "$(cat "${STATE}/src_test__c1")" = "${TS4}" ]; then ok "new line only: state advanced to the fourth timestamp"; else bad "new line only: state=$(cat "${STATE}/src_test__c1")"; fi
if grep -qE -- "--since [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{9}Z" "${STUB_DOCKER_LOG}"; then
  ok "new line only: --since value is RFC3339Nano with a 9-digit fraction"
else bad "new line only: since format: $(cat "${STUB_DOCKER_LOG}")"; fi

# --- 3a. exactly one batch: only the mid-loop send can advance the state --------
STATE3A="${SCRATCH}/state3a"
LOGS50="${SCRATCH}/logs50.txt"
: > "${LOGS50}"
i=0
while [ "$i" -lt 50 ]; do
  printf '2026-04-01T00:00:%02d.000000000Z line%d\n' "${i}" "${i}" >> "${LOGS50}"
  i=$((i + 1))
done
STUB_LOG_FILE="${LOGS50}" run_collector TELERITHM_STATE_DIR="${STATE3A}"
if [ "$(batches)" = "1" ] && [ "$(cat "${STATE3A}/src_test__c1" 2>/dev/null)" = "2026-04-01T00:00:49.000000000Z" ]; then
  ok "exactly 50 lines: batch sent in the loop, no second batch, state at line 50"
else bad "50 lines: batches=$(batches) state=$(cat "${STATE3A}/src_test__c1" 2>/dev/null) out=${OUT}"; fi

# --- 3b. more than one batch: the mid-loop send advances the state too ---------
STATE3B="${SCRATCH}/state3b"
LOGS60="${SCRATCH}/logs60.txt"
: > "${LOGS60}"
i=0
while [ "$i" -lt 60 ]; do
  printf '2026-04-01T00:00:%02d.000000000Z line%d\n' "${i}" "${i}" >> "${LOGS60}"
  i=$((i + 1))
done
STUB_LOG_FILE="${LOGS60}" run_collector TELERITHM_STATE_DIR="${STATE3B}"
if [ "$(batches)" = "2" ] \
  && [ "$(jq -s '[.[].logs[]] | length' "${STUB_CURL_LOG}" 2>/dev/null)" = "60" ] \
  && [ "$(cat "${STATE3B}/src_test__c1")" = "2026-04-01T00:00:59.000000000Z" ]; then
  ok "60 lines: two batches (50 + 10), state at the last accepted line"
else bad "60 lines: batches=$(batches) state=$(cat "${STATE3B}/src_test__c1" 2>/dev/null) out=${OUT}"; fi
STATE3C="${SCRATCH}/state3c"
STUB_LOG_FILE="${LOGS60}" run_collector TELERITHM_STATE_DIR="${STATE3C}" STUB_HTTP=500
if [ ! -f "${STATE3C}/src_test__c1" ]; then
  ok "60 lines with a failed send: the mid-loop batch leaves no state behind"
else bad "60 lines failed send: state=$(cat "${STATE3C}/src_test__c1")"; fi

# --- 4. failed send: state must not advance, next run resends ------------------
STATE4="${SCRATCH}/state4"
logs_lines "${STUB_LOG_FILE}" "${TS1}" "first" "${TS2}" "second" "${TS3}" "third"
run_collector TELERITHM_STATE_DIR="${STATE4}" STUB_HTTP=500
if [ "${RC}" -eq 0 ] && [ ! -d "${STATE4}/src_test__c1" ] && [ ! -f "${STATE4}/src_test__c1" ]; then
  ok "failed send (HTTP 500): exit 0, state not written"
else bad "failed send: rc=${RC} out=${OUT} files=$(find "${STATE4}" -type f 2>/dev/null)"; fi
if grep -q "Failed to send logs (HTTP 500)" <<< "${OUT}"; then
  ok "failed send: error is logged"
else bad "failed send: out=${OUT}"; fi
run_collector TELERITHM_STATE_DIR="${STATE4}"
if [ "$(messages)" = "first,second,third" ] && [ "$(cat "${STATE4}/src_test__c1")" = "${TS3}" ]; then
  ok "failed send: next run resends everything and records the state"
else bad "failed send: messages=$(messages) state=$(cat "${STATE4}/src_test__c1" 2>/dev/null)"; fi
# a previously stored state survives a failed run untouched
printf '%s\n' "${TS2}" > "${STATE4}/src_test__c1"
logs_lines "${STUB_LOG_FILE}" "${TS1}" "first" "${TS2}" "second" "${TS3}" "third"
run_collector TELERITHM_STATE_DIR="${STATE4}" STUB_HTTP=500
if [ "$(cat "${STATE4}/src_test__c1")" = "${TS2}" ]; then
  ok "failed send with existing state: old state kept (at-least-once)"
else bad "failed send with existing state: state=$(cat "${STATE4}/src_test__c1")"; fi
run_collector TELERITHM_STATE_DIR="${STATE4}"
if [ "$(messages)" = "third" ] && [ "$(cat "${STATE4}/src_test__c1")" = "${TS3}" ]; then
  ok "failed send with existing state: the skipped batch is resent once the send works"
else bad "recovery: messages=$(messages) state=$(cat "${STATE4}/src_test__c1")"; fi

# --- 5. per-container state ------------------------------------------------------
STATE5="${SCRATCH}/state5"
export STUB_RUNNING="c1 c2"
logs_lines "${STUB_LOG_FILE}" "${TS1}" "alpha" "${TS2}" "beta"
run_collector TELERITHM_STATE_DIR="${STATE5}" TELERITHM_CONTAINERS="c1 c2"
if [ -f "${STATE5}/src_test__c1" ] && [ -f "${STATE5}/src_test__c2" ]; then
  ok "two containers: one state file each"
else bad "two containers: $(find "${STATE5}" -type f 2>/dev/null)"; fi
run_collector TELERITHM_STATE_DIR="${STATE5}" TELERITHM_CONTAINERS="c1 c2"
if grep -q "^docker logs --timestamps --since ${TS2} c1\$" "${STUB_DOCKER_LOG}" \
  && grep -q "^docker logs --timestamps --since ${TS2} c2\$" "${STUB_DOCKER_LOG}"; then
  ok "two containers: both resume with their own --since"
else bad "two containers: argv: $(cat "${STUB_DOCKER_LOG}")"; fi
# c1 fully sent, c2 reset to no state: only c1 may use --since
printf '%s\n' "${TS2}" > "${STATE5}/src_test__c1"
rm "${STATE5}/src_test__c2"
run_collector TELERITHM_STATE_DIR="${STATE5}" TELERITHM_CONTAINERS="c1 c2"
if grep -q "^docker logs --timestamps --since ${TS2} c1\$" "${STUB_DOCKER_LOG}" \
  && grep -q "^docker logs --timestamps --tail 100 c2\$" "${STUB_DOCKER_LOG}"; then
  ok "state of one container does not affect another without state"
else bad "mixed state: argv: $(cat "${STUB_DOCKER_LOG}")"; fi
export STUB_RUNNING="c1"

# --- 6. hostile container name cannot leave the state dir ------------------------
STATE6="${SCRATCH}/state6"
export STUB_RUNNING="../x"
logs_lines "${STUB_LOG_FILE}" "${TS1}" "hostile"
run_collector TELERITHM_STATE_DIR="${STATE6}" TELERITHM_CONTAINERS="../x"
if [ "$(find "${STATE6}" -type f | wc -l | tr -d ' ')" = "1" ] \
  && [ "$(find "${STATE6}" -type f -name 'src_test__.._x' | wc -l | tr -d ' ')" = "1" ]; then
  ok "hostile name ../x: state stays inside the state dir, sanitised file name"
else bad "hostile name: $(find "${STATE6}" 2>/dev/null) out=${OUT}"; fi
if ! find "${SCRATCH}" -maxdepth 1 -name 'src_test*' | grep -q .; then
  ok "hostile name: nothing written outside the state dir"
else bad "hostile name: state file escaped to $(find "${SCRATCH}" -maxdepth 1 -name 'src_test*')"; fi
export STUB_RUNNING="c1"

# --- 7. corrupt, empty and truncated state: [WARN], treated as no state ----------
STATE7="${SCRATCH}/state7"
mkdir -p "${STATE7}"
for corrupt in "not a timestamp" "2026-03-21T07:30:0" ""; do
  printf '%s' "${corrupt}" > "${STATE7}/src_test__c1"
  [ -n "${corrupt}" ] || printf '\n' >> "${STATE7}/src_test__c1"
  logs_lines "${STUB_LOG_FILE}" "${TS1}" "first" "${TS2}" "second" "${TS3}" "third"
  run_collector TELERITHM_STATE_DIR="${STATE7}"
  label="corrupt state"
  [ -n "${corrupt}" ] || label="empty state"
  if grep -q "WARN" <<< "${OUT}" \
    && grep -q '^docker logs --timestamps --tail 100 c1$' "${STUB_DOCKER_LOG}" \
    && [ "$(messages)" = "first,second,third" ] \
    && [ "$(cat "${STATE7}/src_test__c1")" = "${TS3}" ]; then
    ok "${label}: [WARN], falls back to --tail, state rewritten"
  else bad "${label}: rc=${RC} out=${OUT} argv=$(cat "${STUB_DOCKER_LOG}") state=$(cat "${STATE7}/src_test__c1")"; fi
done

# --- 8. follow mode: first start uses --tail, restart resumes with --since -------
STATE8="${SCRATCH}/state8"
logs_lines "${STUB_LOG_FILE}" "${TS1}" "live1" "${TS2}" "live2"
run_collector TELERITHM_STATE_DIR="${STATE8}" TELERITHM_FOLLOW=true
if grep -q '^docker logs --timestamps --follow --tail 100 c1$' "${STUB_DOCKER_LOG}"; then
  ok "follow, no state: --follow --tail (no history replay on first start)"
else bad "follow first: argv: $(cat "${STUB_DOCKER_LOG}") out=${OUT}"; fi
if [ "$(cat "${STATE8}/src_test__c1" 2>/dev/null)" = "${TS2}" ]; then
  ok "follow: state written after the accepted batch"
else bad "follow: state=$(cat "${STATE8}/src_test__c1" 2>/dev/null)"; fi
logs_lines "${STUB_LOG_FILE}" "${TS1}" "live1" "${TS2}" "live2" "${TS3}" "live3"
run_collector TELERITHM_STATE_DIR="${STATE8}" TELERITHM_FOLLOW=true
if grep -q "^docker logs --timestamps --follow --since ${TS2} c1\$" "${STUB_DOCKER_LOG}"; then
  ok "follow restart: --follow --since <state>, no --tail"
else bad "follow restart: argv: $(cat "${STUB_DOCKER_LOG}")"; fi
if [ "$(messages)" = "live3" ]; then ok "follow restart: only the new line is sent"; else bad "follow restart: messages=$(messages)"; fi

# --- 9. state dir precedence -------------------------------------------------------
# TELERITHM_STATE_DIR wins over XDG_STATE_HOME and is used as-is
P9A="${SCRATCH}/xdg9a"; P9B="${SCRATCH}/explicit9b"
logs_lines "${STUB_LOG_FILE}" "${TS1}" "prec"
run_collector TELERITHM_STATE_DIR="${P9B}" XDG_STATE_HOME="${P9A}"
if [ -f "${P9B}/src_test__c1" ] && [ ! -d "${P9A}" ]; then
  ok "precedence: TELERITHM_STATE_DIR wins over XDG_STATE_HOME and gets no subdirectory"
else bad "precedence dir: files=$(find "${P9A}" "${P9B}" 2>/dev/null)"; fi
# an empty TELERITHM_STATE_DIR counts as unset: XDG_STATE_HOME wins
run_collector TELERITHM_STATE_DIR="" XDG_STATE_HOME="${P9A}"
if [ -f "${P9A}/telerithm-collector/src_test__c1" ]; then
  ok "precedence: empty TELERITHM_STATE_DIR falls back to XDG_STATE_HOME/telerithm-collector"
else bad "precedence empty override: $(find "${P9A}" 2>/dev/null)"; fi
# an empty XDG_STATE_HOME counts as unset: $HOME/.local/state wins
P9C="${SCRATCH}/home9c"
run_collector HOME="${P9C}" XDG_STATE_HOME=""
if [ -f "${P9C}/.local/state/telerithm-collector/src_test__c1" ]; then
  ok "precedence: empty XDG_STATE_HOME falls back to \$HOME/.local/state"
else bad "precedence empty xdg: $(find "${P9C}" 2>/dev/null)"; fi
# XDG_STATE_HOME wins over the \$HOME default
run_collector XDG_STATE_HOME="${P9A}"
if [ -f "${P9A}/telerithm-collector/src_test__c1" ]; then
  ok "precedence: XDG_STATE_HOME wins over \$HOME/.local/state"
else bad "precedence xdg: $(find "${P9A}" 2>/dev/null)"; fi

echo
echo "passed: ${PASS}, failed: ${FAIL}"
[ "${FAIL}" -eq 0 ]
