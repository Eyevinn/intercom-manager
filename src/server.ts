import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { initJwt } from './auth/jwt';
import { CallManager, SmbInstance } from './call_manager';
import { ClientRegistry } from './client_registry';
import { ConnectionQueue } from './connection_queue';
import { DbManagerCouchDb } from './db/couchdb';
import { DbManagerMongoDb } from './db/mongodb';
import { IngestManager } from './ingest_manager';
import { Log } from './log';
import { ProductionManager } from './production_manager';
import { SmbProtocol } from './smb';
import { TalkManager } from './talk_manager';
import { StatusManager } from './websocket/status_manager';

const SMB_ADDRESS: string = process.env.SMB_ADDRESS ?? 'http://localhost:8080';
const PUBLIC_HOST: string = process.env.PUBLIC_HOST ?? 'http://localhost:8000';

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
if (dbUrl.protocol === 'mongodb:' || dbUrl.protocol === 'mongodb+srv:') {
  dbManager = new DbManagerMongoDb(dbUrl);
} else if (dbUrl.protocol === 'http:' || dbUrl.protocol === 'https:') {
  dbManager = new DbManagerCouchDb(dbUrl);
} else {
  throw new Error('Unsupported database protocol');
}

// Global safety net for unhandled rejections (e.g., transient CouchDB errors)
process.on('unhandledRejection', (reason: unknown) => {
  const message =
    reason instanceof Error ? reason.message : String(reason);
  Log().error(`Unhandled rejection: ${message}`);
  // Don't crash — transient DB/network errors should not kill the server
});

(async function startServer() {
  // Retry DB connection on startup (handles transient DNS/network failures)
  let dbConnected = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await dbManager.connect();
      dbConnected = true;
      break;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Log().error(
        `Database connection attempt ${attempt}/3 failed: ${message}`
      );
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
  if (!dbConnected) {
    Log().error(
      'Failed to connect to database after 3 attempts. Exiting.'
    );
    process.exit(1);
  }

  const productionManager = new ProductionManager(dbManager);
  await productionManager.load();

  const connectionQueue = new ConnectionQueue();
  const ingestManager = new IngestManager(dbManager);
  await ingestManager.load();

  // Initialize JWT authentication (M1)
  const JWT_SECRET = process.env.JWT_SECRET ?? 'srpoc-dev-secret-change-in-production';
  initJwt(JWT_SECRET);
  if (!process.env.JWT_SECRET) {
    Log().warn('JWT_SECRET not set — using default dev secret. Set JWT_SECRET in production!');
  }

  // Initialize client registry and status manager (M1)
  const clientRegistry = new ClientRegistry(dbManager);
  const statusManager = new StatusManager(clientRegistry);

  // Initialize call manager with multi-SMB support (M2 + M4)
  // SMB_ADDRESSES (comma-separated) takes priority over single SMB_ADDRESS.
  // All URLs get /conferences/ appended to match the SMB API path.
  const smbMaxConferences = parseInt(process.env.SMB_MAX_CONFERENCES || '80', 10);
  const defaultApiKey = process.env.SMB_APIKEY || '';

  let smbInstances: SmbInstance[];
  const smbAddressesRaw = process.env.SMB_ADDRESSES;

  if (smbAddressesRaw) {
    // Multi-SMB mode: comma-separated URLs
    const urls = smbAddressesRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    // SMB_APIKEYS can be comma-separated (parallel to URLs) or a single shared key
    const apiKeysRaw = process.env.SMB_APIKEYS;
    const apiKeys = apiKeysRaw
      ? apiKeysRaw.split(',').map((s) => s.trim())
      : [];

    smbInstances = urls.map((url, i) => ({
      url: new URL('/conferences/', url).toString(),
      apiKey: apiKeys[i] || defaultApiKey,
      conferenceCount: 0,
      maxConferences: smbMaxConferences
    }));

    Log().info(
      `Multi-SMB mode: ${smbInstances.length} instances configured (max ${smbMaxConferences} conferences each)`
    );
  } else {
    // Single SMB backward compat
    smbInstances = [{
      url: new URL('/conferences/', SMB_ADDRESS).toString(),
      apiKey: defaultApiKey,
      conferenceCount: 0,
      maxConferences: smbMaxConferences
    }];

    Log().info(`Single SMB mode: ${SMB_ADDRESS} (max ${smbMaxConferences} conferences)`);
  }

  const callManager = new CallManager(
    dbManager,
    clientRegistry,
    new SmbProtocol(),
    smbInstances,
    parseInt(ENDPOINT_IDLE_TIMEOUT_S, 10)
  );

  // Initialize talk manager (M3) and wire to status manager
  const talkManager = new TalkManager(callManager);
  statusManager.setTalkManager(talkManager);

  // Wire disconnect callback for call cleanup (M2)
  statusManager.setOnDisconnectCallback(async (disconnectedClientId: string) => {
    try {
      const activeCalls = await callManager.getActiveCallsForClient(disconnectedClientId);
      for (const call of activeCalls) {
        const endedCall = await callManager.endCallDueToDisconnect(call._id, disconnectedClientId);
        if (endedCall) {
          const otherClientId =
            endedCall.callerId === disconnectedClientId
              ? endedCall.calleeId
              : endedCall.callerId;

          const callEndedEvent = {
            type: 'call_ended' as const,
            callId: endedCall._id,
            callerId: endedCall.callerId,
            callerName: endedCall.callerName,
            calleeId: endedCall.calleeId,
            calleeName: endedCall.calleeName,
            endedBy: disconnectedClientId,
            reason: endedCall.endReason || 'caller_disconnected',
            timestamp: new Date().toISOString()
          };

          // Notify the other party
          statusManager.sendToClient(otherClientId, callEndedEvent);
          // Broadcast for status API
          statusManager.broadcastToAll(callEndedEvent);
        }
      }
    } catch (err: any) {
      Log().error(`Failed to clean up calls for disconnected client ${disconnectedClientId}: ${err.message}`);
    }
  });

  const server = await api({
    title: 'intercom-manager',
    smbServerBaseUrl: SMB_ADDRESS,
    endpointIdleTimeout: ENDPOINT_IDLE_TIMEOUT_S,
    smbServerApiKey: process.env.SMB_APIKEY,
    publicHost: PUBLIC_HOST,
    whipAuthKey: process.env.WHIP_AUTH_KEY,
    dbManager: dbManager,
    productionManager: productionManager,
    ingestManager: ingestManager,
    clientRegistry: clientRegistry,
    statusManager: statusManager,
    callManager: callManager,
    talkManager: talkManager,
    coreFunctions: new CoreFunctions(productionManager, connectionQueue)
  });

  server.listen({ port: PORT, host: '::' }, (err, address) => {
    if (err) {
      throw err;
    }
    Log().info(`Manager listening on ${address}`);
    Log().info(
      `Media Bridge: ${smbInstances.length} SMB instance(s) (${ENDPOINT_IDLE_TIMEOUT_S}s idle timeout, max ${smbMaxConferences} conferences each)`
    );
    for (const inst of smbInstances) {
      Log().info(`  SMB: ${inst.url}`);
    }
    Log().info('Client registry and WebSocket status manager initialized');
  });
})();
