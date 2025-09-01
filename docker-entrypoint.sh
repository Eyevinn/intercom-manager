#!/bin/sh

if [ ! -z "$OSC_HOSTNAME" ]; then
  export PUBLIC_HOST="https://$OSC_HOSTNAME"
  echo "Setting PUBLIC_HOST to $PUBLIC_HOST"

  # Extract environment from auto.{env}.osaas.io format
  OSC_ENVIRONMENT=$(echo "$OSC_HOSTNAME" | sed 's/.*auto\.\(.*\)\.osaas\.io/\1/')
  export OSC_ENVIRONMENT
  
  if [ -z "$OSC_ACCESS_TOKEN" ]; then
    echo "OSC_ACCESS_TOKEN is not set. Limited functionality will be available."
  fi

  echo "Setting OSC_ENVIRONMENT to $OSC_ENVIRONMENT"
fi

exec "$@"
