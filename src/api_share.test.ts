import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { UserSession } from './models';

jest.mock('./log', () => ({
  Log: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

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
  updatePreset: jest.fn().mockResolvedValue(undefined),
  addShareLink: jest.fn().mockResolvedValue({
    _id: 'sharelink_123',
    path: '/mypath/to/share',
    createdAt: 1700000000000
  }),
  getShareLink: jest.fn().mockResolvedValue(undefined),
  deleteShareLink: jest.fn().mockResolvedValue(true)
};

const mockProductionManager = {
  checkUserStatus: jest.fn()
} as any;

const mockIngestManager = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn()
} as any;

describe('share api', () => {
  test('can generate a share link for a given application path', async () => {
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager,
      coreFunctions: new CoreFunctions(
        mockProductionManager,
        new ConnectionQueue()
      )
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/share',
      body: {
        path: '/mypath/to/share'
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      url: 'https://example.com/mypath/to/share'
    });
  });

  test('rejects a malformed OSC_ACCESS_TOKEN with 500 (#226)', async () => {
    const originalToken = process.env.OSC_ACCESS_TOKEN;
    const originalFetch = global.fetch;
    process.env.OSC_ACCESS_TOKEN = 'not-a-jwt';
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    try {
      const server = await api({
        title: 'my awesome service',
        smbServerBaseUrl: 'http://localhost',
        endpointIdleTimeout: '60',
        publicHost: 'https://example.com',
        dbManager: mockDbManager,
        productionManager: mockProductionManager,
        ingestManager: mockIngestManager,
        coreFunctions: new CoreFunctions(
          mockProductionManager,
          new ConnectionQueue()
        )
      });
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/share',
        body: {
          path: '/mypath/to/share'
        }
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        message: 'OSC_ACCESS_TOKEN is missing or malformed'
      });
      // The malformed token must never reach the OSC token service.
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.OSC_ACCESS_TOKEN = originalToken;
      global.fetch = originalFetch;
    }
  });

  test.each([
    '//evil.com/x',
    '/\\evil.com',
    '\\\\evil.com',
    'https://evil.com',
    'no-leading-slash'
  ])('rejects scheme-relative or malformed share path %s', async (path) => {
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager,
      coreFunctions: new CoreFunctions(
        mockProductionManager,
        new ConnectionQueue()
      )
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/share',
      body: {
        path
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().url).toBeUndefined();
  });

  test('generates a reusable link pointing at the redemption endpoint (#316)', async () => {
    mockDbManager.addShareLink.mockResolvedValueOnce({
      _id: 'sharelink_abc',
      path: '/mypath/to/share',
      createdAt: 1700000000000
    });
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager,
      coreFunctions: new CoreFunctions(
        mockProductionManager,
        new ConnectionQueue()
      )
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/share',
      body: {
        path: '/mypath/to/share',
        reusable: true
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      url: 'https://example.com/api/v1/share/sharelink_abc'
    });
    expect(mockDbManager.addShareLink).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/mypath/to/share' })
    );
  });

  test('persists createdAt when creating a reusable link (#316)', async () => {
    const before = Date.now();
    mockDbManager.addShareLink.mockResolvedValueOnce({
      _id: 'sharelink_abc',
      path: '/mypath/to/share',
      createdAt: Date.now()
    });
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager,
      coreFunctions: new CoreFunctions(
        mockProductionManager,
        new ConnectionQueue()
      )
    });
    await server.inject({
      method: 'POST',
      url: '/api/v1/share',
      body: {
        path: '/mypath/to/share',
        reusable: true
      }
    });
    const arg = mockDbManager.addShareLink.mock.calls.at(-1)?.[0];
    expect(typeof arg.createdAt).toBe('number');
    expect(arg.createdAt).toBeGreaterThanOrEqual(before);
    expect(arg.createdAt).toBeLessThanOrEqual(Date.now());
  });

  test('redeeming an expired reusable link returns 410 (#316)', async () => {
    mockDbManager.getShareLink.mockResolvedValueOnce({
      _id: 'sharelink_abc',
      path: '/mypath/to/share',
      // Created well beyond the 7-day max age.
      createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000
    });
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
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
      url: '/api/v1/share/sharelink_abc'
    });
    expect(response.statusCode).toBe(410);
  });

  test('revoking a reusable link then redeeming it returns 404 (#316)', async () => {
    mockDbManager.deleteShareLink.mockResolvedValueOnce(true);
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager,
      coreFunctions: new CoreFunctions(
        mockProductionManager,
        new ConnectionQueue()
      )
    });
    const del = await server.inject({
      method: 'DELETE',
      url: '/api/v1/share/sharelink_abc'
    });
    expect(del.statusCode).toBe(204);
    expect(mockDbManager.deleteShareLink).toHaveBeenCalledWith('sharelink_abc');
    // After revocation the DB no longer returns the link.
    mockDbManager.getShareLink.mockResolvedValueOnce(undefined);
    const get = await server.inject({
      method: 'GET',
      url: '/api/v1/share/sharelink_abc'
    });
    expect(get.statusCode).toBe(404);
  });

  test('revoking an unknown reusable link returns 404 (#316)', async () => {
    mockDbManager.deleteShareLink.mockResolvedValueOnce(false);
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager,
      coreFunctions: new CoreFunctions(
        mockProductionManager,
        new ConnectionQueue()
      )
    });
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/v1/share/sharelink_missing'
    });
    expect(response.statusCode).toBe(404);
  });

  test('redeem rejects an OSC share URL with an untrusted origin (#316)', async () => {
    const originalToken = process.env.OSC_ACCESS_TOKEN;
    const originalFetch = global.fetch;
    process.env.OSC_ACCESS_TOKEN = 'aaa.bbb.ccc';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ shareUrl: 'http://evil.example/steal' })
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;
    mockDbManager.getShareLink.mockResolvedValueOnce({
      _id: 'sharelink_abc',
      path: '/mypath/to/share',
      createdAt: Date.now()
    });
    try {
      const server = await api({
        title: 'my awesome service',
        smbServerBaseUrl: 'http://localhost',
        endpointIdleTimeout: '60',
        publicHost: 'https://example.com',
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
        url: '/api/v1/share/sharelink_abc'
      });
      expect(response.statusCode).toBe(502);
    } finally {
      process.env.OSC_ACCESS_TOKEN = originalToken;
      global.fetch = originalFetch;
    }
  });

  test('redeem returns 502 when the OSC token service is unreachable (#316)', async () => {
    const originalToken = process.env.OSC_ACCESS_TOKEN;
    const originalFetch = global.fetch;
    process.env.OSC_ACCESS_TOKEN = 'aaa.bbb.ccc';
    const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    global.fetch = fetchMock as unknown as typeof global.fetch;
    mockDbManager.getShareLink.mockResolvedValueOnce({
      _id: 'sharelink_abc',
      path: '/mypath/to/share',
      createdAt: Date.now()
    });
    try {
      const server = await api({
        title: 'my awesome service',
        smbServerBaseUrl: 'http://localhost',
        endpointIdleTimeout: '60',
        publicHost: 'https://example.com',
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
        url: '/api/v1/share/sharelink_abc'
      });
      expect(response.statusCode).toBe(502);
    } finally {
      process.env.OSC_ACCESS_TOKEN = originalToken;
      global.fetch = originalFetch;
    }
  });

  test('redeem rejects a malformed OSC_ACCESS_TOKEN with 500 (#316)', async () => {
    const originalToken = process.env.OSC_ACCESS_TOKEN;
    const originalFetch = global.fetch;
    process.env.OSC_ACCESS_TOKEN = 'not-a-jwt';
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    mockDbManager.getShareLink.mockResolvedValueOnce({
      _id: 'sharelink_abc',
      path: '/mypath/to/share',
      createdAt: Date.now()
    });
    try {
      const server = await api({
        title: 'my awesome service',
        smbServerBaseUrl: 'http://localhost',
        endpointIdleTimeout: '60',
        publicHost: 'https://example.com',
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
        url: '/api/v1/share/sharelink_abc'
      });
      expect(response.statusCode).toBe(500);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.OSC_ACCESS_TOKEN = originalToken;
      global.fetch = originalFetch;
    }
  });

  test('redeeming an unknown reusable link returns 404 (#316)', async () => {
    mockDbManager.getShareLink.mockResolvedValueOnce(undefined);
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
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
      url: '/api/v1/share/sharelink_missing'
    });
    expect(response.statusCode).toBe(404);
  });

  test('redeeming a reusable link redirects to the shared path (#316)', async () => {
    mockDbManager.getShareLink.mockResolvedValueOnce({
      _id: 'sharelink_abc',
      path: '/mypath/to/share',
      createdAt: Date.now()
    });
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
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
      url: '/api/v1/share/sharelink_abc'
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      'https://example.com/mypath/to/share'
    );
  });

  test('redeeming a reusable link mints a fresh OSC token per access (#316)', async () => {
    const originalToken = process.env.OSC_ACCESS_TOKEN;
    const originalFetch = global.fetch;
    process.env.OSC_ACCESS_TOKEN = 'aaa.bbb.ccc';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ shareUrl: 'https://example.com/signed-each-time' })
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;
    mockDbManager.getShareLink.mockResolvedValue({
      _id: 'sharelink_abc',
      path: '/mypath/to/share',
      createdAt: Date.now()
    });
    try {
      const server = await api({
        title: 'my awesome service',
        smbServerBaseUrl: 'http://localhost',
        endpointIdleTimeout: '60',
        publicHost: 'https://example.com',
        dbManager: mockDbManager,
        productionManager: mockProductionManager,
        ingestManager: mockIngestManager,
        coreFunctions: new CoreFunctions(
          mockProductionManager,
          new ConnectionQueue()
        )
      });
      const first = await server.inject({
        method: 'GET',
        url: '/api/v1/share/sharelink_abc'
      });
      const second = await server.inject({
        method: 'GET',
        url: '/api/v1/share/sharelink_abc'
      });
      expect(first.statusCode).toBe(302);
      expect(second.statusCode).toBe(302);
      expect(first.headers.location).toBe(
        'https://example.com/signed-each-time'
      );
      // A fresh delegate token is minted on every access, not reused.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      process.env.OSC_ACCESS_TOKEN = originalToken;
      global.fetch = originalFetch;
      mockDbManager.getShareLink.mockResolvedValue(undefined);
    }
  });
});
