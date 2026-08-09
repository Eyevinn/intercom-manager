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
  saveUserSession: jest.fn().mockResolvedValue(undefined),
  getSession: jest.fn().mockResolvedValue(null),
  deleteUserSession: jest.fn().mockResolvedValue(true),
  updateSession: jest.fn().mockResolvedValue(true),
  getSessionsByQuery: jest.fn().mockResolvedValue([]),
  addPreset: jest.fn().mockResolvedValue({}),
  getPreset: jest.fn().mockResolvedValue(undefined),
  getPresets: jest.fn().mockResolvedValue([]),
  deletePreset: jest.fn().mockResolvedValue(true),
  updatePreset: jest.fn().mockResolvedValue(undefined)
};

const mockProductionManager = {
  checkUserStatus: jest.fn(),
  load: jest.fn().mockResolvedValue(undefined),
  createProduction: jest.fn().mockResolvedValue({}),
  getProductions: jest.fn().mockResolvedValue([]),
  getNumberOfProductions: jest.fn().mockResolvedValue(0),
  requireProduction: jest.fn().mockResolvedValue({}),
  updateProduction: jest.fn().mockResolvedValue({}),
  addProductionLine: jest.fn().mockResolvedValue(undefined),
  getLine: jest.fn().mockResolvedValue(undefined),
  getUsersForLine: jest.fn().mockResolvedValue([]),
  updateProductionLine: jest.fn().mockResolvedValue({}),
  deleteProductionLine: jest.fn().mockResolvedValue(undefined),
  deleteProduction: jest.fn().mockResolvedValue(true),
  removeUserSession: jest.fn().mockResolvedValue('session-id'),
  getUser: jest.fn().mockResolvedValue(undefined),
  requireLine: jest.fn().mockResolvedValue({}),
  updateUserLastSeen: jest.fn().mockResolvedValue(true),
  getProduction: jest.fn().mockResolvedValue(undefined),
  setLineId: jest.fn().mockResolvedValue(undefined),
  createUserSession: jest.fn(),
  updateUserEndpoint: jest.fn().mockResolvedValue(true),
  on: jest.fn(),
  once: jest.fn(),
  emit: jest.fn()
} as any;

const mockIngestManager = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn()
} as any;

const baseOptions = {
  title: 'my awesome service',
  smbServerBaseUrl: 'http://localhost',
  endpointIdleTimeout: '60',
  publicHost: 'https://example.com',
  dbManager: mockDbManager,
  productionManager: mockProductionManager,
  ingestManager: mockIngestManager
};

const createServer = (reAuthKey?: string) =>
  api({
    ...baseOptions,
    reAuthKey,
    coreFunctions: new CoreFunctions(
      mockProductionManager,
      new ConnectionQueue()
    )
  });

const mockTokenService = () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ token: 'a-new-sat-token' })
  });
  global.fetch = fetchMock as unknown as typeof global.fetch;
  return fetchMock;
};

describe('reAuth api', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('returns 401 without credentials when a reauth key is configured', async () => {
    const fetchMock = mockTokenService();
    const server = await createServer('secret-123');

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reauth'
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toContain('Bearer');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  test('returns 401 with a wrong bearer token', async () => {
    const fetchMock = mockTokenService();
    const server = await createServer('secret-123');

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reauth',
      headers: { authorization: 'Bearer wrong-key' }
    });

    expect(response.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns 401 with an empty bearer token', async () => {
    const fetchMock = mockTokenService();
    const server = await createServer('secret-123');

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reauth',
      headers: { authorization: 'Bearer' }
    });

    expect(response.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns 401 with a malformed authorization header (no Bearer prefix)', async () => {
    const fetchMock = mockTokenService();
    const server = await createServer('secret-123');

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reauth',
      headers: { authorization: 'secret-123' }
    });

    expect(response.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns 401 when the token is a proper prefix of the key', async () => {
    const fetchMock = mockTokenService();
    const server = await createServer('secret-123');

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reauth',
      headers: { authorization: 'Bearer secret-12' }
    });

    expect(response.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('generates a new SAT token with a correct bearer token', async () => {
    const fetchMock = mockTokenService();
    const server = await createServer('secret-123');

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reauth',
      headers: { authorization: 'Bearer secret-123' }
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.json()).toEqual({ success: true });
    expect(response.json().token).toBeUndefined();
    expect(String(response.headers['set-cookie'])).toContain(
      'eyevinn-intercom-manager.sat=Bearer%20a-new-sat-token'
    );
  });

  test('allows unauthenticated access when no reauth key is configured', async () => {
    const fetchMock = mockTokenService();
    const server = await createServer(undefined);

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reauth'
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('returns 500 when the token service is unavailable', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const server = await createServer(undefined);

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reauth'
    });

    expect(response.statusCode).toBe(500);
  });
});
