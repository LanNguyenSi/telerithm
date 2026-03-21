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
  log_info "1. Login via UI: http://localhost:3000"
  log_info "2. Open browser DevTools → Application → Local Storage"
  log_info "3. Copy 'token' value"
  log_info "4. export TELERITHM_AUTH_TOKEN='<your-token>'"
  exit 1
fi

if [ -z "$TEAM_ID" ]; then
  log_error "TELERITHM_TEAM_ID not set. Please set your team ID."
  log_info "Example: export TELERITHM_TEAM_ID='team_abc123'"
  exit 1
fi

# Create a log source
create_source() {
  local name="$1"
  local type="${2:-http}"
  
  log_info "Creating source: $name (type: $type)"
  
  payload=$(cat <<EOF
{
  "teamId": "$TEAM_ID",
  "name": "$name",
  "type": "$type"
}
EOF
)
  
  response=$(curl -s -w "\n%{http_code}" -X POST "${TELERITHM_API}/sources" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload")
  
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)
  
  if [ "$http_code" -eq 201 ] || [ "$http_code" -eq 200 ]; then
    source_id=$(echo "$body" | jq -r '.id')
    api_key=$(echo "$body" | jq -r '.apiKey')
    
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
  
  create_source "triologue-api" "http"
  create_source "triologue-frontend" "http"
  create_source "event-booking-app" "http"
  create_source "traefik" "http"
  create_source "health-dashboard" "http"
  create_source "telerithm-backend" "http"
  create_source "telerithm-frontend" "http"
  
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
  echo "  4. Or set up as a cron job (every minute):"
  echo "     * * * * * /path/to/collect-docker-logs.sh >> /var/log/telerithm-collector.log 2>&1"
  echo ""
}

# Run
main
