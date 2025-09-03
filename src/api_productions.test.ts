import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { NewProduction, Production } from './models';

// Mocking production objects for the api object.
const newProduction: NewProduction = {
  name: 'A test',
  lines: [{
      name: 'linename'
    }]
};
const existingProduction: Production = {
  _id: 1,
  name: 'productionname',
  lines: [{
      name: 'linename',
      id: '1',
      smbConferenceId: 'smbineid'
    }]
};
const mockDbManager = { // Sam setup as other tests.
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
  deleteIngest: jest.fn().mockResolvedValue(true)
};
const mockIngestManager = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn()
} as any;

// Setting up manager mocks
const mockProductionManager = {
  createProduction: jest.fn()
} as any;
// Defines the resolved value of the mock function "createProduction". 
mockProductionManager.createProduction.mockResolvedValue(existingProduction);

// Describes a set of tests under the name 'Prodcution API'. 
// sets up a mock server to simulate the api calls.
describe('Production API', () => {
  test('A test', async () => {
    // The mock server is set up inside the test. Anyway to have it outside the test, then define a set of tests that 
    // uses the setup mock server? Otherwise have to set up new server for every test. 
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
      )
    });
    const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: newProduction
    });
    expect(response.statusCode).toBe(200);
    });
});
 
