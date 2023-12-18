# intercom-manager

> _Open Source Intercom Solution_

[![Slack](http://slack.streamingtech.se/badge.svg)](http://slack.streamingtech.se)

Intercom solution powered by Symphony Media Bridge. This is the Intercom manager API microservice.

## Requirements

- A Symphony Media Bridge running and reachable
- Docker engine

## Installation / Usage

Start an Intercom Manager instance:

```
docker run -d -p 8000:8000 \
  -e PORT=8000 \
  -e SMB_ADDRESS=http://<smburl>:<smbport> \
  eyevinntechnology/intercom-manager
```

```
  PORT=8000                             intercom-manager api port.
  SMB_ADDRESS=http://<smburl>:<smbport> The address:port of the Symphony Media Bridge instance.
```

API docs is then available on `http://localhost:8000/docs/`

## Development

Requires Node JS engine >= v18.

Install dependencies

```
npm install
```

Run tests

```
npm test
```

Start server locally

```
SMB_ADDRESS=http://<smburl>:<smbport> npm start
```

### Contributing

See [CONTRIBUTING](CONTRIBUTING.md)

# Support

Join our [community on Slack](http://slack.streamingtech.se) where you can post any questions regarding any of our open source projects. Eyevinn's consulting business can also offer you:

- Further development of this component
- Customization and integration of this component into your platform
- Support and maintenance agreement

Contact [sales@eyevinn.se](mailto:sales@eyevinn.se) if you are interested.

# About Eyevinn Technology

[Eyevinn Technology](https://www.eyevinntechnology.se) is an independent consultant firm specialized in video and streaming. Independent in a way that we are not commercially tied to any platform or technology vendor. As our way to innovate and push the industry forward we develop proof-of-concepts and tools. The things we learn and the code we write we share with the industry in [blogs](https://dev.to/video) and by open sourcing the code we have written.

Want to know more about Eyevinn and how it is to work here. Contact us at work@eyevinn.se!
