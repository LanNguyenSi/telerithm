#!/usr/bin/env bash
# Tests for scripts/setup-sources.sh. Runs the setup script against a stub
# `curl` placed first on PATH (jq is real), so no API and no network are
# touched. The session token never appears in any recorded curl argv, and the
# Authorization header arrives through the --config file (a file descriptor,
# as the script passes it) that the stub reads.
#
# setup-sources.sh parses the response with `head -n-1`, which is GNU-only:
# on a BSD head (macOS) that assignment fails and `set -e` stops the script
# after the first source. That behaviour is the script's and stays as it is,
# so only the assertions that need a completed run are gated on a feature
# probe (GNU_HEAD); the token/argv/config assertions run on every platform.
#
# Usage: bash scripts/setup-sources.test.sh
# Must pass under bash 3.2 (/bin/bash on macOS) and bash 5.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_SH="${SCRIPT_DIR}/setup-sources.sh"

# A failed mktemp must stop the run before the cleanup trap exists: an empty
# SCRATCH would otherwise point the trap at the caller's directory.
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/setup-sources-test.XXXXXX")" \
  || { echo "FATAL: mktemp failed" >&2; exit 2; }
if [ -z "${SCRATCH}" ] || [ ! -d "${SCRATCH}" ]; then
  echo "FATAL: no scratch directory" >&2
  exit 2
fi
remove_scratch() {
  case "$1" in /*) ;; *) return 0 ;; esac
  case "${1##*/}" in setup-sources-test.?*) ;; *) return 0 ;; esac
  rm -rf "$1"
}
trap 'remove_scratch "${SCRATCH}"' EXIT

GNU_HEAD=y
if ! printf 'a\nb\n' | head -n-1 >/dev/null 2>&1; then
  GNU_HEAD=n
fi

# --- stub curl -----------------------------------------------------------------
# Answers STUB_HTTP (default 201, the status createSource accepts) to every
# call with a body of the shape POST /sources returns, so the script's jq
# parsing runs for real. Every call appends its whole argv to
# $STUB_CURL_ARGV (one line per argument, one `--curl-argv--` marker line per
# call), the content of every --config/-K file it is given to
# $STUB_CURL_CONFIG, and the -d payload to $STUB_CURL_LOG.
STUB_DIR="${SCRATCH}/stubbin"
mkdir -p "${STUB_DIR}"
cat > "${STUB_DIR}/curl" <<'STUB'
#!/bin/bash
printf '%s\n' --curl-argv-- >> "${STUB_CURL_ARGV}"
for arg in "$@"; do printf '%s\n' "$arg" >> "${STUB_CURL_ARGV}"; done
payload=""
prev=""
for a in "$@"; do
  if [ "${prev}" = "-d" ]; then payload="$a"; fi
  if [ "${prev}" = "--config" ] || [ "${prev}" = "-K" ]; then
    cat -- "$a" >> "${STUB_CURL_CONFIG}"
  fi
  case "$a" in
    --config=*) cat -- "${a#--config=}" >> "${STUB_CURL_CONFIG}" ;;
  esac
  prev="$a"
done
printf '%s\n' "$payload" >> "${STUB_CURL_LOG}"
printf '%s\n' '{"source":{"id":"src_stub_id","apiKey":"lf_stub_answer_key"}}'
printf '\n%s\n' "${STUB_HTTP:-201}"
exit 0
STUB
chmod +x "${STUB_DIR}/curl"
export PATH="${STUB_DIR}:${PATH}"
export STUB_CURL_ARGV="${SCRATCH}/curl.argv"
export STUB_CURL_CONFIG="${SCRATCH}/curl.config"
export STUB_CURL_LOG="${SCRATCH}/curl.payloads"
: > "${STUB_CURL_ARGV}"
: > "${STUB_CURL_CONFIG}"
: > "${STUB_CURL_LOG}"

TOKEN_USED="tok_secret_9f3c5150"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

# run_setup [VAR=val ... | -u VAR]: clears the stub logs, runs the setup
# script with a fixed set of TELERITHM_* variables, leaves the status in RC
# and the output (stdout and stderr) in OUT.
run_setup() {
  : > "${STUB_CURL_ARGV}"
  : > "${STUB_CURL_CONFIG}"
  : > "${STUB_CURL_LOG}"
  RC=0
  OUT="$(env -u STUB_HTTP \
    TELERITHM_API="http://stub.invalid/api/v1" \
    TELERITHM_AUTH_TOKEN="${TOKEN_USED}" \
    TELERITHM_TEAM_ID="team_test" \
    "$@" \
    bash "${SETUP_SH}" 2>&1)" || RC=$?
  # The "|| RC=$?" keeps a non-zero script exit from tripping the CI step's
  # "bash -e"; RC holds it either way.
  POSTS="$(grep -c -- '^--curl-argv--$' "${STUB_CURL_ARGV}" || true)"
}

