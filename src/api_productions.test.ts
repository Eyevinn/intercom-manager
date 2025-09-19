import api from './api';
import { NewProduction, Production } from './models';

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

const mockDbManager = { // Same setup as other tests.
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
  getAllLinesResponse: jest.fn().mockImplementation((production) => production.lines.map((l: any) => ({
    name: l.name,
    id: l.id,
    smbConferenceId: l.smbConferenceId,
    participants: l.participants || [],
    programOutputLine: l.programOutputLine || false
  }))), 
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
const mockProductions = [
  { _id: 1, name: 'prod-1', lines: [{ name: 'l1', id: '1', smbConferenceId: 'smb-1', programOutputLine: false }] },
  { _id: 2, name: 'prod-2', lines: [{ name: 'l2', id: '2', smbConferenceId: 'smb-2', programOutputLine: true }] },
  { _id: 3, name: 'prod-3', lines: [{ name: 'l3', id: '3', smbConferenceId: 'smb-3', programOutputLine: false }] }
];

const mockProductionManager = {
  createProduction: jest.fn().mockResolvedValue(createdProduction),
  requireProduction: jest.fn().mockImplementation(async (id: number) => {
    const found = mockProductions.find((p) => p._id === id);
    return found || { _id: id, name: `prod-${id}`, lines: [] };
  }),
  updateProduction: jest.fn().mockImplementation(async (production: any, newName: string) => ({ _id: production._id, name: newName })),
  addProductionLine: jest.fn().mockResolvedValue(undefined),
  updateProductionLine: jest.fn().mockImplementation(async (_production: any, _lineId: string, _newName: string) => ({})),
  getUsersForLine: jest.fn().mockImplementation(() => []),
  userSessions: {'mock-session': mockUserSession},
  getProductions: jest.fn().mockImplementation(async (limit: number, offset: number) => mockProductions.slice(offset, offset + limit)),
  getNumberOfProductions: jest.fn().mockResolvedValue(3),
  getLine: jest.fn().mockImplementation((lines: any[], id: string) => lines.find((l) => l.id === id)),
  updateUserLastSeen: jest.fn().mockImplementation((sessionId: string) => sessionId === 'alive-session'),
  deleteProductionLine: jest.fn().mockResolvedValue(undefined),
  deleteProduction: jest.fn().mockResolvedValue(true),
  removeUserSession: jest.fn().mockImplementation((sessionId: string) => sessionId)
} as any;

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

  afterAll(async () => {
    await server.close();
  });

  // POST request for creating a production from api endpoint
  test('can create a new production from setup values', async () => {
    const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: newProduction
    });
    expect(response.statusCode).toBe(200);
    });

  // GET request fo paginating a list of productions
  test('can paginate list of all productions', async () => {
    const response = await server.inject({ 
      method: 'GET', 
      url: '/api/v1/productionlist' 
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body.productions)).toBe(true);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.totalItems).toBe(3);
    expect(body.productions[0]).toHaveProperty('productionId');
    expect(body.productions[0]).toHaveProperty('name');
    expect(body.productions[0]).not.toHaveProperty('lines');
  });

  // GET request for a production
  test('can fetch a production with details', async () => {
    const response = await server.inject({ 
      method: 'GET', 
      url: '/api/v1/production/1' 
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.productionId).toBe('1');
    expect(Array.isArray(body.lines)).toBe(true);
  });

  // PATCH request for renaming a production
  test('can rename a production', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/production/1',
      body: { name: 'renamed' }
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.name).toBe('renamed');
    expect(body._id).toBe(1);
  }); 

  // negative test for the PATCH request renaming a production
  test("throws an error when trying to rename a non-existing production", async () => {
    mockProductionManager.requireProduction.mockImplementationOnce(async () => undefined);
    const response = await server.inject({ 
      method: 'PATCH', 
      url: '/api/v1/production/999', 
      body: { name: 'x' } 
    });
    expect(response.statusCode).toBe(404);
  });

  // GET request for getting all lines for a production
  test("can retrieve all lines from a production", async () => {
    const response = await server.inject({ 
      method: 'GET', 
      url: '/api/v1/production/1/line' 
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('participants');
  });

  // POST request for adding more lines to prouduction
  test("can add a new production line", async () => {
    const response = await server.inject({
      method: 'POST', 
      url: '/api/v1/production/1/line',
      body: { name: "newLine", programOutputLine: true}
    });
    expect(response.statusCode).toBe(200);
  });

  // GET request for getting details for a specific line
  test("can retrieve a specific line id from a production", async () => {
    const response = await server.inject({ 
      method: 'GET', 
      url: '/api/v1/production/1/line/1' 
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe('1');
    expect(Array.isArray(body.participants)).toBe(true);
  });

  // negative test for the GET request for a specific line
  test("error is thrown when trying to access a non existing line from a production", async () => {
    const response = await server.inject({ 
      method: 'GET', 
      url: '/api/v1/production/1/line/does-not-exist' 
    });
    expect(response.statusCode).toBe(404);
  });

  // PATCH request for renaming a line
  test("can modify an existing Production line", async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/production/1/line/1',
      body: { name: 'line-renamed' }
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.name).toBe('line-renamed');
    expect(body.id).toBe('1');
  });

  // negative test for the PATCH request renaming a line
  test("throws an error when trying to rename a production line that doesn't exist", async () => {
    const response = await server.inject({ 
      method: 'PATCH', 
      url: '/api/v1/production/1/line/miss', 
      body: { name: 'x' } 
    });
    expect(response.statusCode).toBe(404);
  });

  // DELETE request for removing a line from a production
  test("can delete a line from a production", async () => {
    const response = await server.inject({ 
      method: 'DELETE', 
      url: '/api/v1/production/1/line/1' 
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('deleted');
  });

  // negative test for the DELETE request removing a line from a production
  test("throws an error if trying to delete a line with active participants", async () => {
    const getUsersSpy = jest.spyOn(mockProductionManager, 'getUsersForLine');
    getUsersSpy.mockImplementationOnce(() => [{ isActive: true }]);
    const response = await server.inject({ 
      method: 'DELETE', 
      url: '/api/v1/production/1/line/1' 
    });
    expect(response.statusCode).toBe(400);
    getUsersSpy.mockRestore();
  });

  // POST request for setting up session protocol for a remote smb instance
  test("can create a session connection to a remote smb instance", async () => {
    const response = await server.inject({
      method: 'POST', 
      url: '/api/v1/session',
      body: mockNewSession
    });
    expect(response.statusCode).toBe(201);
  })

  // DELETE request for removing a production
  test("can remove a production", async () => {
    const response = await server.inject({ 
      method: 'DELETE', 
      url: '/api/v1/production/1' 
    });
    expect(response.statusCode).toBe(200);
  });

  // DELETE request for removing a session
  test("can remove a session", async () => {
    const response = await server.inject({ 
      method: 'DELETE', 
      url: '/api/v1/session/mock-session' 
    });
    expect(response.statusCode).toBe(200);
  });

  // POST request for long poll endpoint for participants
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

  // GET request for heartbeat endpoint to check if session is alive
  test("can update user session last seen", async () => {
    const response = await server.inject({ 
      method: 'GET', 
      url: '/api/v1/heartbeat/alive-session' 
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('ok');
  });

  // negative test for the GET request for heartbeat endpoint
  test("throws an error when trying to update a user session that doesn't exist", async () => {
    const response = await server.inject({ 
      method: 'GET', 
      url: '/api/v1/heartbeat/missing-session' 
    });
    expect(response.statusCode).toBe(410);
  }); 
});
 
