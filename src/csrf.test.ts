import Fastify, { FastifyInstance } from 'fastify';
import { createCsrfOriginHook } from './csrf';

jest.mock('./log', () => ({
  Log: () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  })
}));

// Build a minimal app with the CSRF onRequest hook registered on the root
// instance (mirroring how api.ts wires it) plus a couple of routes covering a
// state-mutating method and a safe method. The hook resolves the allowlist from
// the environment when it is created, so each test sets CSRF_TRUSTED_ORIGINS
// before building the app.
const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify();
  app.addHook('onRequest', createCsrfOriginHook());
  app.post('/api/v1/productions', async () => ({ ok: true }));
  app.delete('/api/v1/productions/1', async () => ({ ok: true }));
  app.get('/api/v1/productions', async () => ({ ok: true }));
  app.post('/api/v1/whip/abc', async () => ({ ok: true }));
  await app.ready();
  return app;
};

describe('CSRF Origin/Referer verification hook', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('allows a state-mutating request with no Origin/Referer header', async () => {
    process.env.CSRF_TRUSTED_ORIGINS = 'https://app.example.com';
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/productions'
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('allows a request whose Origin is in the allowlist', async () => {
    process.env.CSRF_TRUSTED_ORIGINS =
      'https://app.example.com,https://other.example.com';
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/productions',
      headers: { origin: 'https://app.example.com' }
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('allows a request whose Origin (with trailing slash) matches after normalization', async () => {
    process.env.CSRF_TRUSTED_ORIGINS = 'https://app.example.com/';
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/productions',
      headers: { origin: 'https://app.example.com' }
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects a state-mutating request whose Origin is not in the allowlist', async () => {
    process.env.CSRF_TRUSTED_ORIGINS = 'https://app.example.com';
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/productions',
      headers: { origin: 'https://evil.example.com' }
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('falls back to the Referer origin and rejects a disallowed one', async () => {
    process.env.CSRF_TRUSTED_ORIGINS = 'https://app.example.com';
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/productions/1',
      headers: { referer: 'https://evil.example.com/some/path' }
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('never blocks GET requests, even from a disallowed origin', async () => {
    process.env.CSRF_TRUSTED_ORIGINS = 'https://app.example.com';
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/productions',
      headers: { origin: 'https://evil.example.com' }
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('is a no-op when CSRF_TRUSTED_ORIGINS is unset (allows any origin)', async () => {
    delete process.env.CSRF_TRUSTED_ORIGINS;
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/productions',
      headers: { origin: 'https://evil.example.com' }
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('exempts WHIP routes from the Origin check', async () => {
    process.env.CSRF_TRUSTED_ORIGINS = 'https://app.example.com';
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/whip/abc',
      headers: { origin: 'https://evil.example.com' }
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
