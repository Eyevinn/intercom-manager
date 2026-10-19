import rateLimit from '@fastify/rate-limit';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify from 'fastify';
import apiShare from './api_share';

jest.mock('./log');

// Minimal dbManager mock — requireApiKey rejects in the preHandler before any
// handler runs for the guarded routes, so these only need to satisfy the share
// plugin's handlers for the paths that do reach them (the public GET and the
// authenticated POST).
const mockDbManager = {
  addShareLink: jest
    .fn()
    .mockResolvedValue({ _id: 'share-1', path: '/foo', createdAt: 0 }),
  getShareLink: jest.fn().mockResolvedValue(null),
  deleteShareLink: jest.fn().mockResolvedValue(false)
} as any;

// Drive the share plugin directly the way api_rate_limit.test.ts's
// createShareServer does: register @fastify/rate-limit with { global: false }
// first (the share routes declare per-route rateLimit config), then the plugin
// under the api/v1 prefix with a publicHost and the mock dbManager.
const createShareServer = async () => {
  const fastify = Fastify().withTypeProvider<TypeBoxTypeProvider>();
  await fastify.register(rateLimit, { global: false });
  fastify.register(apiShare, {
    prefix: 'api/v1',
    publicHost: 'https://example.com',
    dbManager: mockDbManager
  });
  await fastify.ready();
  return fastify;
};

// The two mutating /share endpoints persist/revoke share links and must reject
// unauthenticated requests when API_KEY is set (#399). The public GET /share/:id
// redemption endpoint must stay unauthenticated. Each payload is schema-valid so
// the request clears body validation (which runs before preHandler in Fastify)
// and reaches the requireApiKey guard, proving it is the guard — not schema
// validation — that rejects with 401.
describe('share mutation endpoints require API key when API_KEY is set (#399)', () => {
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

  it('rejects unauthenticated POST /api/v1/share with 401', async () => {
    const server = await createShareServer();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/share',
      payload: { path: '/foo', reusable: true }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized' });

    await server.close();
  });

  it('rejects unauthenticated DELETE /api/v1/share/:id with 401', async () => {
    const server = await createShareServer();

    const response = await server.inject({
      method: 'DELETE',
      url: '/api/v1/share/some-id'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized' });

    await server.close();
  });

  it('does not reject GET /api/v1/share/:id with 401 (stays public)', async () => {
    const server = await createShareServer();

    // The GET redemption path must remain unauthenticated. With a missing link
    // the handler yields 404, proving the request reached the handler rather
    // than being rejected by the guard with 401.
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/share/some-id'
    });

    expect(response.statusCode).not.toBe(401);
    expect(response.statusCode).toBe(404);

    await server.close();
  });

  it('allows an authenticated POST /api/v1/share past the API key guard', async () => {
    const server = await createShareServer();

    // With a valid Bearer token the requireApiKey guard passes; the request
    // then reaches the handler, i.e. it is no longer a 401.
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/share',
      headers: { authorization: 'Bearer secret-guard-test' },
      payload: { path: '/foo', reusable: true }
    });

    expect(response.statusCode).not.toBe(401);

    await server.close();
  });
});
