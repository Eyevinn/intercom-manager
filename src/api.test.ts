import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { ProductionManager } from './production_manager';

jest.mock('./db_manager');

describe('api', () => {
  it('responds with hello, world!', async () => {
    const productionManager = new ProductionManager();
    const connectionQueue = new ConnectionQueue();
    const server = await api({
      title: 'my awesome service',
      whipApiKey: 'apikeyindev',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      productionManager,
      coreFunctions: new CoreFunctions(productionManager, connectionQueue)
    });
    const response = await server.inject({
      method: 'GET',
      url: '/'
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('Hello, world! I am my awesome service');
  });
});
