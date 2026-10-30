#!/usr/bin/env bash
# Guard for every scripts/*.test.sh: a test script that cannot create its
# scratch directory must stop without touching the directory it was started
# from. With an empty mktemp result, `cd ""` stays in the current directory
# under bash 3.2 and 5.2, and a cleanup trap that removes the scratch path then
# deletes that directory (the checkout, when the test runs from the repository
# root).
#
# Each scripts/*.test.sh (found by glob, this file excluded) is started from a
# fresh directory holding one canary file, with TMPDIR set to a path that does
# not exist, so its mktemp fails. Afterwards that directory must hold exactly
# the canary, unchanged: nothing deleted, nothing written. The exit code is
# reported but not checked (a test that needs no scratch directory may pass).
# Every script runs once per bash found (bash on PATH, and /bin/bash when it is
# another version), because `cd ""` differs between versions. Each run has its
# own process group and a time limit (SCRATCH_SAFETY_TIMEOUT seconds, default
# 60); a run over the limit has its whole group killed and fails.
#
# Four controls run first: a script that deletes the canary and one that writes
# a file when mktemp fails must be caught (so a TMPDIR that does not make
# mktemp fail, or a blind check, cannot pass unnoticed); one that never ends and
# ignores SIGTERM must be stopped at the limit with its whole group; and a
# child that a script leaves running must be killed with the group.
#
# Limits: each script's failure path runs for real, outside any sandbox, and
# only the start directory is checked. A script whose cleanup can reach other
# paths (for example `rm -rf "$W"/*` with an unchecked W) must be fixed before
# this guard runs it; run the guard in CI or a disposable container.
#
# Usage: bash scripts/test-scratch-safety.test.sh

set -uo pipefail

SCRIPTS_DIR="$(CDPATH='' cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" \
  || { echo "FATAL: cannot resolve the scripts directory" >&2; exit 2; }
SELF="${BASH_SOURCE[0]##*/}"
LIMIT="${SCRATCH_SAFETY_TIMEOUT:-60}"
case "${LIMIT}" in
  '' | *[!0-9]* | 0*) echo "FATAL: SCRATCH_SAFETY_TIMEOUT must be a whole number of seconds above 0" >&2; exit 2 ;;
esac

GUARD="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-scratch-safety-test.XXXXXX")" \
  || { echo "FATAL: mktemp failed" >&2; exit 2; }
if [ -z "${GUARD}" ] || [ ! -d "${GUARD}" ]; then
  echo "FATAL: mktemp did not create a directory: '${GUARD}'" >&2
  exit 2
fi
GUARD="$(CDPATH='' cd -- "${GUARD}" && pwd -P)" \
  || { echo "FATAL: cannot resolve the scratch directory" >&2; exit 2; }
# CURRENT_GROUP: process group of the run in progress, killed if this script
# ends early (Ctrl-C, SIGTERM) so no run outlives it.
CURRENT_GROUP=""
on_exit() {
  if [ -n "${CURRENT_GROUP}" ]; then kill -KILL -- "-${CURRENT_GROUP}" 2>/dev/null || true; fi
  case "${GUARD}" in /*) ;; *) return 0 ;; esac
  case "${GUARD##*/}" in telerithm-scratch-safety-test.?*) ;; *) return 0 ;; esac
  # a killed run can leave read-only directories (backup.test.sh makes some)
  chmod -R u+rwx "${GUARD}" 2>/dev/null || true
  rm -rf "${GUARD}"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

MISSING_TMPDIR="${GUARD}/missing/tmp"
RUN_HOME="${GUARD}/home"
mkdir -p "${RUN_HOME}" || exit 2

# Every distinct bash: the one on PATH first, then /bin/bash when its version differs.
BASHES=()
SEEN_VERSIONS=" "
for candidate in "$(command -v bash 2>/dev/null)" /bin/bash; do
  [ -n "${candidate}" ] && [ -x "${candidate}" ] || continue
  version="$("${candidate}" -c 'echo "${BASH_VERSION}"' 2>/dev/null)" || continue
  case "${SEEN_VERSIONS}" in *" ${version} "*) continue ;; esac
  SEEN_VERSIONS="${SEEN_VERSIONS}${version} "
  BASHES+=("${candidate}")
