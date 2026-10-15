jest.mock('./log', () => ({
  Log: () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  })
}));

import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';

const mockDbManager = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  getProductions: jest.fn().mockResolvedValue([]),
  getProductionsLength: jest.fn().mockResolvedValue(0)
} as any;

const mockProductionManager = {
  load: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  once: jest.fn(),
  emit: jest.fn()
} as any;

const mockIngestManager = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn()
} as any;

const buildServer = () =>
  api({
    title: 'permissions-test',
    smbServerBaseUrl: 'http://localhost',
    endpointIdleTimeout: '60',
    publicHost: 'http://localhost',
    dbManager: mockDbManager,
    productionManager: mockProductionManager,
    ingestManager: mockIngestManager,
    coreFunctions: new CoreFunctions(
      mockProductionManager,
      new ConnectionQueue()
    )
  });

describe('POST /api/v1/permissions (#123)', () => {
  const ENV_KEYS = [
    'ROLE_ADMIN_PASSWORD',
    'ROLE_EDITOR_PASSWORD',
    'ROLE_PARTICIPANT_PASSWORD'
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
    }
    process.env.ROLE_ADMIN_PASSWORD = 'admin-pw';
    process.env.ROLE_EDITOR_PASSWORD = 'editor-pw';
    process.env.ROLE_PARTICIPANT_PASSWORD = 'participant-pw';
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  it('returns the admin role and feature flags for the admin password', async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/permissions',
      payload: { password: 'admin-pw' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.role).toBe('admin');
    expect(body.features.canDeleteProduction).toBe(true);
    expect(body.features.canJoinLine).toBe(true);

    await server.close();
  });

  it('returns the participant role with a restricted feature set', async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/permissions',
      payload: { password: 'participant-pw' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.role).toBe('participant');
    expect(body.features.canCreateProduction).toBe(false);
    expect(body.features.canJoinLine).toBe(true);

    await server.close();
  });

  it('rejects an invalid password with 401', async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/permissions',
      payload: { password: 'wrong' }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      message: 'Invalid or unknown role password'
    });

    await server.close();
  });

  it('rejects a request with a missing password via schema validation (400)', async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/permissions',
      payload: {}
    });

    expect(response.statusCode).toBe(400);

    await server.close();
  });
});
