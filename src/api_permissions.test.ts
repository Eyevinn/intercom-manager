import api from './api';

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
  deleteIngest: jest.fn().mockResolvedValue(true)
};

const mockProductionManager = {
  checkUserStatus: jest.fn()
} as any;

const mockIngestManager = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn()
} as any;

describe('permissions api', () => {
  test('returns participant permissions when no access key is provided', async () => {
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/permissions'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      permissions: ['join_calls'],
      role: 'participant'
    });
  });

  test('returns editor permissions when editor access key is provided', async () => {
    process.env.EDITOR_ACCESS_KEY = 'editorkey';

    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/permissions',
      headers: { 'x-access-key': 'editorkey' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      permissions: ['create_production', 'manage_production', 'join_calls'],
      role: 'editor'
    });
  });

  test('returns admin permissions with correct access key', async () => {
    process.env.ADMIN_ACCESS_KEY = 'adminkey';

    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/permissions',
      headers: { 'x-access-key': 'adminkey' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      permissions: [
        'create_production',
        'manage_production',
        'manage_ingests',
        'join_calls'
      ],
      role: 'admin'
    });
  });

  test('returns 403 for invalid access key', async () => {
    process.env.ADMIN_ACCESS_KEY = 'adminkey';
    process.env.EDITOR_ACCESS_KEY = 'editorkey';

    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/permissions',
      headers: { 'x-access-key': 'invalidkey' }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      message: 'Invalid access key'
    });
  });
});
