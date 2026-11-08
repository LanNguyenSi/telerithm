#!/usr/bin/env bash
# Guard for every scripts/*.test.sh: a test script that cannot create its
# scratch directory must stop without touching the directory it was started
# from. With an empty mktemp result, `cd ""` stays in the current directory
# under bash 3.2 and 5.2, and a cleanup trap that removes the scratch path then
# deletes that directory (the checkout, when the test runs from the repository
# root). Bash 5.3 made `cd ""` fail instead (exit 1, no move); a control below
# records which behaviour the running bash has and prints a NOTE when the
# dynamic `cd ""` reproduction is not available on it (CI runs bash 5.2, where
# it is live; the static rule R2 catches the pattern on any bash).
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
# Two static rules run over every scripts/*.test.sh (this file included) and
# report the offending file:line:
#   R1: no mktemp template (the first quoted string after `mktemp` on a
#       non-comment line) may start with a literal /tmp. A template must
#       honour TMPDIR, written as the current tests write it, so that this
#       guard can force its failure with an unusable TMPDIR.
#   R2: an assignment that captures a template-form mktemp result must check
#       it right there: `|| exit` or `|| return` on the statement (its backslash
#       continuations included), or an explicit test on the quoted variable
#       ([ -d ... ], [ ! -d ... ], [ -z ... ]) within the three lines that
#       follow. A bare, template-less mktemp is outside R2: it honours no
#       TMPDIR on macOS, so the guard cannot force it to fail from the
#       environment; one test uses it; its empty result removes nothing
#       (`rm -rf ''` deletes no directory) and its failure path is covered
#       dynamically by the canary run.
# Two static controls (files made in the guard's scratch directory) prove the
# rules still fire.
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
# this guard runs it; run the guard in CI or a disposable container. A script
# that calls setsid (or otherwise moves itself to another process group)
# escapes the run's group, so the timeout kill cannot reach it; that cannot be
# closed from a shell script without a sandbox and stays a documented limit.
# On bash >= 5.3 `cd ""` fails, so the dynamic reproduction of the
# cd-on-empty-string pattern cannot trigger there; the guard records the
# behaviour and prints a NOTE instead of failing, and R2 above remains the
# check that catches the pattern on every bash.
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

