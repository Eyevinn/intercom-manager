import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { DbManagerCouchDb } from './db/couchdb';
import { DbManagerMongoDb } from './db/mongodb';
import { IngestManager } from './ingest_manager';
import { Log } from './log';
import { ProductionManager } from './production_manager';

const SMB_ADDRESS: string = process.env.SMB_ADDRESS ?? 'http://localhost:8080';
const PUBLIC_HOST: string = process.env.PUBLIC_HOST ?? 'http://localhost:8000';

if (!process.env.SMB_ADDRESS) {
  Log().warn('SMB_ADDRESS environment variable not set, using defaults');
}

const REAUTH_AUTH_KEY =
  process.env.REAUTH_AUTH_KEY ?? process.env.WHIP_AUTH_KEY;

if (process.env.OSC_ACCESS_TOKEN && !REAUTH_AUTH_KEY?.trim()) {
  const reason =
    REAUTH_AUTH_KEY === undefined
      ? 'no REAUTH_AUTH_KEY or WHIP_AUTH_KEY is set'
      : 'REAUTH_AUTH_KEY/WHIP_AUTH_KEY is set but empty or whitespace only, which disables auth - this is most likely a configuration error';
  Log().warn(
    `SECURITY: GET /api/v1/reauth is UNAUTHENTICATED - anyone who can reach this server can obtain a valid OSC service access token. Reason: ${reason}. Set REAUTH_AUTH_KEY to a non-empty secret to require a Bearer token.`
  );
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
if (dbUrl.protocol === 'mongodb:' || dbUrl.protocol === 'mongodb+srv:') {
  dbManager = new DbManagerMongoDb(dbUrl);
} else if (dbUrl.protocol === 'http:' || dbUrl.protocol === 'https:') {
  dbManager = new DbManagerCouchDb(dbUrl);
} else {
  throw new Error('Unsupported database protocol');
}

(async function startServer() {
  await dbManager.connect();
  const productionManager = new ProductionManager(dbManager);
  await productionManager.load();

  const connectionQueue = new ConnectionQueue();
  const ingestManager = new IngestManager(dbManager);
  await ingestManager.load();

  const server = await api({
    title: 'intercom-manager',
    smbServerBaseUrl: SMB_ADDRESS,
    endpointIdleTimeout: ENDPOINT_IDLE_TIMEOUT_S,
    smbServerApiKey: process.env.SMB_APIKEY,
    publicHost: PUBLIC_HOST,
    whipAuthKey: process.env.WHIP_AUTH_KEY,
    reAuthKey: REAUTH_AUTH_KEY,
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

  const shutdown = async (signal: string) => {
    Log().info(`${signal} received, shutting down gracefully`);
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    Log().error('Unhandled promise rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    Log().error('Uncaught exception:', err);
    process.exit(1);
  });
})();
