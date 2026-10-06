#!/bin/sh

if [ ! -z "$OSC_HOSTNAME" ]; then
  export PUBLIC_HOST="https://$OSC_HOSTNAME"
  echo "Setting PUBLIC_HOST to $PUBLIC_HOST"

  # Default CORS to the instance's own origin unless explicitly configured
  if [ -z "$CORS_ORIGIN" ]; then
    export CORS_ORIGIN="$PUBLIC_HOST"
    echo "Setting CORS_ORIGIN to $CORS_ORIGIN"
  fi

  # Extract environment from auto.{env}.osaas.io format
  if [ -z "$OSC_ENVIRONMENT" ]; then
    OSC_ENVIRONMENT=$(echo "$OSC_HOSTNAME" | sed 's/.*auto\.\(.*\)\.osaas\.io/\1/')
    export OSC_ENVIRONMENT
  fi
  
  if [ -z "$OSC_ACCESS_TOKEN" ]; then
    echo "OSC_ACCESS_TOKEN is not set. Limited functionality will be available."
  fi

  echo "Setting OSC_ENVIRONMENT to $OSC_ENVIRONMENT"
fi

exec "$@"
