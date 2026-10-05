jest.mock('./log', () => ({
  Log: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));

import api from './api';
import { MockSmbProtocol } from './mock-smb-protocol';
import { ProductionManager } from './production_manager';

const production = {
  _id: 1,
  name: 'prod-1',
  lines: [
    { name: 'l1', id: '1', smbConferenceId: 'conf-1', programOutputLine: false }
  ]
};

const targetSession = {
  _id: 'session-1',
  name: 'kick-me',
  smbConferenceId: 'conf-1',
  productionId: '1',
  lineId: '1',
  lastSeen: Date.now(),
  endpointId: 'ep-1',
  isActive: true,
  isExpired: false,
  isWhip: false
};

const mockDbManager = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  getProduction: jest
    .fn()
    .mockImplementation(async (id: number) =>
      id === 1 ? production : undefined
    ),
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
  getSession: jest.fn().mockResolvedValue(targetSession),
  deleteUserSession: jest.fn().mockResolvedValue(true),
  updateSession: jest.fn().mockResolvedValue(true),
  getSessionsByQuery: jest.fn().mockResolvedValue([]),
  addPreset: jest.fn().mockResolvedValue({}),
  getPreset: jest.fn().mockResolvedValue(undefined),
  getPresets: jest.fn().mockResolvedValue([]),
  deletePreset: jest.fn().mockResolvedValue(true),
  updatePreset: jest.fn().mockResolvedValue(undefined),
  addShareLink: jest.fn().mockResolvedValue({}),
  getShareLink: jest.fn().mockResolvedValue(undefined),
  deleteShareLink: jest.fn().mockResolvedValue(true)
} as any;

const mockIngestManager = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn()
} as any;

const mockCoreFunctions = {
  getAllLinesResponse: jest.fn().mockResolvedValue([]),
  createConferenceForLine: jest.fn().mockResolvedValue('conf-1'),
  createEndpoint: jest.fn().mockResolvedValue({}),
  createConnection: jest.fn().mockResolvedValue('sdp-offer')
} as any;

const DISCONNECT_URL =
  '/api/v1/production/1/line/1/participants/session-1/disconnect';

describe('POST /production/:id/line/:lineId/participants/:sessionId/disconnect', () => {
  let server: any;
  let productionManager: ProductionManager;
  let smb: MockSmbProtocol;
  let setIntervalSpy: jest.SpyInstance<any, any>;
  let consoleErrorSpy: jest.SpyInstance<any, any>;

  beforeAll(async () => {
    setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(jest.fn());
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    smb = new MockSmbProtocol();
    productionManager = new ProductionManager(mockDbManager);

    server = await api({
      title: 'force-disconnect-test',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager,
      ingestManager: mockIngestManager,
      coreFunctions: mockCoreFunctions,
      smb
    });
  });

  afterAll(async () => {
    await server.close();
    setIntervalSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbManager.getProduction.mockImplementation(async (id: number) =>
      id === 1 ? production : undefined
    );
    mockDbManager.getSession.mockResolvedValue(targetSession);
    mockDbManager.deleteUserSession.mockResolvedValue(true);
  });

  it('expires the endpoint, removes the session and returns 200', async () => {
    const deleteEndpointSpy = jest
      .spyOn(smb, 'deleteEndpoint')
      .mockResolvedValue(undefined);
    const emitSpy = jest.spyOn(productionManager, 'emit');

    const response = await server.inject({
      method: 'POST',
      url: DISCONNECT_URL
    });

    expect(response.statusCode).toBe(200);
    expect(deleteEndpointSpy).toHaveBeenCalledWith(
      expect.stringContaining('/conferences/'),
      'conf-1',
      'ep-1',
      ''
    );
    expect(mockDbManager.deleteUserSession).toHaveBeenCalledWith('session-1');
    expect(emitSpy).toHaveBeenCalledWith('users:change');

    deleteEndpointSpy.mockRestore();
  });

  it('still removes the session when SMB endpoint expiry fails', async () => {
    const deleteEndpointSpy = jest
      .spyOn(smb, 'deleteEndpoint')
      .mockRejectedValue(new Error('smb unreachable'));

    const response = await server.inject({
      method: 'POST',
      url: DISCONNECT_URL
    });

    expect(response.statusCode).toBe(200);
    expect(mockDbManager.deleteUserSession).toHaveBeenCalledWith('session-1');

    deleteEndpointSpy.mockRestore();
  });

  it('returns 404 when the session does not exist', async () => {
    mockDbManager.getSession.mockResolvedValueOnce(null);

    const response = await server.inject({
      method: 'POST',
      url: DISCONNECT_URL
    });

    expect(response.statusCode).toBe(404);
    expect(mockDbManager.deleteUserSession).not.toHaveBeenCalled();
  });

  it('returns 404 when the session belongs to a different line', async () => {
    mockDbManager.getSession.mockResolvedValueOnce({
      ...targetSession,
      lineId: '2'
    });

    const response = await server.inject({
      method: 'POST',
      url: DISCONNECT_URL
    });

    expect(response.statusCode).toBe(404);
    expect(mockDbManager.deleteUserSession).not.toHaveBeenCalled();
  });

  it('returns 404 when the line does not exist', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/production/1/line/999/participants/session-1/disconnect'
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 when the production does not exist', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/production/999/line/1/participants/session-1/disconnect'
    });

    expect(response.statusCode).toBe(404);
    expect(mockDbManager.deleteUserSession).not.toHaveBeenCalled();
  });

  it('returns 404 when the session belongs to a different production', async () => {
    mockDbManager.getSession.mockResolvedValueOnce({
      ...targetSession,
      productionId: '2'
    });

    const response = await server.inject({
      method: 'POST',
      url: DISCONNECT_URL
    });

    expect(response.statusCode).toBe(404);
    expect(mockDbManager.deleteUserSession).not.toHaveBeenCalled();
  });

  it('returns 404 when the session was already removed (idempotent no-op)', async () => {
    const deleteEndpointSpy = jest
      .spyOn(smb, 'deleteEndpoint')
      .mockResolvedValue(undefined);
    mockDbManager.deleteUserSession.mockResolvedValueOnce(false);

    const response = await server.inject({
      method: 'POST',
      url: DISCONNECT_URL
    });

    expect(response.statusCode).toBe(404);

    deleteEndpointSpy.mockRestore();
  });
});
