[![Slack](https://slack.osaas.io/badge.svg)](http://slack.osaas.io)

# Eyevinn Open Intercom Server

> _Part of Eyevinn Open Intercom Solution_

[![Badge OSC](https://img.shields.io/badge/Evaluate-24243B?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTIiIGZpbGw9InVybCgjcGFpbnQwX2xpbmVhcl8yODIxXzMxNjcyKSIvPgo8Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI3IiBzdHJva2U9ImJsYWNrIiBzdHJva2Utd2lkdGg9IjIiLz4KPGRlZnM%2BCjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQwX2xpbmVhcl8yODIxXzMxNjcyIiB4MT0iMTIiIHkxPSIwIiB4Mj0iMTIiIHkyPSIyNCIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjQzE4M0ZGIi8%2BCjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzREQzlGRiIvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM%2BCjwvc3ZnPgo%3D)](https://app.osaas.io/browse/eyevinn-intercom-manager)

Eyevinn Open Intercom is a low latency, web based, open source, high quality, voice-over-ip intercom solution.
It is designed to be used in broadcast and media production environments, where low latency and high quality audio are critical.
The solution is built on top of WebRTC technology and provides a user-friendly interface for managing intercom channels and users.

## Requirements

- A Symphony Media Bridge running and reachable
- A MongoDB server or CouchDB server
- Docker engine

## Hosted Solution

Available as an open web service in [Eyevinn Open Source Cloud](https://www.osaas.io/). Read this [documentation to quickly get started](https://docs.osaas.io/osaas.wiki/Service%3A-Intercom.html) with the hosted solution.

### Deploy to Eyevinn Open Source Cloud using Terraform

You can deploy the Intercom Manager to Eyevinn Open Source Cloud using Terraform. This provides a fully managed deployment with infrastructure as code.

#### Prerequisites

1. **Terraform installed** (version >= 1.2.0)
2. **Eyevinn OSC account** - Sign up at [osaas.io](https://www.osaas.io/)
3. **OSC Personal Access Token** - Generate from your OSC account settings

#### Quick Setup

1. **Clone the Terraform examples repository:**
   ```sh
   git clone https://github.com/EyevinnOSC/terraform-examples.git
   cd terraform-examples/examples/intercom
   ```

2. **Configure your OSC credentials:**
   ```sh
   export OSC_ACCESS_TOKEN="your-personal-access-token"
   ```

3. **Initialize Terraform:**
   ```sh
   terraform init
   ```

4. **Review and customize variables:**
   Edit the `terraform.tfvars` file to configure your deployment:
   ```hcl
   # Example configuration
   name = "my-intercom"
   # Add other configuration variables as needed
   ```

5. **Deploy the infrastructure:**
   ```sh
   terraform plan
   terraform apply
   ```

6. **Access your deployment:**
   After successful deployment, Terraform will output the URL where your Intercom Manager is accessible.

#### Configuration Options

The Terraform deployment supports all standard environment variables mentioned in the [Environment Variables](#environment-variables) section. Key configurations include:

- **SMB_ADDRESS**: Symphony Media Bridge endpoint
- **DB_CONNECTION_STRING**: Database connection (managed MongoDB instance provided)
- **ICE_SERVERS**: WebRTC ICE servers for media connectivity
- **OSC_ACCESS_TOKEN**: Your OSC access token for service integration

#### Advanced Configuration

For more advanced setups and examples, see the [OSC Intercom Terraform Examples](https://github.com/EyevinnOSC/terraform-examples/tree/main/examples/intercom) repository which includes:

- Multi-environment deployments
- Custom networking configurations
- Integration with existing OSC services
- Scaling and high availability setups

#### Benefits of OSC Deployment

- **Fully managed infrastructure**: No need to manage servers, databases, or networking
- **Automatic scaling**: Resources scale based on usage
- **Built-in monitoring**: Comprehensive logging and metrics
- **Security**: Enterprise-grade security and compliance
- **Cost-effective**: Pay only for resources used

## Environment variables

| Variable name               | Description                                                                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | Intercom-Manager API port                                                                                                                                                                                                                                   |
| `SMB_ADDRESS`               | The address:port of the Symphony Media Bridge instance                                                                                                                                                                                                      |
| `SMB_APIKEY`                | When set, provide this API key for the Symphony Media Bridge (optional)                                                                                                                                                                                     |
| `DB_CONNECTION_STRING`      | DB connection string (default: `mongodb://localhost:27017/intercom-manager`)                                                                                                                                                                                |
| `PUBLIC_HOST`               | Hostname for frontend application for generating URLs to share                                                                                                                                                                                              |
| `OSC_ACCESS_TOKEN`          | Personal Access Token from OSC for link sharing and reauthenticating                                                                                                                                                                                        |
| `ICE_SERVERS`               | Comma-separated list of ICE servers in the format: `turn:username:password@turn.example.com,stun:stun.example.com`. If no STUN server is provided, and WHIP endpoints are used, Google's default STUN server (`stun:stun.l.google.com:19302`) will be used. |
| `MONGODB_CONNECTION_STRING` | DEPRECATED: MongoDB connection string                                                                                                                                                                                                                       |

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

## Terraform infrastructure

Requires terraform and AWS access

```sh
cd infra
terraform init -var-file="dev.tfvars"
```

### Development workspace

Create or select workspace `dev`

```sh
cd infra
terraform workspace new dev
```

or

```sh
cd infra
terraform workspace select dev
```

Create resources with variables for dev environment

```sh
terraform plan -var-file="dev.tfvars"
terraform apply -var-file="dev.tfvars"
```

### Production workspace

Create or select workspace `prod`

```sh
cd infra
terraform workspace select prod
```

```sh
terraform plan -var-file="prod.tfvars"
terraform apply -var-file="prod.tfvars"
```

### Contributing

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
