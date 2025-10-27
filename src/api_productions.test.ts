jest.mock('./log', () => ({
  Log: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));
import api from './api';
import { NewProduction, Production } from './models';

// Mocking production objects
const newProduction: NewProduction = {
  name: 'productionname',
  lines: [
    {
      name: 'linename'
    }
  ]
};

const createdProduction: Production = {
  _id: 1,
  name: 'productionname',
  lines: [
    {
      name: 'linename',
      id: '1',
      smbConferenceId: 'smbineid'
    }
  ]
};

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
  saveUserSession: jest.fn().mockResolvedValue(undefined),
  getSession: jest.fn().mockResolvedValue(null),
  deleteUserSession: jest.fn().mockResolvedValue(true),
  updateSession: jest.fn().mockResolvedValue(true),
  getSessionsByQuery: jest.fn().mockResolvedValue([])
};

const mockIngestManager = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn()
} as any;

const mockCoreFunctions = {
  getAllLinesResponse: jest.fn().mockImplementation((production) =>
    production.lines.map((l: any) => ({
      name: l.name,
      id: l.id,
      smbConferenceId: l.smbConferenceId,
      participants: l.participants || [],
      programOutputLine: l.programOutputLine || false
    }))
  ),
  createConferenceForLine: jest.fn().mockResolvedValue('mock-conference-id'),
  createEndpoint: jest.fn().mockResolvedValue({
    audio: { ssrcs: [12345], 'payload-type': {}, 'rtp-hdrexts': [] }
  }),
  createConnection: jest.fn().mockResolvedValue('sdp-offer-mock')
} as any;

const mockNewSession = {
  productionId: '1',
  lineId: '1',
  username: 'maximus'
};

const mockUserSession = {
  name: 'usersession',
  smbConferenceId: 'conferenceId',
  productionId: '1',
  lineId: '1',
  lastSeen: 2,
  endpointId: 'mock-endpoint-1',
  isActive: true,
  isExpired: false,
  isWhip: false
};

// Setting up manager mocks
const mockProductions = [
  {
    _id: 1,
    name: 'prod-1',
    lines: [
      {
        name: 'l1',
        id: '1',
        smbConferenceId: 'smb-1',
        programOutputLine: false
      }
    ]
  },
  {
    _id: 2,
    name: 'prod-2',
    lines: [
      { name: 'l2', id: '2', smbConferenceId: 'smb-2', programOutputLine: true }
    ]
  },
  {
    _id: 3,
    name: 'prod-3',
    lines: [
      {
        name: 'l3',
        id: '3',
        smbConferenceId: 'smb-3',
        programOutputLine: false
      }
    ]
  }
];

const mockProductionManager = {
  createProduction: jest.fn().mockResolvedValue(createdProduction),
  checkUserStatus: jest.fn().mockResolvedValue(undefined),
  requireProduction: jest.fn().mockImplementation(async (id: number) => {
    const found = mockProductions.find((p) => p._id === id);
    return found || { _id: id, name: `prod-${id}`, lines: [] };
  }),
  updateProduction: jest
    .fn()
    .mockImplementation(async (production: any, newName: string) => ({
      _id: production._id,
      name: newName
    })),
  addProductionLine: jest.fn().mockResolvedValue(undefined),
  updateProductionLine: jest
    .fn()
    .mockImplementation(
      async (_production: any, _lineId: string, _newName: string) => {
        return {};
      }
    ),
  getUsersForLine: jest.fn().mockImplementation(() => []),
  userSessions: { 'mock-session': mockUserSession },
  getProductions: jest
    .fn()
    .mockImplementation(async (limit: number, offset: number) =>
      mockProductions.slice(offset, offset + limit)
    ),
  getNumberOfProductions: jest.fn().mockResolvedValue(3),
  getLine: jest
    .fn()
    .mockImplementation((lines: any[], id: string) =>
      lines.find((l) => l.id === id)
    ),
  updateUserLastSeen: jest
    .fn()
    .mockImplementation((sessionId: string) => sessionId === 'alive-session'),
  deleteProductionLine: jest.fn().mockResolvedValue(undefined),
  deleteProduction: jest.fn().mockResolvedValue(true),
  removeUserSession: jest
    .fn()
    .mockImplementation((sessionId: string) => sessionId),
  createUserSession: jest.fn().mockResolvedValue(undefined),
  getActiveUsers: jest.fn().mockResolvedValue([])
} as any;

