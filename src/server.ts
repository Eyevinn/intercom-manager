import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { DbManagerCouchDb } from './db/couchdb';
import { DbManagerMongoDb } from './db/mongodb';
import { IngestManager } from './ingest_manager';
import { Log } from './log';
import { ProductionManager } from './production_manager';

const SMB_ADDRESS: string = process.env.SMB_ADDRESS ?? 'http://localhost:8080';
const PUBLIC_HOST: string = process.env.PUBLIC_HOST ?? 'http://localhost:3000';

if (!process.env.SMB_ADDRESS) {
  console.warn('SMB_ADDRESS environment variable not set, using defaults');
}

const ENDPOINT_IDLE_TIMEOUT_S: string =
  process.env.ENDPOINT_IDLE_TIMEOUT_S ?? '60';

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
  const productionManager = new ProductionManager(dbManager);
  await productionManager.load();

  const connectionQueue = new ConnectionQueue();
  const ingestManager = new IngestManager(dbManager);
  await ingestManager.load();

  setInterval(() => productionManager.checkUserStatus(), 2_000);

  const server = await api({
    title: 'intercom-manager',
    smbServerBaseUrl: SMB_ADDRESS,
    endpointIdleTimeout: ENDPOINT_IDLE_TIMEOUT_S,
    smbServerApiKey: process.env.SMB_APIKEY,
    publicHost: PUBLIC_HOST,
    dbManager: dbManager,
    productionManager: productionManager,
    ingestManager: ingestManager,
    coreFunctions: new CoreFunctions(productionManager, connectionQueue)
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
