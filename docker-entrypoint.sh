#!/bin/sh

if [ ! -z "$OSC_HOSTNAME" ]; then
  export PUBLIC_HOST="https://$OSC_HOSTNAME"
  echo "Setting PUBLIC_HOST to $PUBLIC_HOST"
  if [ -z "$OSC_ACCESS_TOKEN" ]; then
    echo "OSC_ACCESS_TOKEN is not set. Limited functionality will be available."
  fi
fi

exec "$@"
