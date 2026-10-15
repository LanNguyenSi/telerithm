#!/usr/bin/env bash
# Validate the shipped log-sender configs with the same pinned images CI uses:
# Vector's config validator and Fluentd's dry run. Requires docker.
#
# Usage: scripts/validate-sender-configs.sh [VECTOR_TOML] [FLUENT_CONF]
# Defaults to deploy/vector/vector.toml and deploy/fluentd/fluent.conf.
# Override the pins with VECTOR_IMAGE / FLUENTD_IMAGE.
set -euo pipefail

# Same tag as deploy/docker-compose.logging.yml, pinned by digest.
VECTOR_IMAGE="${VECTOR_IMAGE:-timberio/vector:0.41.1-alpine@sha256:501e5403e19238c9073c116fb3cbb750a9201d0271b09dae88f044534803c670}"
# out_http (the @type http output used by deploy/fluentd/fluent.conf) is part
# of the core fluentd gem (1.17.1) in this image.
FLUENTD_IMAGE="${FLUENTD_IMAGE:-fluent/fluentd:v1.17-debian-1@sha256:d6114e87fb46d67fef988014cfeb9025df5d48984063dfde94c74cf4a1857440}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

abspath() {
  printf '%s/%s\n' "$(cd "$(dirname "$1")" && pwd)" "$(basename "$1")"
}

vector_config="$(abspath "${1:-$repo_root/deploy/vector/vector.toml}")"
fluentd_config="$(abspath "${2:-$repo_root/deploy/fluentd/fluent.conf}")"

[[ -f "$vector_config" ]] || { echo "not a file: $vector_config" >&2; exit 2; }
[[ -f "$fluentd_config" ]] || { echo "not a file: $fluentd_config" >&2; exit 2; }

# Both configs reference these env vars; health checks are skipped, so the
# values only have to exist.
telerithm_env=(
  -e TELERITHM_URL=http://localhost:4000
  -e TELERITHM_SOURCE_ID=src_validate
  -e TELERITHM_API_KEY=lf_validate
)

echo "== vector validate --skip-healthchecks $vector_config"
docker run --rm "${telerithm_env[@]}" \
  -v "$vector_config:/etc/vector/vector.toml:ro" \
  "$VECTOR_IMAGE" validate --skip-healthchecks /etc/vector/vector.toml

# fluentd substitutes an empty string for an unset #{ENV[...]} variable and
# --dry-run exits 0, so the dry run cannot catch a typo. Require every name the
# config references to be one the check passes to the container. See
# scripts/README.md for the decision.
env_ref_names=()
while IFS= read -r ref_name; do
  [[ -n "$ref_name" ]] && env_ref_names+=("$ref_name")
done < <(grep -oE "#\{ENV\[['\"][A-Za-z_][A-Za-z0-9_]*['\"]\]\}" "$fluentd_config" \
  | sed -E "s/#\{ENV\[['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]\]\}/\1/")

provided_env=()
for env_arg in "${telerithm_env[@]}"; do
  [[ "$env_arg" == "-e" ]] || provided_env+=("${env_arg%%=*}")
done

missing_env=()
for env_ref in ${env_ref_names[@]+"${env_ref_names[@]}"}; do
  printf '%s\n' "${provided_env[@]}" | grep -qxF "$env_ref" \
    || missing_env+=("$env_ref")
done
if [[ ${#missing_env[@]} -gt 0 ]]; then
  {
    echo "fluentd config references #{ENV[...]} variables the check does not set (fluentd would substitute an empty string):"
    printf '  %s\n' "${missing_env[@]}"
  } >&2
  exit 1
fi

echo "== fluentd --dry-run -c $fluentd_config"
# Capture stdout and stderr together while still printing them, and keep the
# dry run's own exit code (a pipe to tee would hide it behind tee's status).
fluentd_status=0
fluentd_out="$(docker run --rm "${telerithm_env[@]}" \
  -v "$fluentd_config:/fluentd/etc/fluent.conf:ro" \
  "$FLUENTD_IMAGE" fluentd --dry-run -c /fluentd/etc/fluent.conf 2>&1)" ||
  fluentd_status=$?
printf '%s\n' "$fluentd_out"
if [[ $fluentd_status -ne 0 ]]; then
  echo "fluentd --dry-run failed (exit $fluentd_status): $fluentd_config" >&2
  exit "$fluentd_status"
fi

# An unknown parameter or section is accepted with a warning and exit 0; treat
# fluentd's warning as an error. Match the warning's header line, in either of
# its two forms ([warn]: parameter '<name>' in <section>, and
# [warn]: section <name> is not used in <parent>) instead of a bare
# "is not used": the header names what is unused and where, so the summary is
# correct for a section of any length, and a config VALUE that merely contains
# the words "is not used" (fluentd echoes the whole config) does not fail it.
if unused="$(printf '%s\n' "$fluentd_out" \
    | grep -E "\[warn\]: (parameter '[^']+' in <|section <[^>]+> is not used in <)")"; then
  {
    echo "fluentd config has an unused parameter or section (the dry run warned 'is not used'):"
    printf '%s\n' "$unused"
  } >&2
  exit 1
fi

echo "sender configs OK"