done
if [ "${#BASHES[@]}" -eq 0 ]; then
  echo "FATAL: no bash found" >&2
  exit 2
fi

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

# run_from_canary <bash> <script> <limit>: starts the script from a fresh
# directory holding only a canary file, with TMPDIR missing and HOME inside the
# guard's scratch directory, in its own process group. Sets RUN_RC (the exit
# code; 124 after a timeout), RUN_OUT (file with the output), GROUP_LEFT (1 when
# a process of the group survived the kill) and VERDICT (empty when the
# directory holds exactly the unchanged canary, else what happened to it).
RUN_N=0
run_from_canary() {
  local bash_bin="$1" script="$2" limit="$3" cwd pid ticks timed_out listing
  RUN_N=$((RUN_N + 1))
  cwd="${GUARD}/run${RUN_N}"
  RUN_OUT="${GUARD}/run${RUN_N}.out"
  RUN_RC=""
  GROUP_LEFT=0
  if ! mkdir "${cwd}" || ! echo canary > "${cwd}/canary"; then
    VERDICT="could not create the start directory ${cwd}"
    return
  fi
  # set -m only for this one background job: it gets a process group of its
  # own (group id = its pid), so a timeout can kill everything it started.
  set -m
  ( cd "${cwd}" && HOME="${RUN_HOME}" TMPDIR="${MISSING_TMPDIR}" exec "${bash_bin}" "${script}" ) \
    > "${RUN_OUT}" 2>&1 < /dev/null &
  pid=$!
  set +m
  CURRENT_GROUP="${pid}"
  ticks=0
  timed_out=0
  while kill -0 "${pid}" 2>/dev/null; do
    if [ "${ticks}" -ge $((limit * 10)) ]; then
      timed_out=1
      kill -TERM -- "-${pid}" 2>/dev/null || true
      sleep 1
      kill -KILL -- "-${pid}" 2>/dev/null || true
      break
    fi
    sleep 0.1
    ticks=$((ticks + 1))
  done
  RUN_RC=0
  { wait "${pid}"; } 2>/dev/null || RUN_RC=$?
  if [ "${timed_out}" -eq 1 ]; then RUN_RC=124; fi
  # anything the script left running in its group goes too
  kill -KILL -- "-${pid}" 2>/dev/null || true
  ticks=0
  while kill -0 -- "-${pid}" 2>/dev/null; do
    if [ "${ticks}" -ge 20 ]; then GROUP_LEFT=1; break; fi
    sleep 0.1
    ticks=$((ticks + 1))
  done
  CURRENT_GROUP=""
  listing="$(find "${cwd}" -mindepth 1 2>/dev/null)" || listing=""
  if [ "${timed_out}" -eq 1 ]; then
    VERDICT="did not finish within ${limit}s; its process group was killed"
  elif [ ! -d "${cwd}" ]; then
    VERDICT="deleted the directory it was started from"
  elif [ ! -f "${cwd}/canary" ]; then
    VERDICT="deleted the canary file in the directory it was started from"
  elif [ "${listing}" != "${cwd}/canary" ]; then
    VERDICT="wrote into the directory it was started from: $(printf '%s' "${listing}" | tr '\n' ' ')"
  elif [ "$(cat "${cwd}/canary")" != canary ]; then
    VERDICT="changed the canary file in the directory it was started from"
  else
    VERDICT=""
  fi
}

show_output() { sed 's/^/       | /' "${RUN_OUT}" 2>/dev/null | tail -n 20 || true; }

