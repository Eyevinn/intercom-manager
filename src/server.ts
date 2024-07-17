import api from './api';
import { Log } from './log';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { ProductionManager } from './production_manager';

const SMB_ADDRESS: string = process.env.SMB_ADDRESS ?? 'http://localhost:8080';

if (!process.env.SMB_ADDRESS) {
  console.warn('SMB_ADDRESS environment variable not set, using defaults');
}

const ENDPOINT_IDLE_TIMEOUT_S: string =
  process.env.ENDPOINT_IDLE_TIMEOUT_S ?? '60';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;

const productionManager = new ProductionManager();
const connectionQueue = new ConnectionQueue();

(async function startServer() {
  await productionManager.load();

  setInterval(() => {
    productionManager.checkUserStatus();
  }, 2_000);

  const server = await api({
    title: 'intercom-manager',
    whipApiKey: process.env.WHIP_APIKEY || 'apikeyindev',
    smbServerBaseUrl: SMB_ADDRESS,
    endpointIdleTimeout: ENDPOINT_IDLE_TIMEOUT_S,
    smbServerApiKey: process.env.SMB_APIKEY,
    productionManager,
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
