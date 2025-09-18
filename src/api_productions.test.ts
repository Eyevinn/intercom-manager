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

  // GET endpoints
  test('GET /productionlist returns default ProductionListResponse', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/productionlist' });
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

  test('GET /productionlist respects limit and offset', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/productionlist?limit=1&offset=1' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(1);
    expect(body.totalItems).toBe(3);
    expect(body.productions.length).toBe(1);
    expect(body.productions[0].name).toBe('prod-2');
  });

  test('GET /productionlist with extended=true includes lines', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/productionlist?extended=true' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body.productions)).toBe(true);
    expect(body.productions[0]).toHaveProperty('lines');
    expect(Array.isArray(body.productions[0].lines)).toBe(true);
  });

  test('GET /production (deprecated) returns minimal list', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/production' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toHaveProperty('productionId');
    expect(body[0]).toHaveProperty('name');
  });

  test('GET /production/:productionId returns detailed production', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/production/1' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.productionId).toBe('1');
    expect(Array.isArray(body.lines)).toBe(true);
  });

  test('GET /production/:productionId/line returns all lines', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/production/1/line' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('participants');
  });

  test('GET /production/:productionId/line/:lineId returns line details', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/production/1/line/1' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe('1');
    expect(Array.isArray(body.participants)).toBe(true);
  });

  test('GET /production/:productionId/line/:lineId returns 404 when missing', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/production/1/line/does-not-exist' });
    expect(response.statusCode).toBe(404);
  });

  test('GET /heartbeat/:sessionId returns ok for alive session', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/heartbeat/alive-session' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('ok');
  });

  test('GET /heartbeat/:sessionId returns 410 for missing session', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/heartbeat/missing-session' });
    expect(response.statusCode).toBe(410);
  });

  // PATCH endpoints
  test('PATCH /production/:productionId renames a production', async () => {
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

  test('PATCH /production/:productionId returns 404 when production missing', async () => {
    mockProductionManager.requireProduction.mockImplementationOnce(async () => undefined);
    const response = await server.inject({ method: 'PATCH', url: '/api/v1/production/999', body: { name: 'x' } });
    expect(response.statusCode).toBe(404);
  });

  test('PATCH /production/:productionId/line/:lineId renames a line', async () => {
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

  test('PATCH /production/:productionId/line/:lineId returns 404 when line missing', async () => {
    const response = await server.inject({ method: 'PATCH', url: '/api/v1/production/1/line/miss', body: { name: 'x' } });
    expect(response.statusCode).toBe(404);
  });

  // DELETE endpoints
  test('DELETE /production/:productionId/line/:lineId deletes a line without active participants', async () => {
    const response = await server.inject({ method: 'DELETE', url: '/api/v1/production/1/line/1' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('deleted');
  });

  test('DELETE /production/:productionId/line/:lineId returns 400 if active participants exist', async () => {
    const getUsersSpy = jest.spyOn(mockProductionManager, 'getUsersForLine');
    getUsersSpy.mockImplementationOnce(() => [{ isActive: true }]);
    const response = await server.inject({ method: 'DELETE', url: '/api/v1/production/1/line/1' });
    expect(response.statusCode).toBe(400);
    getUsersSpy.mockRestore();
  });

  test('DELETE /production/:productionId removes a production', async () => {
    const response = await server.inject({ method: 'DELETE', url: '/api/v1/production/1' });
    expect(response.statusCode).toBe(200);
  });

  test('DELETE /session/:sessionId removes a session', async () => {
    const response = await server.inject({ method: 'DELETE', url: '/api/v1/session/mock-session' });
    expect(response.statusCode).toBe(200);
  });
});
 