# --- controls -------------------------------------------------------------------
CONTROLS="${GUARD}/controls"
mkdir -p "${CONTROLS}" || exit 2
cat > "${CONTROLS}/deletes-canary.sh" <<'CONTROL'
mktemp -d "${TMPDIR:-/tmp}/telerithm-control-test.XXXXXX" > /dev/null 2>&1 || rm -f canary
CONTROL
cat > "${CONTROLS}/writes-file.sh" <<'CONTROL'
mktemp -d "${TMPDIR:-/tmp}/telerithm-control-test.XXXXXX" > /dev/null 2>&1 || echo x > written
CONTROL
# "never ends" within the 1 s limit it gets; 20 s keeps a run that was not
# killed short, and the elapsed time shows it
cat > "${CONTROLS}/never-ends.sh" <<'CONTROL'
trap '' TERM
sleep 20 &
wait
CONTROL
cat > "${CONTROLS}/leaves-child.sh" <<'CONTROL'
sleep 20 > /dev/null 2>&1 &
exit 0
CONTROL

run_from_canary "${BASHES[0]}" "${CONTROLS}/deletes-canary.sh" "${LIMIT}"
case "${VERDICT}" in
  "deleted the canary"*) ok "control: a script that deletes the canary when mktemp fails is caught" ;;
  *) bad "control deletes-canary: verdict '${VERDICT}' (does TMPDIR=${MISSING_TMPDIR} still make mktemp fail?)"; show_output ;;
esac
run_from_canary "${BASHES[0]}" "${CONTROLS}/writes-file.sh" "${LIMIT}"
case "${VERDICT}" in
  "wrote into"*) ok "control: a script that writes into its start directory when mktemp fails is caught" ;;
  *) bad "control writes-file: verdict '${VERDICT}'"; show_output ;;
esac
STARTED="${SECONDS}"
run_from_canary "${BASHES[0]}" "${CONTROLS}/never-ends.sh" 1
ELAPSED=$((SECONDS - STARTED))
if [ "${RUN_RC}" = 124 ] && [ "${GROUP_LEFT}" -eq 0 ] && [ "${ELAPSED}" -le 6 ]; then
  case "${VERDICT}" in
    "did not finish"*) ok "control: a run that never ends and ignores SIGTERM is stopped, its whole group killed" ;;
    *) bad "control never-ends: verdict '${VERDICT}'" ;;
  esac
else bad "control never-ends: rc=${RUN_RC} group left=${GROUP_LEFT} elapsed=${ELAPSED}s verdict '${VERDICT}'"; fi
run_from_canary "${BASHES[0]}" "${CONTROLS}/leaves-child.sh" "${LIMIT}"
if [ "${RUN_RC}" = 0 ] && [ "${GROUP_LEFT}" -eq 0 ] && [ -z "${VERDICT}" ]; then
  ok "control: a child the script leaves running is killed with its group"
else bad "control leaves-child: rc=${RUN_RC} group left=${GROUP_LEFT} verdict '${VERDICT}'"; fi

# --- every scripts/*.test.sh ------------------------------------------------------
CHECKED=0
for script in "${SCRIPTS_DIR}"/*.test.sh; do
  [ -f "${script}" ] || continue
  name="${script##*/}"
  [ "${name}" = "${SELF}" ] && continue
  CHECKED=$((CHECKED + 1))
  for bash_bin in "${BASHES[@]}"; do
    run_from_canary "${bash_bin}" "${script}" "${LIMIT}"
    if [ -z "${VERDICT}" ] && [ "${GROUP_LEFT}" -eq 0 ]; then
      ok "${name} (${bash_bin}, exit ${RUN_RC}): start directory untouched"
    else
      bad "${name} (${bash_bin}, exit ${RUN_RC}): ${VERDICT:-a process of its group survived the kill}"
      show_output
    fi
  done
done
if [ "${CHECKED}" -eq 0 ]; then bad "no scripts/*.test.sh found in ${SCRIPTS_DIR}"; fi

echo
echo "scripts: ${CHECKED}, bash: ${BASHES[*]}"
echo "passed: ${PASS}, failed: ${FAIL}"
[ "${FAIL}" -eq 0 ]
