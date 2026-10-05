import Fastify, { FastifyInstance } from 'fastify';
import { requireApiKey } from './auth';

// Build a minimal Fastify instance with a single route guarded by the
// requireApiKey preHandler so the hook can be exercised end-to-end via inject.
const createServer = async (): Promise<FastifyInstance> => {
  const app = Fastify();
  app.post('/protected', { preHandler: requireApiKey }, async (_req, reply) => {
    reply.code(200).send({ ok: true });
  });
  await app.ready();
  return app;
};

describe('requireApiKey preHandler (#222)', () => {
  const originalApiKey = process.env.API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = originalApiKey;
    }
  });

  test('allows the request through when API_KEY is unset (auth disabled)', async () => {
    delete process.env.API_KEY;
    const server = await createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/protected'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    await server.close();
  });

  test('allows the request through when API_KEY is empty/whitespace', async () => {
    process.env.API_KEY = '   ';
    const server = await createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/protected'
    });

    expect(response.statusCode).toBe(200);

    await server.close();
  });

  test('returns 401 when the Authorization header is missing', async () => {
    process.env.API_KEY = 'secret-123';
    const server = await createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/protected'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized' });

    await server.close();
  });

  test('returns 401 with a wrong bearer token', async () => {
    process.env.API_KEY = 'secret-123';
    const server = await createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/protected',
      headers: { authorization: 'Bearer wrong-key' }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized' });

    await server.close();
  });

  test('returns 401 with a malformed authorization header (no Bearer prefix)', async () => {
    process.env.API_KEY = 'secret-123';
    const server = await createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/protected',
      headers: { authorization: 'secret-123' }
    });

    expect(response.statusCode).toBe(401);

    await server.close();
  });

  test('returns 401 when the token is a proper prefix of the key', async () => {
    process.env.API_KEY = 'secret-123';
    const server = await createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/protected',
      headers: { authorization: 'Bearer secret-12' }
    });

    expect(response.statusCode).toBe(401);

    await server.close();
  });

  test('passes the request through with a correct Bearer token', async () => {
    process.env.API_KEY = 'secret-123';
    const server = await createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/protected',
      headers: { authorization: 'Bearer secret-123' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    await server.close();
  });
});
