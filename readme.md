[![Slack](https://slack.osaas.io/badge.svg)](http://slack.osaas.io)

# Eyevinn Open Intercom Server

> _Part of Eyevinn Open Intercom Solution_

[![Badge OSC](https://img.shields.io/badge/Evaluate-24243B?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTIiIGZpbGw9InVybCgjcGFpbnQwX2xpbmVhcl8yODIxXzMxNjcyKSIvPgo8Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI3IiBzdHJva2U9ImJsYWNrIiBzdHJva2Utd2lkdGg9IjIiLz4KPGRlZnM%2BCjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQwX2xpbmVhcl8yODIxXzMxNjcyIiB4MT0iMTIiIHkxPSIwIiB4Mj0iMTIiIHkyPSIyNCIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjQzE4M0ZGIi8%2BCjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzREQzlGRiIvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM%2BCjwvc3ZnPgo%3D)](https://app.osaas.io/browse/eyevinn-intercom-manager?utm_source=github&utm_medium=readme&utm_campaign=intercom)

Eyevinn Open Intercom is a low latency, web based, open source, high quality, voice-over-ip intercom solution.
It is designed to be used in broadcast and media production environments, where low latency and high quality audio are critical.
The solution is built on top of WebRTC technology and provides a user-friendly interface for managing intercom channels and users.

## Requirements

- A Symphony Media Bridge running and reachable
- A MongoDB server or CouchDB server
- Docker engine

## Hosted Solution

Available as a hosted service on [Open Source Cloud](https://intercom.apps.osaas.io?utm_source=github&utm_medium=readme&utm_campaign=intercom) if you prefer not to manage the infrastructure yourself. Read the [documentation](https://docs.osaas.io/osaas.wiki/Service%3A-Intercom.html) to get started.

### Deploy to Eyevinn Open Source Cloud using Terraform

You can deploy the complete Open Intercom solution (including database, media bridge, and intercom manager) to Eyevinn Open Source Cloud using Terraform. See the [OSC Intercom Terraform Examples](https://github.com/EyevinnOSC/terraform-examples/tree/main/examples/intercom) repository for complete configuration examples.

#### Quick Setup

1. **Clone the Terraform examples repository:**

   ```sh
   git clone https://github.com/EyevinnOSC/terraform-examples.git
   cd terraform-examples/examples/intercom
   ```

2. **Set required environment variables:**

   ```sh
   export TF_VAR_osc_pat="your-personal-access-token"
   export TF_VAR_smb_api_key="your-smb-api-key"
   export TF_VAR_db_admin_password="your-db-password"
   ```

3. **Initialize and deploy:**
   ```sh
   terraform init
   terraform plan
   terraform apply
   ```

#### Configuration Variables

The `osc_eyevinn_intercom_manager` resource requires these variables:

- **`name`**: Intercom system name (lowercase letters and numbers only)
- **`smb_url`**: Symphony Media Bridge instance URL
- **`smb_api_key`**: Symphony Media Bridge API key
- **`db_url`**: Database connection URL
- **`osc_access_token`**: OSC Personal Access Token (optional)

## Environment variables

| Variable name               | Description                                                                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | Intercom-Manager API port (default: `8000`)                                                                                                                                                                                                                 |
| `SMB_ADDRESS`               | The address:port of the Symphony Media Bridge instance (default: `http://localhost:8080`)                                                                                                                                                                   |
| `SMB_APIKEY`                | When set, provide this API key for the Symphony Media Bridge (optional)                                                                                                                                                                                     |
| `DB_CONNECTION_STRING`      | DB connection string (default: `mongodb://localhost:27017/intercom-manager`). Supports MongoDB (`mongodb://`) and CouchDB (`http://`/`https://`)                                                                                                            |
| `PUBLIC_HOST`               | Hostname for frontend application for generating URLs to share (default: `http://localhost:8000`)                                                                                                                                                           |
| `CORS_ORIGIN`               | Comma-separated list of allowed CORS origins, e.g. `http://localhost:5173,http://localhost:5174`. When unset, CORS is disabled. Required for local development when the frontend runs on a different port                                                   |
| `WHIP_AUTH_KEY`             | When set, WHIP and WHEP endpoints require a `Bearer` token matching this key (optional)                                                                                                                                                                     |
| `ENDPOINT_IDLE_TIMEOUT_S`   | Idle timeout in seconds for SMB endpoints (default: `60`)                                                                                                                                                                                                   |
| `OSC_ACCESS_TOKEN`          | Personal Access Token from OSC for link sharing and reauthenticating (optional)                                                                                                                                                                             |
| `ICE_SERVERS`               | Comma-separated list of ICE servers in the format: `turn:username:password@turn.example.com,stun:stun.example.com`. If no STUN server is provided, and WHIP endpoints are used, Google's default STUN server (`stun:stun.l.google.com:19302`) will be used. |
| `MONGODB_CONNECTION_STRING` | DEPRECATED: Use `DB_CONNECTION_STRING` instead                                                                                                                                                                                                              |

## Authentication

Intercom Manager does not provide an authentication layer of its own, and that is by design. How access is controlled is deployment specific in most cases, so it belongs to whatever fronts the service rather than to the service itself.

When the service runs on Eyevinn Open Source Cloud it sits behind the OSC provided auth wall, which authenticates every request before it reaches the API. The `GET /api/v1/reauth` endpoint exists to renew the token that wall issued. It requires `OSC_ACCESS_TOKEN` to be set, requests a fresh OSC service access token from the OSC token service, and stores it in the `eyevinn-intercom-manager.sat` cookie so that API calls continue to work as the previous token approaches expiry. When `OSC_ACCESS_TOKEN` is not set the service is not running in an OSC context and the endpoint responds with `405`.

Contributors should not add an in-process authentication layer to the API. An extra auth level conflicts with the OSC auth wall and breaks current deploys and installations. The one bearer key already in the code, `WHIP_AUTH_KEY`, guards only the WHIP and WHEP ingest endpoints and is not a general API authentication mechanism.

## Installation / Usage

Start an Intercom Manager instance:

```sh
docker run -d -p 8000:8000 \
  -e PORT=8000 \
  -e SMB_ADDRESS=http://<smburl>:<smbport> \
  -e DB_CONNECTION_STRING=<mongodb|http>://<host>:<port>/<db-name> \
  eyevinntechnology/intercom-manager
```

The API docs is then available on `http://localhost:8000/api/docs/`

## Development

Requires Node JS engine >= v18 and [MongoDB](https://www.mongodb.com/docs/manual/administration/install-community/) (tested with MongoDB v7) or [CouchDB](https://docs.couchdb.org/en/stable/index.html).

Install dependencies

```sh
npm install
```

Run tests

```sh
npm test
```

Start server locally

```sh
SMB_ADDRESS=http://<smburl>:<smbport> SMB_APIKEY=<smbapikey> npm start
```

See [Environment Variables](#environment-variables) for a full list of environment variables you can set. The default `DB_CONNECTION_STRING` is probably what you want to use for local development unless you use a remote db server.

## Contributing

See [CONTRIBUTING](CONTRIBUTING.md)

## Support

Join our [community on Slack](http://slack.osaas.io) where you can post any questions regarding any of our open source projects. Eyevinn's consulting business can also offer you:

- Further development of this component
- Customization and integration of this component into your platform
- Support and maintenance agreement

Contact [sales@eyevinn.se](mailto:sales@eyevinn.se) if you are interested.

## About Eyevinn Technology

[Eyevinn Technology](https://www.eyevinntechnology.se) is an independent consultant firm specialized in video and streaming. Independent in a way that we are not commercially tied to any platform or technology vendor. As our way to innovate and push the industry forward we develop proof-of-concepts and tools. The things we learn and the code we write we share with the industry in [blogs](https://dev.to/video) and by open sourcing the code we have written.

Want to know more about Eyevinn and how it is to work here. Contact us at work@eyevinn.se!
