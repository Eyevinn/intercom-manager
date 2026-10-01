import rateLimit from '@fastify/rate-limit';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify from 'fastify';
import apiReAuth from './api_re_auth';
import { getApiProductions } from './api_productions';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';

// These tests exercise the per-route rate limits added for issue #201. They
// register the plugins directly with @fastify/rate-limit (global: false),
// mirroring the harness used in api_whip.test.ts, so they do not depend on the
// full app wiring.

const mockProductionManager = {
  updateUserLastSeen: jest.fn().mockResolvedValue(true),
  checkUserStatus: jest.fn().mockResolvedValue(undefined),
  requireProduction: jest.fn().mockResolvedValue({ lines: [] }),
  getLine: jest.fn().mockResolvedValue(undefined),
  once: jest.fn(),
  emit: jest.fn()
} as any;

const mockDbManager = {
  getSessionsByQuery: jest.fn().mockResolvedValue([])
} as any;

const coreFunctions = new CoreFunctions(
  mockProductionManager,
  new ConnectionQueue()
);

// The reauth handler exchanges OSC_ACCESS_TOKEN for a service token via fetch
// and stores it in a cookie. Rate limiting runs in the onRequest hook, before
// the handler, so we stub fetch to resolve instantly (no network, no retry
// sleeps) and decorate reply.cookie (the real @fastify/cookie plugin cannot be
// loaded under this Jest config) so the handler completes fast and the test is
// deterministic.
const originalFetch = global.fetch;

const createReAuthServer = async () => {
  const fastify = Fastify().withTypeProvider<TypeBoxTypeProvider>();
  fastify.decorateReply('cookie', function (this: any) {
    return this;
  });
  await fastify.register(rateLimit, { global: false });
  fastify.register(apiReAuth, { prefix: 'api/v1' });
  await fastify.ready();
  return fastify;
};

const createProductionsServer = async () => {
  const fastify = Fastify().withTypeProvider<TypeBoxTypeProvider>();
  await fastify.register(rateLimit, { global: false });
  fastify.register(getApiProductions(), {
    prefix: 'api/v1',
    smbServerBaseUrl: 'http://localhost',
    endpointIdleTimeout: '60',
    smbServerApiKey: 'dummy-key',
    dbManager: mockDbManager,
    productionManager: mockProductionManager,
    coreFunctions
  });
  await fastify.ready();
  return fastify;
};

describe('rate limiting (#201)', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ token: 'mock-token' })
    }) as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  describe('GET /api/v1/reauth', () => {
    it('allows requests under the 5/min limit', async () => {
      const fastify = await createReAuthServer();

      for (let i = 0; i < 5; i++) {
        const response = await fastify.inject({
          method: 'GET',
          url: '/api/v1/reauth'
        });
        expect(response.statusCode).not.toBe(429);
      }

      await fastify.close();
    });

    it('returns 429 once the 5/min limit is exceeded', async () => {
      const fastify = await createReAuthServer();

      for (let i = 0; i < 5; i++) {
        await fastify.inject({ method: 'GET', url: '/api/v1/reauth' });
      }

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/v1/reauth'
      });

      expect(response.statusCode).toBe(429);
      expect(JSON.parse(response.body)).toEqual(
        expect.objectContaining({
          error: expect.stringMatching(/Too many/i)
        })
      );

      await fastify.close();
    });
  });

  describe('GET /api/v1/heartbeat/:sessionId', () => {
    it('allows requests under the 10/min limit', async () => {
      const fastify = await createProductionsServer();

      for (let i = 0; i < 10; i++) {
        const response = await fastify.inject({
          method: 'GET',
          url: '/api/v1/heartbeat/session-1'
        });
        expect(response.statusCode).not.toBe(429);
      }

      await fastify.close();
    });

    it('returns 429 once the 10/min limit is exceeded', async () => {
      const fastify = await createProductionsServer();

      for (let i = 0; i < 10; i++) {
        await fastify.inject({
          method: 'GET',
          url: '/api/v1/heartbeat/session-1'
        });
      }

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/v1/heartbeat/session-1'
      });

      expect(response.statusCode).toBe(429);
      expect(JSON.parse(response.body)).toEqual(
        expect.objectContaining({
          error: expect.stringMatching(/Too many/i)
        })
      );

      await fastify.close();
    });
  });
});
