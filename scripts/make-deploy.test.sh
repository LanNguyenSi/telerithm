#!/usr/bin/env bash
# Tests for the deploy targets in the Makefile: they must refuse to run when a
# tracked file has local changes and must never stash or discard anything.
# Runs in a scratch git repository with a stub `docker` and a `git` wrapper that
# forwards everything to the real git except `pull`, which it only records, so
# no network, Docker daemon or real checkout is touched.
#
# Usage: bash scripts/make-deploy.test.sh
#
# HOME points into the scratch directory for the whole run; the test aborts if it
# cannot establish that.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAKEFILE="${SCRIPT_DIR}/../Makefile"
REAL_GIT="$(command -v git)"

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/telerithm-deploy-test.XXXXXX")"
trap 'rm -rf "${SCRATCH}"' EXIT

export HOME="${SCRATCH}/home"
mkdir -p "${HOME}"
case "${HOME}" in
  "${SCRATCH}"/*) ;;
  *) echo "FATAL: HOME is not inside the scratch directory" >&2; exit 2 ;;
esac
unset CLAUDE_CONFIG_DIR CODEX_HOME GIT_DIR GIT_WORK_TREE
export GIT_CONFIG_GLOBAL="${HOME}/.gitconfig"
export GIT_CONFIG_NOSYSTEM=1

STUB_DIR="${SCRATCH}/stubbin"
mkdir -p "${STUB_DIR}"
export CALL_LOG="${SCRATCH}/calls.log"
cat > "${STUB_DIR}/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "${CALL_LOG}"
STUB
cat > "${STUB_DIR}/git" <<STUB
#!/usr/bin/env bash
case "\${1:-}" in
  pull|stash) echo "git \$*" >> "\${CALL_LOG}"; exit 0 ;;
esac
exec "${REAL_GIT}" "\$@"
STUB
chmod +x "${STUB_DIR}/docker" "${STUB_DIR}/git"
export PATH="${STUB_DIR}:${PATH}"

REPO="${SCRATCH}/repo"
mkdir -p "${REPO}"
cp "${MAKEFILE}" "${REPO}/Makefile"
echo "services: {}" > "${REPO}/docker-compose.traefik.yml"
echo "POSTGRES_PASSWORD=dummy" > "${REPO}/.env.production"
(
  cd "${REPO}" || exit 1
  git init -q
  git config user.email t@example.com
  git config user.name t
  git add Makefile docker-compose.traefik.yml
  git commit -q -m init
)

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

run_make() {
  : > "${CALL_LOG}"
  OUT="$(cd "${REPO}" && make "$@" 2>&1)"
  RC=$?
}

reset_repo() {
  (cd "${REPO}" && git checkout -q -- . && git reset -q --hard && git clean -qfd -e .env.production)
}

for target in deploy deploy-backend deploy-frontend; do
  # clean tree: the deploy goes ahead (pull, then build and up)
  reset_repo
  run_make "${target}"
  if [ "${RC}" -eq 0 ] && grep -q "^git pull" "${CALL_LOG}" && grep -q "^docker compose .* up -d" "${CALL_LOG}"; then
    ok "${target}: clean tree deploys (pull, build, up)"
  else bad "${target}: clean tree rc=${RC} calls=$(cat "${CALL_LOG}") out=${OUT}"; fi

  # untracked files (such as .env.production, or a stray file) do not block
  reset_repo
  echo stray > "${REPO}/stray.txt"
  run_make "${target}"
  if [ "${RC}" -eq 0 ]; then ok "${target}: untracked file does not block"; else bad "${target}: untracked blocked: ${OUT}"; fi
  rm -f "${REPO}/stray.txt"

  # unstaged edit to a tracked file: refused, edit intact, no pull/build/stash
  reset_repo
  echo "# local domain edit" >> "${REPO}/docker-compose.traefik.yml"
  run_make "${target}"
  if [ "${RC}" -ne 0 ] \
    && grep -q "refusing to deploy" <<< "${OUT}" \
    && grep -q "docker-compose.traefik.yml" <<< "${OUT}" \
    && grep -q "local domain edit" "${REPO}/docker-compose.traefik.yml" \
    && [ ! -s "${CALL_LOG}" ]; then
    ok "${target}: unstaged edit refused, file intact, no pull/build/stash"
  else bad "${target}: unstaged edit rc=${RC} calls=$(cat "${CALL_LOG}") out=${OUT}"; fi

  # staged edit: refused as well
  reset_repo
  echo "# staged edit" >> "${REPO}/docker-compose.traefik.yml"
  (cd "${REPO}" && git add docker-compose.traefik.yml)
  run_make "${target}"
  if [ "${RC}" -ne 0 ] && grep -q "refusing to deploy" <<< "${OUT}" && [ ! -s "${CALL_LOG}" ]; then
    ok "${target}: staged edit refused"
  else bad "${target}: staged edit rc=${RC} calls=$(cat "${CALL_LOG}")"; fi
done

# outside a git work tree the status is unreadable: refused, not waved through
NOREPO="${SCRATCH}/norepo"
mkdir -p "${NOREPO}"
cp "${MAKEFILE}" "${NOREPO}/Makefile"
: > "${CALL_LOG}"
OUT="$(cd "${NOREPO}" && GIT_CEILING_DIRECTORIES="${SCRATCH}" make deploy 2>&1)"
RC=$?
if [ "${RC}" -ne 0 ] && grep -q "cannot read the git status" <<< "${OUT}" && [ ! -s "${CALL_LOG}" ]; then
  ok "deploy: unreadable git status is refused"
else bad "deploy: no repo rc=${RC} out=${OUT}"; fi

# the Makefile must not stash at all
if ! grep -n "git stash" "${MAKEFILE}" | grep -v '^[0-9]*:#' | grep -q .; then
  ok "Makefile: no git stash command remains"
else bad "Makefile still contains git stash"; fi

echo
echo "passed: ${PASS}, failed: ${FAIL}"
[ "${FAIL}" -eq 0 ]
