import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { UserSession } from './models';

jest.mock('./db/interface', () => ({
  getIngests: jest.fn().mockResolvedValue([]),
  connect: jest.fn()
}));

jest.mock('./ingest_manager', () => {
  return {
    IngestManager: jest.fn().mockImplementation(() => ({
      load: jest.fn().mockResolvedValue(undefined),
      startPolling: jest.fn()
    }))
  };
});

jest.mock('./db/mongodb');

const mockDbManager = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  getProduction: jest.fn().mockResolvedValue(undefined),
  getProductions: jest.fn().mockResolvedValue([]),
  getProductionsLength: jest.fn().mockResolvedValue(0),
  updateProduction: jest.fn().mockResolvedValue(undefined),
  addProduction: jest.fn().mockResolvedValue({}),
  deleteProduction: jest.fn().mockResolvedValue(true),
  setLineConferenceId: jest.fn().mockResolvedValue(undefined),
  addIngest: jest.fn().mockResolvedValue({}),
  getIngest: jest.fn().mockResolvedValue(undefined),
  getIngestsLength: jest.fn().mockResolvedValue(0),
  getIngests: jest.fn().mockResolvedValue([]),
  updateIngest: jest.fn().mockResolvedValue(undefined),
  deleteIngest: jest.fn().mockResolvedValue(true),
  addTransmitter: jest.fn().mockResolvedValue({}),
  getTransmitter: jest.fn().mockResolvedValue(undefined),
  getTransmitters: jest.fn().mockResolvedValue([]),
  getTransmittersLength: jest.fn().mockResolvedValue(0),
  updateTransmitter: jest.fn().mockResolvedValue(undefined),
  deleteTransmitter: jest.fn().mockResolvedValue(true),
  addReceiver: jest.fn().mockResolvedValue({}),
  getReceiver: jest.fn().mockResolvedValue(undefined),
  getReceivers: jest.fn().mockResolvedValue([]),
  getReceiversLength: jest.fn().mockResolvedValue(0),
  updateReceiver: jest.fn().mockResolvedValue(undefined),
  deleteReceiver: jest.fn().mockResolvedValue(true),
  saveUserSession: jest.fn().mockResolvedValue(undefined),
  getSession: jest.fn().mockResolvedValue(null),
  deleteUserSession: jest.fn().mockResolvedValue(true),
  updateSession: jest.fn().mockResolvedValue(true),
  getSessionsByQuery: jest.fn().mockResolvedValue([])
};

const mockProductionManager = {
  checkUserStatus: jest.fn()
} as any;

const mockIngestManager = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn()
} as any;

describe('share api', () => {
  test('can generate a share link for a given application path', async () => {
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager,
      coreFunctions: new CoreFunctions(
        mockProductionManager,
        new ConnectionQueue()
      ),
      whipGatewayUrl: '',
      whepGatewayUrl: ''
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/share',
      body: {
        path: '/mypath/to/share'
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      url: 'https://example.com/mypath/to/share'
    });
  });
});
