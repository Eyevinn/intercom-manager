import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';

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
  hasActiveSessions: jest.fn().mockResolvedValue(false),
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

describe('api', () => {
  it('responds with hello, world!', async () => {
    const server = await api({
      title: 'my awesome service',
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
    const response = await server.inject({
      method: 'GET',
      url: '/'
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('Hello, world! I am my awesome service');
  });
});

describe('security headers (CSP)', () => {
  const buildServer = () =>
    api({
      title: 'my awesome service',
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

  // The global helmet CSP is registered via an onRequest hook; swagger-ui's
  // `staticCSP: true` registers an encapsulated onSend hook scoped to
  // /api/docs that overrides it there only. These two tests lock in both
  // halves of that interaction so a future refactor cannot silently weaken
  // the API policy or break the docs page.
  it('applies the strict baseline CSP to API routes', async () => {
    const server = await buildServer();
    const response = await server.inject({ method: 'GET', url: '/' });
    const csp = response.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('does not leak the strict policy onto the Swagger docs page', async () => {
    const server = await buildServer();
    const response = await server.inject({ method: 'GET', url: '/api/docs/' });
    const csp = response.headers['content-security-policy'] as string;
    expect(response.statusCode).toBe(200);
    // Swagger UI emits its own policy so the docs page keeps working.
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("default-src 'none'");
  });
});

describe('Swagger docs gating', () => {
  const buildServer = () =>
    api({
      title: 'my awesome service',
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

  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnableSwagger = process.env.ENABLE_SWAGGER;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalEnableSwagger === undefined) {
      delete process.env.ENABLE_SWAGGER;
    } else {
      process.env.ENABLE_SWAGGER = originalEnableSwagger;
    }
  });

  it('registers /api/docs by default (non-production)', async () => {
    delete process.env.NODE_ENV;
    delete process.env.ENABLE_SWAGGER;
    const server = await buildServer();
    const response = await server.inject({ method: 'GET', url: '/api/docs/' });
    expect(response.statusCode).toBe(200);
  });

  it('does not register /api/docs when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_SWAGGER;
    const server = await buildServer();
    const response = await server.inject({ method: 'GET', url: '/api/docs/' });
    expect(response.statusCode).toBe(404);
  });

  it('registers /api/docs in production when ENABLE_SWAGGER=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_SWAGGER = 'true';
    const server = await buildServer();
    const response = await server.inject({ method: 'GET', url: '/api/docs/' });
    expect(response.statusCode).toBe(200);
  });
});
