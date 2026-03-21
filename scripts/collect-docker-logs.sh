#!/bin/bash
# Docker Log Collector for Telerithm
# Collects logs from specified Docker containers and sends to Telerithm ingest API

set -euo pipefail

# Configuration
TELERITHM_API="${TELERITHM_API:-http://localhost:4000/api/v1}"
SOURCE_ID="${TELERITHM_SOURCE_ID:-}"
API_KEY="${TELERITHM_API_KEY:-}"
CONTAINERS="${TELERITHM_CONTAINERS:-}"
TAIL_LINES="${TELERITHM_TAIL_LINES:-100}"
FOLLOW="${TELERITHM_FOLLOW:-false}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Validate environment variables
if [ -z "$SOURCE_ID" ]; then
  log_error "TELERITHM_SOURCE_ID not set. Please set it to the source ID from Telerithm."
  log_info "Example: export TELERITHM_SOURCE_ID=src_abc123"
  exit 1
fi

if [ -z "$API_KEY" ]; then
  log_error "TELERITHM_API_KEY not set. Please set it to your Telerithm API key."
  log_info "Example: export TELERITHM_API_KEY=lf_abc123..."
  exit 1
fi

if [ -z "$CONTAINERS" ]; then
  log_error "TELERITHM_CONTAINERS not set. Please specify containers to monitor."
  log_info "Example: export TELERITHM_CONTAINERS='triologue-api triologue-frontend traefik'"
  exit 1
fi

INGEST_URL="${TELERITHM_API}/ingest/${SOURCE_ID}"

# Parse log level from message (heuristic)
parse_level() {
  local msg="$1"
  local msg_lower=$(echo "$msg" | tr '[:upper:]' '[:lower:]')
  
  if [[ "$msg_lower" =~ (fatal|critical) ]]; then
    echo "fatal"
  elif [[ "$msg_lower" =~ error ]]; then
    echo "error"
  elif [[ "$msg_lower" =~ (warn|warning) ]]; then
    echo "warn"
  elif [[ "$msg_lower" =~ debug ]]; then
    echo "debug"
  else
    echo "info"
  fi
}

# Send log batch to Telerithm
send_logs() {
  local logs_json="$1"
  
  response=$(curl -s -w "\n%{http_code}" -X POST "$INGEST_URL" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$logs_json")
  
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)
  
  if [ "$http_code" -eq 201 ]; then
    log_info "Sent batch successfully"
    return 0
  else
    log_error "Failed to send logs (HTTP $http_code): $body"
    return 1
  fi
}

# Process logs from a container
process_container_logs() {
  local container="$1"
  local batch_size=50
  local logs_array="[]"
  local count=0
  
  log_info "Collecting logs from: $container"
  
  # Check if container exists and is running
  if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    log_warn "Container '$container' not found or not running. Skipping."
    return 0
  fi
  
  # Build docker logs command
  local docker_cmd="docker logs --timestamps"
  if [ "$FOLLOW" = "true" ]; then
    docker_cmd="$docker_cmd --follow"
  else
    docker_cmd="$docker_cmd --tail $TAIL_LINES"
  fi
  docker_cmd="$docker_cmd $container 2>&1"
  
  # Process logs line by line
  eval "$docker_cmd" | while IFS= read -r line; do
    # Parse timestamp (Docker format: 2026-03-21T07:30:00.123456789Z)
    if [[ "$line" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+Z)\ (.*)$ ]]; then
      timestamp="${BASH_REMATCH[1]}"
      message="${BASH_REMATCH[2]}"
    else
      # No timestamp, use current time
      timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
      message="$line"
    fi
    
    # Parse log level
    level=$(parse_level "$message")
    
    # Escape JSON
    message_escaped=$(echo "$message" | jq -Rs .)
    
    # Add to batch
    log_entry=$(cat <<EOF
{
  "timestamp": "$timestamp",
  "level": "$level",
  "service": "$container",
  "message": $message_escaped
}
EOF
)
    
    logs_array=$(echo "$logs_array" | jq ". += [$log_entry]")
    count=$((count + 1))
    
    # Send batch when size reached
    if [ $count -ge $batch_size ]; then
      payload=$(jq -n --argjson logs "$logs_array" '{logs: $logs}')
      if send_logs "$payload"; then
        log_info "Sent $count logs from $container"
      fi
      logs_array="[]"
      count=0
    fi
  done
  
  # Send remaining logs
  if [ $count -gt 0 ]; then
    payload=$(jq -n --argjson logs "$logs_array" '{logs: $logs}')
    if send_logs "$payload"; then
      log_info "Sent final $count logs from $container"
    fi
  fi
}

# Main
main() {
  log_info "Starting Docker log collection"
  log_info "API: $TELERITHM_API"
  log_info "Source ID: $SOURCE_ID"
  log_info "Containers: $CONTAINERS"
  log_info "Follow mode: $FOLLOW"
  
  # Check dependencies
  if ! command -v docker &> /dev/null; then
    log_error "docker command not found. Please install Docker."
    exit 1
  fi
  
  if ! command -v jq &> /dev/null; then
    log_error "jq command not found. Please install jq (sudo apt install jq)"
    exit 1
  fi
  
  if ! command -v curl &> /dev/null; then
    log_error "curl command not found. Please install curl."
    exit 1
  fi
  
  # Process each container
  for container in $CONTAINERS; do
    process_container_logs "$container"
  done
  
  log_info "Collection complete"
}

# Run
main