# static_check <file>: print one line per rule violation (R1/R2, see the
# header), prefixed "R1 <file>:<line>: ..." or "R2 <file>:<line>: ...".
# Comment-only lines are not code and are skipped. A template is the quoted
# string that opens after `mktemp` (two quotes, non-empty body between them);
# bare template-less mktemp is out of R2's scope (see the header).
static_check() {
  awk -v fname="$1" '
    BEGIN { LITTMP = "/tm" "p" }
    /^[ \t]*#/ { next }
    { line[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        l = line[i]
        mp = index(l, "mktemp")
        if (mp == 0) { continue }
        rest = substr(l, mp + 6)
        q1 = index(rest, "\"")
        q2 = index(rest, "'"'"'")
        q = 0
        qc = ""
        if (q1 > 0 && (q2 == 0 || q1 < q2)) { q = q1; qc = "\"" } else if (q2 > 0) { q = q2; qc = "'"'"'" }
        body = ""
        if (q > 0) {
          after = substr(rest, q + 1)
          e = index(after, qc)
          if (e > 1) { body = substr(after, 1, e - 1) }
        }
        if (body != "") {
          if (substr(body, 1, 5) == "/tmp/" || body == "/tmp") {
            print "R1 " fname ":" i ": mktemp template starts with a literal " LITTMP " (it must honour TMPDIR)"
          }
        }
      }
      for (i = 1; i <= NR; i++) {
        if (line[i] !~ /^[ \t]*[A-Za-z_][A-Za-z_0-9]*=.*\$\([ \t]*mktemp/) { continue }
        l = line[i]
        mp = index(l, "mktemp")
        rest = substr(l, mp + 6)
        q1 = index(rest, "\"")
        q2 = index(rest, "'"'"'")
        q = 0
        qc = ""
        if (q1 > 0 && (q2 == 0 || q1 < q2)) { q = q1; qc = "\"" } else if (q2 > 0) { q = q2; qc = "'"'"'" }
        has_template = 0
        if (q > 0) {
          after = substr(rest, q + 1)
          if (index(after, qc) > 1) { has_template = 1 }
        }
        if (!has_template) { continue }
        stmt = l
        j = i
        while (stmt ~ /\\[ \t]*$/ && j < NR) {
          sub(/\\[ \t]*$/, "", stmt)
          j++
          stmt = stmt " " line[j]
        }
        if (match(stmt, "[|][|]") && (stmt ~ /exit/ || stmt ~ /return/)) { continue }
        var = stmt
        sub(/=.*/, "", var)
        sub(/^[ \t]+/, "", var)
        checked = 0
        for (k = j + 1; k <= j + 3 && k <= NR; k++) {
          has_test = line[k] ~ /\[ (! )?-(d|z|n|f) /
          has_var = (index(line[k], "\"" "$" var "\"") > 0) || (index(line[k], "\"${" var "}") > 0)
          if (has_test && has_var) { checked = 1; break }
        }
        if (!checked) {
          print "R2 " fname ":" i ": mktemp result assigned without a check (|| exit / || return / [ -d ... ] right after)"
        }
      }
    }
  ' "$1"
}

# --- static rules over every scripts/*.test.sh ---------------------------------
R1_HITS=0
R2_HITS=0
for script in "${SCRIPTS_DIR}"/*.test.sh; do
  [ -f "${script}" ] || continue
  viol="$(static_check "${script}")"
  [ -n "${viol}" ] || continue
  while IFS= read -r v; do
    [ -n "${v}" ] || continue
    case "${v}" in
      R1\ *) R1_HITS=$((R1_HITS + 1)) ;;
      R2\ *) R2_HITS=$((R2_HITS + 1)) ;;
    esac
    bad "static ${v}"
  done <<< "${viol}"
done
if [ "${R1_HITS}" -eq 0 ]; then
  ok "static R1: no scripts/*.test.sh mktemp template starts with a literal /tmp"
fi
if [ "${R2_HITS}" -eq 0 ]; then
  ok "static R2: every template-form mktemp assignment in scripts/*.test.sh is checked right after"
fi

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

# --- static controls: each static rule must actually fire ------------------------
# Written so this file cannot trip its own rules: the /tmp template and the
# ${TMPDIR...} template are assembled from variables, and the printf lines carry
# no assignment of $(mktemp.
R1_TEMPLATE="/tm""p/telerithm-static-r1.XXXXXX"
R2_TEMPLATE="\${TMPDIR:-/tm}""p/telerithm-static-r2.XXXXXX"
printf '%s\n' '#!/usr/bin/env bash' \
  "work=\"\$(mktemp -d \"${R1_TEMPLATE}\")\" || exit 1" \
  'exit 0' > "${CONTROLS}/static-r1.sh"
printf '%s\n' '#!/usr/bin/env bash' \
  "work=\"\$(mktemp -d \"${R2_TEMPLATE}\")\"" \
  'exit 0' > "${CONTROLS}/static-r2.sh"
R1_PAT="^R1 ${CONTROLS}/static-r1.sh:[1-9]"
R2_PAT="^R2 ${CONTROLS}/static-r2.sh:[1-9]"
if static_check "${CONTROLS}/static-r1.sh" | grep -q "${R1_PAT}"; then
  ok "static control R1: a /tmp mktemp template is reported with the file:line"
else bad "static control R1: /tmp template not reported: $(static_check "${CONTROLS}/static-r1.sh")"; fi
if static_check "${CONTROLS}/static-r2.sh" | grep -q "${R2_PAT}"; then
  ok "static control R2: an unchecked mktemp assignment is reported with the file:line"
else bad "static control R2: unchecked assignment not reported: $(static_check "${CONTROLS}/static-r2.sh")"; fi
if ! static_check "${CONTROLS}/deletes-canary.sh" | grep -q '^R'; then
  ok "static control: the canary controls themselves trip neither rule (the rules do not flag everything)"
else bad "static control: canary control flagged: $(static_check "${CONTROLS}/deletes-canary.sh")"; fi

# --- control: which cd "" does each bash show -----------------------------------
# The dynamic canary check catches the `cd "$empty_scratch"` pattern only on a
# bash where `cd ""` succeeds and stays in place (bash 3.2 and 5.2; CI runs
# 5.2). Bash 5.3 made `cd ""` fail (exit 1, no move), so there even an
# unfixed test leaves its start directory alone and the dynamic check proves
# nothing about that pattern. Record the behaviour; never fail the run on it
# (static R2 covers the pattern on every bash).
for bash_bin in "${BASHES[@]}"; do
  bash_ver="$("${bash_bin}" -c 'echo "${BASH_VERSION}"' 2>/dev/null)" || bash_ver="unknown"
  if "${bash_bin}" -c 'cd ""' 2>/dev/null; then
    ok "control: ${bash_bin} ${bash_ver} accepts cd \"\" and stays in place (the dynamic reproduction is live for it)"
  else
    ok "control: ${bash_bin} ${bash_ver} rejects cd \"\" (bash >= 5.3 behaviour)"
    echo "NOTE: ${bash_bin} ${bash_ver} fails \`cd \"\"\` (bash 5.3 behaviour): the dynamic \`cd \"\"\` reproduction is not available on this bash, so the canary runs for it prove nothing about that pattern. CI runs bash 5.2, where the reproduction is live."
  fi
done

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
