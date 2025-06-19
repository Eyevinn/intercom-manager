import api from './api';
import { checkUserStatus } from './api_productions';
import { DbManagerCouchDb } from './db/couchdb';
import { DbManagerMongoDb } from './db/mongodb';
import { Log } from './log';

const SMB_ADDRESS: string = process.env.SMB_ADDRESS ?? 'http://localhost:8080';
const PUBLIC_HOST: string = process.env.PUBLIC_HOST ?? 'http://localhost:3000';

if (!process.env.SMB_ADDRESS) {
  console.warn('SMB_ADDRESS environment variable not set, using defaults');
}

const ENDPOINT_IDLE_TIMEOUT_S: string =
  process.env.ENDPOINT_IDLE_TIMEOUT_S ?? '60';

setInterval(checkUserStatus, 2_000);

const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;

const DB_CONNECTION_STRING: string =
  process.env.DB_CONNECTION_STRING ??
  process.env.MONGODB_CONNECTION_STRING ??
  'mongodb://localhost:27017/intercom-manager';
let dbManager;
const dbUrl = new URL(DB_CONNECTION_STRING);
if (dbUrl.protocol === 'mongodb:') {
  dbManager = new DbManagerMongoDb(dbUrl);
} else if (dbUrl.protocol === 'http:' || dbUrl.protocol === 'https:') {
  dbManager = new DbManagerCouchDb(dbUrl);
} else {
  throw new Error('Unsupported database protocol');
}

(async function startServer() {
  const server = await api({
    title: 'intercom-manager',
    smbServerBaseUrl: SMB_ADDRESS,
    endpointIdleTimeout: ENDPOINT_IDLE_TIMEOUT_S,
    smbServerApiKey: process.env.SMB_APIKEY,
    publicHost: PUBLIC_HOST,
    dbManager: dbManager
  });

  server.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      throw err;
    }
    Log().info(`Manager listening on ${address}`);
    Log().info(
      `Media Bridge at ${SMB_ADDRESS} (${ENDPOINT_IDLE_TIMEOUT_S}s idle timeout)`
    );
  });
})();
