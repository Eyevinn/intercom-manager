import api from './api';

const SMB_ADDRESS: string = process.env.SMB_ADDRESS ?? 'http://localhost:8080';

if (!process.env.SMB_ADDRESS) {
  console.warn('SMB_ADDRESS environment variable not set, using defaults');
}

const ENDPOINT_IDLE_TIMEOUT_S: string =
  process.env.ENDPOINT_IDLE_TIMEOUT_S ?? '60';

const REGULAR_CLEANUP: string = process.env.REGULAR_CLEANUP ?? 'true';

const USER_INACTIVITY_THRESHOLD_S: string =
  process.env.USER_INACTIVITY_THRESHOLD_S ?? '60';

const USER_REMOVAL_THRESHOLD_S: string =
  process.env.USER_REMOVAL_THRESHOLD_S ?? '120';

const USER_CLEANUP_INTERVAL_S: string =
  process.env.USER_CLEANUP_INTERVAL_S ?? '30';

const server = api({
  title: 'intercom-manager',
  smbServerBaseUrl: SMB_ADDRESS,
  endpointIdleTimeout: ENDPOINT_IDLE_TIMEOUT_S,
  regularCleanup: REGULAR_CLEANUP,
  userInactivityThreshold: USER_INACTIVITY_THRESHOLD_S,
  userRemovalThreshold: USER_REMOVAL_THRESHOLD_S,
  userCleanupInterval: USER_CLEANUP_INTERVAL_S
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;

server.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    throw err;
  }
  console.log(`Server listening on ${address}`);
});

export default server;
