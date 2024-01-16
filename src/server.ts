import api from './api';

const SMB_ADDRESS: string = process.env.SMB_ADDRESS ?? 'http://localhost:8080';

if (!process.env.SMB_ADDRESS) {
  console.warn('SMB_ADDRESS environment variable not set, using defaults');
}

const ENDPOINT_IDLE_TIMEOUT_S: string =
  process.env.ENDPOINT_IDLE_TIMEOUT_S ?? '60';

const server = api({
  title: 'intercom-manager',
  smbServerBaseUrl: SMB_ADDRESS,
  endpointIdleTimeout: ENDPOINT_IDLE_TIMEOUT_S
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;

server.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    throw err;
  }
  console.log(`Server listening on ${address}`);
});

export default server;