describe('Production API', () => {
  let server: any;
  let setIntervalSpy: jest.SpyInstance<any, any>;
  let consoleErrorSpy: jest.SpyInstance<any, any>; // to remove negative test errors from console (console.error)

  // uses jest spy to keep track of 'setInterval' in api_productions, otherwise won't close properly
  beforeAll(() => {
    setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(jest.fn());
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  beforeAll(async () => {
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

  // mock server teardown
  afterAll(async () => {
    await server.close();
    setIntervalSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('POST /production', () => {
    test('can create a new production from setup values', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: newProduction
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ name: 'productionname', productionId: '1' });
    });
    test('returns 400 when body is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: {}
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /productionlist', () => {
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
    test('returns 400 when query params are invalid', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/productionlist?limit=not-a-number&offset=also-bad&extended=not-bool'
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /production/:id', () => {
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
    test('returns 500 when failing to fetch a production', async () => {
      mockProductionManager.requireProduction.mockRejectedValueOnce(
        new Error('lookup error')
      );
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/production/999'
      });
      expect(response.statusCode).toBe(500);
    });
  });

  describe('PATCH /production/:id', () => {
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
    test('throws an error when trying to rename a non-existing production', async () => {
      mockProductionManager.requireProduction.mockImplementationOnce(
        async () => undefined
      );
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/production/999',
        body: { name: 'x' }
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /production/:id/line', () => {
    test('can retrieve all lines from a production', async () => {
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
    test('returns 500 when failing to retrieve lines for a production', async () => {
      mockProductionManager.requireProduction.mockRejectedValueOnce(
        new Error('not found')
      );
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/production/999/line'
      });
      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /production/:id/line', () => {
    test('can add a new production line', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production/1/line',
        body: { name: 'newLine', programOutputLine: true }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0]).toHaveProperty('id', '1');
      expect(body[0]).toHaveProperty('name', 'l1');
      expect(body[0]).toHaveProperty('participants');
    });
    test('returns 400 when adding a duplicate line name', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production/1/line',
        body: { name: 'l1', programOutputLine: false }
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /production/:id/line/:id', () => {
    test('can retrieve a specific line id from a production', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/production/1/line/1'
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('1');
      expect(Array.isArray(body.participants)).toBe(true);
    });
    test('error is thrown when trying to access a non existing line from a production', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/production/1/line/does-not-exist'
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /production/:id/line/:id', () => {
    test('can modify an existing Production line', async () => {
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
    test("throws an error when trying to rename a production line that doesn't exist", async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/production/1/line/miss',
        body: { name: 'x' }
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /production/:id/line/:id', () => {
    test('can delete a line from a production', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/production/1/line/1'
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('deleted');
    });
    test('throws an error if trying to delete a line with active participants', async () => {
      const getUsersSpy = jest.spyOn(mockProductionManager, 'getActiveUsers');
      getUsersSpy.mockResolvedValueOnce([{ lineId: '1', isActive: true }]);
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/production/1/line/1'
      });
      expect(response.statusCode).toBe(400);
      getUsersSpy.mockRestore();
    });
  });

  describe('POST /session', () => {
    test('can create a session connection to a remote smb instance', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/session',
        body: mockNewSession
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(typeof body.sessionId).toBe('string');
      expect(body.sessionId.length).toBeGreaterThan(0);
      expect(body.sdp).toBe('sdp-offer-mock');
    });
    test('returns 400 when session body is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/session',
        body: {}
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /production/:id', () => {
    test('can remove a production', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/production/1'
      });
      expect(response.statusCode).toBe(200);
    });
    test('returns 500 when production deletion fails', async () => {
      mockProductionManager.deleteProduction.mockResolvedValueOnce(false);
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/production/1'
      });
      expect(response.statusCode).toBe(500);
    });
  });

  describe('DELETE /session/:id', () => {
    test('can remove a session', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/session/mock-session'
      });
      expect(response.statusCode).toBe(200);
    });
    test('returns 500 when session deletion fails', async () => {
      const removeSpy = jest
        .spyOn(mockDbManager, 'deleteUserSession')
        .mockResolvedValueOnce(false);
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/session/mock-session'
      });
      expect(response.statusCode).toBe(500);
      removeSpy.mockRestore();
    });
  });

  describe('POST /production/:id/line/:id/participants', () => {
    test('can do long polling for change in line participants', async () => {
      mockProductionManager.once = jest
        .fn()
        .mockImplementation((event, callback) => {
          if (event === 'users:change') {
            callback();
          }
        });
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production/1/line/1/participants'
      });
      expect(response.statusCode).toBe(200);
      const body = response.body ? JSON.parse(response.body) : [];
      expect(Array.isArray(body)).toBe(true);
    });
    test('returns 500 when long poll fails due to internal error', async () => {
      const sessionsSpy = jest
        .spyOn(mockDbManager, 'getSessionsByQuery')
        .mockImplementationOnce(() => {
          throw new Error('read error');
        });
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production/1/line/1/participants'
      });
      expect(response.statusCode).toBe(500);
      sessionsSpy.mockRestore();
    });
  });

  describe('GET /heartbeat/:status', () => {
    test('can update user session last seen', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/heartbeat/alive-session'
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('ok');
    });
    test("throws an error when trying to update a user session that doesn't exist", async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/heartbeat/missing-session'
      });
      expect(response.statusCode).toBe(410);
    });
  });
});
