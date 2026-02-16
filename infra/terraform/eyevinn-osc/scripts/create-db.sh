#!/usr/bin/env bash
# Create CouchDB database. Succeeds on 201 (created) or 412 (already exists).
# Retries up to 30 times (5 minutes).

DB_URL="$1"

for i in {1..30}; do
  status=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$DB_URL")

  if [ "$status" -eq 201 ] || [ "$status" -eq 412 ]; then
    echo "CouchDB is ready (status $status)"
    exit 0
  fi

  echo "Waiting for CouchDB... ($i/30, got $status)"
  sleep 10
done

echo "CouchDB did not become ready in time" >&2
exit 1