# --- 1. accepted run: token via --config only, behaviour otherwise intact ------
run_setup
if [ "${GNU_HEAD}" = y ]; then
  if [ "${RC}" -eq 0 ] && [ "${POSTS}" -eq 7 ] && grep -q "All sources created!" <<< "${OUT}"; then
    ok "accepted run: exit 0, seven sources created"
  else bad "accepted run: rc=${RC} posts=${POSTS} out=${OUT}"; fi
else
  if [ "${POSTS}" -ge 1 ]; then
    ok "accepted run: sources created until the script's GNU-only 'head -n-1' stops it (BSD platform, exit ${RC})"
  else bad "accepted run: no curl call at all: rc=${RC} out=${OUT}"; fi
fi
if ! grep -qF -- "${TOKEN_USED}" "${STUB_CURL_ARGV}" && ! grep -qF -- "${TOKEN_USED}" <<< "${OUT}"; then
  ok "token never in argv: the token value appears in no recorded curl argument and not in the output"
else bad "token never in argv: the token appeared in curl argv or output"; fi
if grep -qF -- '--config' "${STUB_CURL_ARGV}" \
  && [ "$(grep -cF -- "Authorization: Bearer ${TOKEN_USED}" "${STUB_CURL_CONFIG}" || true)" = "${POSTS}" ]; then
  ok "token via config: every call was given a --config file carrying its Authorization header"
else bad "token via config: posts=${POSTS} config=$(cat "${STUB_CURL_CONFIG}" 2>/dev/null)"; fi
if grep -qxF -- 'Content-Type: application/json' "${STUB_CURL_ARGV}" \
  && grep -qxF -- 'http://stub.invalid/api/v1/sources' "${STUB_CURL_ARGV}" \
  && grep -qxF -- 'POST' "${STUB_CURL_ARGV}" && grep -qxF -- '-X' "${STUB_CURL_ARGV}"; then
  ok "behaviour intact: POST, the /sources URL and the Content-Type header are still curl arguments"
else bad "behaviour intact: argv=$(cat "${STUB_CURL_ARGV}" 2>/dev/null)"; fi
if [ "$(grep -cF -- '"teamId": "team_test"' "${STUB_CURL_LOG}" || true)" = "${POSTS}" ] \
  && grep -qF -- '"name": "triologue-api"' "${STUB_CURL_LOG}"; then
  ok "payload unchanged: every -d payload still carries the team id and the source names"
else bad "payload unchanged: payloads=$(cat "${STUB_CURL_LOG}" 2>/dev/null)"; fi

# --- 2. refused token characters: a clear error, curl never starts -------------
for hostile in 'has"quote' 'has\backslash' 'has"and\both'; do
  run_setup TELERITHM_AUTH_TOKEN="${hostile}"
  if [ "${RC}" -ne 0 ] && [ "${POSTS}" -eq 0 ] \
    && grep -q "must not contain a double quote or a backslash" <<< "${OUT}"; then
    ok "hostile token ${hostile}: refused with a clear error, curl never started"
  else bad "hostile token ${hostile}: rc=${RC} posts=${POSTS} out=${OUT}"; fi
done
run_setup TELERITHM_AUTH_TOKEN='eyJ-alg.9f3c-_payload'
if [ "${POSTS}" -ge 1 ] && ! grep -qF -- 'eyJ-alg.9f3c-_payload' "${STUB_CURL_ARGV}" \
  && { [ "${GNU_HEAD}" = n ] || [ "${RC}" -eq 0 ]; }; then
  ok "token with . - _ characters: accepted and still kept out of argv"
else bad "ordinary token: rc=${RC} posts=${POSTS} out=${OUT}"; fi

# --- 3. validation unchanged: an empty token still refuses (empty = unset) ----
# (an explicit -u after the assignments would not parse on BSD env, and the
# script's `${TELERITHM_AUTH_TOKEN:-}` makes an empty value the same input)
run_setup TELERITHM_AUTH_TOKEN=""
if [ "${RC}" -ne 0 ] && [ "${POSTS}" -eq 0 ] && grep -q "TELERITHM_AUTH_TOKEN not set" <<< "${OUT}"; then
  ok "empty token: still refused before curl starts"
else bad "empty token: rc=${RC} posts=${POSTS} out=${OUT}"; fi

# --- 4. refused create: the failure path still reports the status ---------------
run_setup STUB_HTTP=500
if [ "${RC}" -ne 0 ] && [ "${GNU_HEAD}" = y ] && grep -q "Failed to create source (HTTP 500)" <<< "${OUT}"; then
  ok "refused create (HTTP 500): error logged with the status, run exits non-zero"
elif [ "${RC}" -ne 0 ] && [ "${GNU_HEAD}" = n ]; then
  ok "refused create (HTTP 500): run exits non-zero (the logged status needs GNU head, BSD platform)"
else bad "refused create: rc=${RC} out=${OUT}"; fi

echo
echo "passed: ${PASS}, failed: ${FAIL}"
[ "${FAIL}" -eq 0 ]
