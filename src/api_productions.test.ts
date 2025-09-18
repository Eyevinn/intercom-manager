import { METHODS } from 'http';
import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { NewProduction, NewProductionLine, Production } from './models';

// Mocking production objects
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
  getAllLinesResponse: jest.fn().mockImplementation((production) => production.lines), 
  createConferenceForLine: jest.fn().mockResolvedValue('mock-conference-id'),
  createEndpoint: jest.fn().mockResolvedValue({
    audio: {ssrcs: [12345],'payload-type': {}, 'rtp-hdrexts': []}
  }),
  createConnection: jest.fn().mockResolvedValue('fake-sdp-offer'),
} as any;

const mockNewSession = {
  productionId: '1',
  lineId: '1',
  username: "Lo"
};

/* Needed? 
export const SessionResponse = Type.Object({
  sdp: Type.String(),
  sessionId: Type.String()
});
*/

const mockUserSession = {
  name: "usersession",
  smbConferenceId: "conferenceId",
  productionId: "1",
  lineId: "1",
  lastSeen: 2,
  endpointId: 'mock-endpoint-1',
  isActive: true,
  isExpired: false,
  isWhip: false
}

// Setting up manager mocks
const mockProductionManager = {
  createProduction: jest.fn().mockResolvedValue(createdProduction),
  requireProduction: jest.fn().mockResolvedValue( {_id: 1, name: "prod", lines: []} ),
  addProductionLine: jest.fn().mockResolvedValue(undefined),
  getUsersForLine: jest.fn(),
  userSessions: {'mock-session': mockUserSession}
} as any;

// Describes a set of tests under the name 'Prodcution API'. 
// sets up a mock server to simulate the api calls.
describe('Production API', () => {
  let server: any;

  beforeAll( async () => {
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

  // creating a production from api endpoint
  test('can create a new production from setup values', async () => {
    const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: newProduction
    });
    expect(response.statusCode).toBe(200);
  });

  // adding more lines to prouduction
  test("can add a new production line", async () => {
    const response = await server.inject({
      method: 'POST', 
      url: '/api/v1/production/1/line',
      body: { name: "newLine", programOutputLine: true}
    });
    expect(response.statusCode).toBe(200);
  });
    
  // long poll endpoint for participants
  test("can do long polling for change in line participants", async () => {
    mockProductionManager.once = jest.fn().mockImplementation((event, callback) => {
      if (event === 'users:change') {
        callback();
      }
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/production/1/line/1/participants',
    });
    console.log(response.payload)
    expect(response.statusCode).toBe(200);
  })

  // setting up session protocol
  test("can create a session", async () => {
    const response = await server.inject({
      method: 'POST', 
      url: '/api/v1/session',
      body: mockNewSession
    });
    expect(response.statusCode).toBe(201);
  })
});
 
