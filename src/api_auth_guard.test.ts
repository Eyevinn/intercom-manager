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

// Minimal manager mocks — requireApiKey rejects in the preHandler before any
// handler runs, so the managers only need to satisfy api() construction.
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
    title: 'auth-guard-test',
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

// Previously-unguarded production/session mutation endpoints that must now
// reject unauthenticated requests when API_KEY is set (#222). These requests
// carry no Origin/Referer header, so the CSRF hook lets them through. Each
// payload is schema-valid so the request clears body validation (which runs
// before preHandler in Fastify) and reaches the requireApiKey guard, proving
// it is the guard — not schema validation — that rejects with 401.
const guardedRoutes: { method: string; url: string; payload?: unknown }[] = [
  {
    method: 'POST',
    url: '/api/v1/production/1/line',
    payload: { name: 'Line X' }
  },
  {
    method: 'PATCH',
    url: '/api/v1/production/1/line/line-a',
    payload: { name: 'Line X' }
  },
  { method: 'DELETE', url: '/api/v1/production/1/line/line-a' },
  {
    method: 'POST',
    url: '/api/v1/production/1/line/line-a/participants/sess-1/disconnect'
  },
  {
    method: 'PATCH',
    url: '/api/v1/session/sess-1',
    payload: { sdpAnswer: 'v=0' }
  }
];

describe('management endpoints require API key when API_KEY is set (#222)', () => {
  const originalApiKey = process.env.API_KEY;

  beforeAll(() => {
    process.env.API_KEY = 'secret-guard-test';
  });

  afterAll(() => {
    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = originalApiKey;
    }
  });

  it.each(guardedRoutes)(
    'rejects unauthenticated $method $url with 401',
    async ({ method, url, payload }) => {
      const server = await buildServer();

      const response = await server.inject({
        method: method as any,
        url,
        payload: payload ?? {}
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });

      await server.close();
    }
  );

  it('allows an authenticated request past the API key guard', async () => {
    const server = await buildServer();

    // With a valid Bearer token the requireApiKey guard passes; the request
    // then fails downstream (no such production), i.e. it is no longer a 401.
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/production/1/line',
      headers: { authorization: 'Bearer secret-guard-test' },
      payload: { name: 'Line X' }
    });

    expect(response.statusCode).not.toBe(401);

    await server.close();
  });
});
