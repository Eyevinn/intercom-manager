import Fastify, { FastifyInstance } from 'fastify';
import {
  createAuthHook,
  getRoleFeatures,
  isAuthRequired,
  resolveRoleFromPassword
} from './roles';

describe('resolveRoleFromPassword (#123)', () => {
  const ENV_KEYS = [
    'ROLE_ADMIN_PASSWORD',
    'ROLE_EDITOR_PASSWORD',
    'ROLE_PARTICIPANT_PASSWORD'
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  test('resolves each configured password to its role', () => {
    process.env.ROLE_ADMIN_PASSWORD = 'admin-pw';
    process.env.ROLE_EDITOR_PASSWORD = 'editor-pw';
    process.env.ROLE_PARTICIPANT_PASSWORD = 'participant-pw';

    expect(resolveRoleFromPassword('admin-pw')).toBe('admin');
    expect(resolveRoleFromPassword('editor-pw')).toBe('editor');
    expect(resolveRoleFromPassword('participant-pw')).toBe('participant');
  });

  test('returns null for an unknown password', () => {
    process.env.ROLE_ADMIN_PASSWORD = 'admin-pw';
    expect(resolveRoleFromPassword('nope')).toBeNull();
  });

  test('returns null for an empty password', () => {
    process.env.ROLE_ADMIN_PASSWORD = 'admin-pw';
    expect(resolveRoleFromPassword('')).toBeNull();
  });

  test('a role whose env var is unset is unavailable', () => {
    // Only editor is configured; admin/participant passwords resolve to null.
    process.env.ROLE_EDITOR_PASSWORD = 'editor-pw';
    expect(resolveRoleFromPassword('anything')).toBeNull();
    expect(resolveRoleFromPassword('editor-pw')).toBe('editor');
  });

  test('a role configured with an empty/whitespace env var is unavailable', () => {
    process.env.ROLE_ADMIN_PASSWORD = '   ';
    expect(resolveRoleFromPassword('   ')).toBeNull();
  });

  test('the more privileged role wins when passwords collide', () => {
    process.env.ROLE_ADMIN_PASSWORD = 'same';
    process.env.ROLE_PARTICIPANT_PASSWORD = 'same';
    expect(resolveRoleFromPassword('same')).toBe('admin');
  });
});

describe('getRoleFeatures (#123)', () => {
  test('admin can do everything', () => {
    const features = getRoleFeatures('admin');
    expect(Object.values(features).every((v) => v === true)).toBe(true);
  });

  test('participant can only join a line', () => {
    expect(getRoleFeatures('participant')).toEqual({
      canCreateProduction: false,
      canEditProduction: false,
      canDeleteProduction: false,
      canManageLines: false,
      canRemoveParticipants: false,
      canManageIngests: false,
      canJoinLine: true
    });
  });

  test('editor manages content but cannot delete productions', () => {
    const features = getRoleFeatures('editor');
    expect(features.canCreateProduction).toBe(true);
    expect(features.canManageLines).toBe(true);
    expect(features.canDeleteProduction).toBe(false);
  });
});

describe('createAuthHook opt-in behaviour (#123)', () => {
  const originalRequireAuth = process.env.REQUIRE_AUTH;
  const originalAdminPw = process.env.ROLE_ADMIN_PASSWORD;

  const createServer = async (): Promise<FastifyInstance> => {
    const app = Fastify();
    app.addHook('onRequest', createAuthHook());
    app.get('/', async (_req, reply) => reply.send('ok'));
    app.get('/api/v1/protected', async (_req, reply) =>
      reply.send({ ok: true })
    );
    app.post('/api/v1/permissions', async (_req, reply) =>
      reply.send({ reached: true })
    );
    await app.ready();
    return app;
  };

  afterEach(() => {
    if (originalRequireAuth === undefined) {
      delete process.env.REQUIRE_AUTH;
    } else {
      process.env.REQUIRE_AUTH = originalRequireAuth;
    }
    if (originalAdminPw === undefined) {
      delete process.env.ROLE_ADMIN_PASSWORD;
    } else {
      process.env.ROLE_ADMIN_PASSWORD = originalAdminPw;
    }
  });

  test('isAuthRequired reflects REQUIRE_AUTH', () => {
    process.env.REQUIRE_AUTH = 'true';
    expect(isAuthRequired()).toBe(true);
    process.env.REQUIRE_AUTH = 'false';
    expect(isAuthRequired()).toBe(false);
    delete process.env.REQUIRE_AUTH;
    expect(isAuthRequired()).toBe(false);
  });

  test('passes everything through when REQUIRE_AUTH is unset (default)', async () => {
    delete process.env.REQUIRE_AUTH;
    process.env.ROLE_ADMIN_PASSWORD = 'admin-pw';
    const server = await createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/protected'
    });

    expect(response.statusCode).toBe(200);
    await server.close();
  });

  test('rejects an unauthenticated request with 401 when enabled', async () => {
    process.env.REQUIRE_AUTH = 'true';
    process.env.ROLE_ADMIN_PASSWORD = 'admin-pw';
    const server = await createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/protected'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized' });
    await server.close();
  });

  test('allows a request with a valid role password when enabled', async () => {
    process.env.REQUIRE_AUTH = 'true';
    process.env.ROLE_ADMIN_PASSWORD = 'admin-pw';
    const server = await createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { authorization: 'Bearer admin-pw' }
    });

    expect(response.statusCode).toBe(200);
    await server.close();
  });

  test('keeps the health check and /permissions reachable when enabled', async () => {
    process.env.REQUIRE_AUTH = 'true';
    process.env.ROLE_ADMIN_PASSWORD = 'admin-pw';
    const server = await createServer();

    const health = await server.inject({ method: 'GET', url: '/' });
    expect(health.statusCode).toBe(200);

    const permissions = await server.inject({
      method: 'POST',
      url: '/api/v1/permissions',
      payload: { password: 'whatever' }
    });
    expect(permissions.statusCode).toBe(200);

    await server.close();
  });
});
