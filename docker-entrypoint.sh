#!/bin/sh

if [ ! -z "$OSC_HOSTNAME" ]; then
  export PUBLIC_HOST="https://$OSC_HOSTNAME"
  echo "Setting PUBLIC_HOST to $PUBLIC_HOST"
  
  # Determine environment from hostname
  if [[ "$OSC_HOSTNAME" == *"-dev."* ]]; then
    export OSC_ENVIRONMENT="dev"
  elif [[ "$OSC_HOSTNAME" == *"-stage."* ]]; then
    export OSC_ENVIRONMENT="stage"
  elif [[ "$OSC_HOSTNAME" == *".prod."* ]]; then
    export OSC_ENVIRONMENT="prod"
  fi
  
  if [ -z "$OSC_ACCESS_TOKEN" ]; then
    echo "OSC_ACCESS_TOKEN is not set. Limited functionality will be available."
  fi

  echo "Setting OSC_ENVIRONMENT to $OSC_ENVIRONMENT"
fi

exec "$@"
