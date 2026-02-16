#!/usr/bin/env bash
# Populate App Config Service with environment variables for the Intercom Manager.
# Uses the REST API: POST /api/v1/config with JSON body.
# Environment variables expected: CONFIG_URL, SMB_ADDRESS, SMB_APIKEY, DB_CONN, JWT_SECRET, PORT

set -e

CONFIG_API="${CONFIG_URL}/api/v1/config"

echo "Populating config at ${CONFIG_URL}..."

# Wait for config service to be reachable
for i in {1..30}; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "${CONFIG_URL}" 2>/dev/null || echo "000")
  if [ "$status" != "000" ] && [ "$status" != "502" ] && [ "$status" != "503" ]; then
    echo "Config service is reachable (status $status)"
    break
  fi
  echo "Waiting for config service... ($i/30)"
  sleep 5
done

# Set each config value
set_config() {
  local key="$1"
  local value="$2"

  response=$(curl -s -w "\n%{http_code}" -X POST "${CONFIG_API}" \
    -H "Content-Type: application/json" \
    -d "{\"key\": \"${key}\", \"value\": \"${value}\"}")

  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -1)

  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    echo "  Set ${key}"
  else
    echo "  Failed to set ${key} (HTTP ${http_code}): ${body}" >&2
    # Don't exit - try the rest
  fi
}

set_config "SMB_ADDRESS" "${SMB_ADDRESS}"
set_config "SMB_APIKEY" "${SMB_APIKEY}"
set_config "DB_CONNECTION_STRING" "${DB_CONN}"
set_config "JWT_SECRET" "${JWT_SECRET}"
set_config "PORT" "${PORT}"

echo "Config population complete."
