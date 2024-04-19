# intercom-manager

> _Open Source Intercom Solution_

[![Slack](http://slack.streamingtech.se/badge.svg)](http://slack.streamingtech.se)

Intercom solution powered by Symphony Media Bridge. This is the Intercom manager API microservice.

## Requirements

- A Symphony Media Bridge running and reachable
- A MongoDB server
- Docker engine

## Environment variables

| Variable name               | Description                                                                       |
| --------------------------- | --------------------------------------------------------------------------------- |
| `PORT`                      | Intercom-Manager API port                                                         |
| `SMB_ADDRESS`               | The address:port of the Symphony Media Bridge instance                            |
| `MONGODB_CONNECTION_STRING` | MongoDB connection string (default: `mongodb://localhost:27017/intercom-manager`) |

## Installation / Usage

Start an Intercom Manager instance:

```sh
docker run -d -p 8000:8000 \
  -e PORT=8000 \
  -e SMB_ADDRESS=http://<smburl>:<smbport> \
  -e MONGODB_CONNECTION_STRING=mongodb://<host>:<port>/<db-name> \
  eyevinntechnology/intercom-manager
```

The API docs is then available on `http://localhost:8000/docs/`

## Development

Requires Node JS engine >= v18 and [MongoDB](https://www.mongodb.com/docs/manual/administration/install-community/) (tested with MondoDB v7).

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
SMB_ADDRESS=http://<smburl>:<smbport> npm start
```

See [Environment Variables](#environment-variables) for a full list of environment variables you can set. The default `MONGODB_CONNECTION_STRING` is probably what you want to use for local development unless you use a remote db server.

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

Join our [community on Slack](http://slack.streamingtech.se) where you can post any questions regarding any of our open source projects. Eyevinn's consulting business can also offer you:

- Further development of this component
- Customization and integration of this component into your platform
- Support and maintenance agreement

Contact [sales@eyevinn.se](mailto:sales@eyevinn.se) if you are interested.

## About Eyevinn Technology

[Eyevinn Technology](https://www.eyevinntechnology.se) is an independent consultant firm specialized in video and streaming. Independent in a way that we are not commercially tied to any platform or technology vendor. As our way to innovate and push the industry forward we develop proof-of-concepts and tools. The things we learn and the code we write we share with the industry in [blogs](https://dev.to/video) and by open sourcing the code we have written.

Want to know more about Eyevinn and how it is to work here. Contact us at work@eyevinn.se!
