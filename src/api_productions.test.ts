import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { NewProduction, NewProductionLine, Production } from './models';

// Mocking production objects for the api object.
const newProduction: NewProduction = {
  name: 'productionname',
  lines: [{
      name: 'linename'
    }]
};

const createdProduction: Production = {
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

const mockCoreFunctions = {
  getAllLinesResponse: jest.fn().mockImplementation((production) => production.lines)
} as any;

// Setting up manager mocks
const mockProductionManager = {
  createProduction: jest.fn().mockResolvedValue(createdProduction),
  requireProduction: jest.fn().mockResolvedValue( {_id: 1, name: "prod", lines: []} ),
  addProductionLine: jest.fn().mockResolvedValue(undefined),
  getUsersForLine: jest.fn()
} as any;


// Describes a set of tests under the name 'Prodcution API'. 
// sets up a mock server to simulate the api calls.
describe('Production API', () => {
  let server: any;

  beforeAll( async () => {
    // The mock server is set up inside the test. Anyway to have it outside the test, then define a set of tests that 
    // uses the setup mock server? Otherwise have to set up new server for every test. 
    server = await api({
      title: 'my awesome service production',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager,
      coreFunctions: mockCoreFunctions
    });
  });

  test('can create a new production from setup values', async () => {
    const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: newProduction
    });
    expect(response.statusCode).toBe(200);
    });

    // Check with adding more lines to existing production
    test("can add a new production line", async () => {
      const response = await server.inject({
        method: 'POST', 
        url: '/api/v1/production/1/line',
        body: { name: "newLine", programOutputLine: true}
      });
      expect(response.statusCode).toBe(200);
    });
    
    // Test long poll endpoint
  test("", async () => {
    
  })



    
});
 
