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

echo "== fluentd --dry-run -c $fluentd_config"
docker run --rm "${telerithm_env[@]}" \
  -v "$fluentd_config:/fluentd/etc/fluent.conf:ro" \
  "$FLUENTD_IMAGE" fluentd --dry-run -c /fluentd/etc/fluent.conf

echo "sender configs OK"
