import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { resolveTrustProxy } from './trust-proxy';

describe('resolveTrustProxy', () => {
  it('defaults to false when unset, empty or "false"', () => {
    expect(resolveTrustProxy(undefined)).toBe(false);
    expect(resolveTrustProxy('')).toBe(false);
    expect(resolveTrustProxy('  ')).toBe(false);
    expect(resolveTrustProxy('false')).toBe(false);
  });

  it('parses true and address lists', () => {
    expect(resolveTrustProxy('true')).toBe(true);
    expect(resolveTrustProxy('10.0.0.0/8, 172.16.0.1')).toEqual([
      '10.0.0.0/8',
      '172.16.0.1'
    ]);
  });
});

describe('rate limit key behind a reverse proxy (#426)', () => {
  const build = async (trustProxy: boolean | string[]) => {
    const app = Fastify({ trustProxy });
    await app.register(rateLimit, { global: false });
    app.get(
      '/limited',
      { config: { rateLimit: { max: 1, timeWindow: '1 minute' } } },
      async () => ({ ok: true })
    );
    await app.ready();
    return app;
  };
  const call = (app: Awaited<ReturnType<typeof build>>, client: string) =>
    app.inject({
      method: 'GET',
      url: '/limited',
      remoteAddress: '172.18.0.2',
      headers: { 'x-forwarded-for': client }
    });

  it('shares one budget across clients when the proxy is not trusted', async () => {
    const app = await build(false);
    expect((await call(app, '1.1.1.1')).statusCode).toBe(200);
    expect((await call(app, '2.2.2.2')).statusCode).toBe(429);
    await app.close();
  });

  it('gives distinct clients distinct budgets when the proxy is trusted', async () => {
    const app = await build(resolveTrustProxy('172.18.0.0/16') as string[]);
    expect((await call(app, '1.1.1.1')).statusCode).toBe(200);
    expect((await call(app, '2.2.2.2')).statusCode).toBe(200);
    expect((await call(app, '1.1.1.1')).statusCode).toBe(429);
    await app.close();
  });
});
