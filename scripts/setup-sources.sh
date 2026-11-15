#!/bin/bash
# Setup Log Sources in Telerithm
# Creates a log source for each Docker container to monitor

set -euo pipefail

# Configuration
TELERITHM_API="${TELERITHM_API:-http://localhost:4000/api/v1}"
AUTH_TOKEN="${TELERITHM_AUTH_TOKEN:-}"
TEAM_ID="${TELERITHM_TEAM_ID:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_success() {
  echo -e "${BLUE}[SUCCESS]${NC} $1"
}

# Validate environment
if [ -z "$AUTH_TOKEN" ]; then
  log_error "TELERITHM_AUTH_TOKEN not set. Please login first."
  log_info "1. POST your email and password as JSON to <backend>/api/v1/auth/login"
  log_info "   (the web UI keeps its session in an httpOnly cookie, not in Local Storage)"
  log_info "2. Copy the 'token' field from the response"
  log_info "3. export TELERITHM_AUTH_TOKEN='<your-token>'"
  exit 1
fi

if [ -z "$TEAM_ID" ]; then
  log_error "TELERITHM_TEAM_ID not set. Please set your team ID."
  log_info "Example: export TELERITHM_TEAM_ID='team_abc123'"
  exit 1
fi

# True only for a non-empty string made of A-Z a-z 0-9 . _ ~ + / = -
# (bash's =~ anchors to the whole string, so a trailing newline fails). A
# pure bash test in the C locale with no external helper: if the test itself
# errors, the caller refuses, so the check cannot fail open.
is_plain_secret() {
  local LC_ALL=C re='^[A-Za-z0-9._~+/=-]+$'
  [[ $1 =~ $re ]]
}

# The token reaches curl through a config on a file descriptor (see
# create_source). curl's config syntax is line based and quotes strings with "
# and escapes with \, so a token holding a newline, a quote, a backslash or any
# other character outside a plain token alphabet could end the quoted value and
# make curl parse what follows as further options (a second url, a write-out,
# a file:// read). The token is therefore checked against an allow-list, not a
# deny-list: only A-Z a-z 0-9 and . _ ~ + / = - pass (session tokens are sess_
# plus 24 hex characters; the rest is headroom for base64), anything else, an
# empty token included, is refused with an error that does not print the token.
if ! is_plain_secret "$AUTH_TOKEN"; then
  log_error "TELERITHM_AUTH_TOKEN may only contain letters, digits and . _ ~ + / = - (refused, value not shown)."
  exit 1
fi

# Create a log source
create_source() {
  local name="$1"
  # createSourceSchema accepts the uppercase SourceType values only
  local type="${2:-HTTP}"
  
  log_info "Creating source: $name (type: $type)"
  
  payload=$(cat <<EOF
{
  "teamId": "$TEAM_ID",
  "name": "$name",
  "type": "$type"
}
EOF
)
  
  # The session token is kept out of curl's argv: a local process reads any
  # command line through ps or /proc/<pid>/cmdline, so a Bearer token passed
  # as a -H argument is world-readable on the machine for the whole request.
  # It goes to curl through --config on a file descriptor instead: bash's
  # process substitution hands curl a /dev/fd/N pipe, no file is written to
  # disk, and the printf that builds the config line is a bash builtin, so
  # the token never enters any process's argv. Only tokens made of the
  # allow-listed characters get here (see the validation above), so the
  # config line needs no escaping.
  response=$(curl -s -w "\n%{http_code}" -X POST "${TELERITHM_API}/sources" \
    --config <(printf 'header = "Authorization: Bearer %s"\n' "$AUTH_TOKEN") \
    -H "Content-Type: application/json" \
    -d "$payload")
  
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)
  
  if [ "$http_code" -eq 201 ] || [ "$http_code" -eq 200 ]; then
    # POST /sources answers { "source": { "id": ..., "apiKey": ... } }
    source_id=$(echo "$body" | jq -r '.source.id')
    api_key=$(echo "$body" | jq -r '.source.apiKey')
    
    log_success "Created source: $name"
    echo -e "  ${BLUE}Source ID:${NC} $source_id"
    echo -e "  ${BLUE}API Key:${NC} $api_key"
    echo ""
    
    # Export for convenience
    export "TELERITHM_SOURCE_ID_${name//-/_}"="$source_id"
    export "TELERITHM_API_KEY_${name//-/_}"="$api_key"
    
    return 0
  else
    log_error "Failed to create source (HTTP $http_code): $body"
    return 1
  fi
}

# Main
main() {
  log_info "Setting up Telerithm log sources"
  log_info "API: $TELERITHM_API"
  log_info "Team ID: $TEAM_ID"
  echo ""
  
  # Check dependencies
  if ! command -v jq &> /dev/null; then
    log_error "jq command not found. Please install jq (sudo apt install jq)"
    exit 1
  fi
  
  if ! command -v curl &> /dev/null; then
    log_error "curl command not found. Please install curl."
    exit 1
  fi
  
  # Create sources for common containers
  log_info "Creating log sources for Docker containers..."
  echo ""
  
  create_source "triologue-api" "HTTP"
  create_source "triologue-frontend" "HTTP"
  create_source "event-booking-app" "HTTP"
  create_source "traefik" "HTTP"
  create_source "health-dashboard" "HTTP"
  create_source "telerithm-backend" "HTTP"
  create_source "telerithm-frontend" "HTTP"
  
  echo ""
  log_success "All sources created!"
  echo ""
  log_info "Next steps:"
  echo "  1. Copy the API keys above"
  echo "  2. Set environment variables for log collection:"
  echo ""
  echo "     export TELERITHM_SOURCE_ID='<source-id-for-main-collection>'"
  echo "     export TELERITHM_API_KEY='<api-key>'"
  echo "     export TELERITHM_CONTAINERS='triologue-api triologue-frontend traefik'"
  echo ""
  echo "  3. Run the log collector:"
  echo "     ./scripts/collect-docker-logs.sh"
  echo ""
  echo "  4. Or set up as a cron job: put the line below in /etc/cron.d/telerithm-collector"
  echo "     (the 'root' user field is part of the /etc/cron.d format; a user crontab"
  echo "     has no such field). Every minute; flock keeps runs from overlapping:"
  echo "     * * * * * root flock -n /var/lock/telerithm-collector.lock /path/to/collect-docker-logs.sh >> /var/log/telerithm-collector.log 2>&1"
  echo ""
}

# Run
main
