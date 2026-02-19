jest.mock('./log', () => ({
  Log: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));

import api from './api';
import { Production } from './models';

// Minimal mock fixtures
const mockProductions: Production[] = [
  {
    _id: 1,
    name: 'prod-1',
    lines: [{ name: 'line-1', id: 'lid-1', smbConferenceId: 'smb-1' }]
  }
];

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
  getSessionsByQuery: jest.fn().mockResolvedValue([])
};

const mockIngestManager = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn()
} as any;

const mockCoreFunctions = {
  getAllLinesResponse: jest.fn().mockImplementation((production) =>
    production.lines.map((l: any) => ({
      name: l.name,
      id: l.id,
      smbConferenceId: l.smbConferenceId,
      participants: [],
      programOutputLine: l.programOutputLine || false
    }))
  ),
  createConferenceForLine: jest.fn().mockResolvedValue('mock-conference-id'),
  createEndpoint: jest.fn().mockResolvedValue({
    audio: { ssrcs: [12345], 'payload-type': {}, 'rtp-hdrexts': [] }
  }),
  createConnection: jest.fn().mockResolvedValue('sdp-offer-mock')
} as any;

const mockProductionManager = {
  createProduction: jest.fn().mockResolvedValue(mockProductions[0]),
  checkUserStatus: jest.fn().mockResolvedValue(undefined),
  requireProduction: jest.fn().mockImplementation(async (id: number) => {
    const found = mockProductions.find((p) => p._id === id);
    if (!found) throw new Error(`Production ${id} not found`);
    return found;
  }),
  updateProduction: jest.fn().mockResolvedValue({ _id: 1, name: 'updated' }),
  addProductionLine: jest.fn().mockResolvedValue(undefined),
  updateProductionLine: jest.fn().mockResolvedValue({}),
  getUsersForLine: jest.fn().mockImplementation(() => []),
  userSessions: {},
  getProductions: jest
    .fn()
    .mockImplementation(async (limit: number, offset: number) =>
      mockProductions.slice(offset, offset + limit)
    ),
  getNumberOfProductions: jest.fn().mockResolvedValue(1),
  getLine: jest
    .fn()
    .mockImplementation((lines: any[], id: string) =>
      lines.find((l: any) => l.id === id)
    ),
  updateUserLastSeen: jest.fn().mockReturnValue(true),
  deleteProductionLine: jest.fn().mockResolvedValue(undefined),
  deleteProduction: jest.fn().mockResolvedValue(true),
  removeUserSession: jest.fn(),
  createUserSession: jest.fn().mockResolvedValue(undefined),
  getActiveUsers: jest.fn().mockResolvedValue([]),
  getProduction: jest.fn().mockImplementation(async (id: number) => {
    return mockProductions.find((p) => p._id === id) || null;
  }),
  emit: jest.fn()
} as any;

describe('Input Validation', () => {
  let server: any;
  let setIntervalSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(jest.fn());
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  beforeAll(async () => {
    server = await api({
      title: 'validation-test',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager,
      coreFunctions: mockCoreFunctions
    });
  });

  afterAll(async () => {
    await server.close();
    setIntervalSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // ── ProductionId param validation ──────────────────────────────

  describe('ProductionId param validation', () => {
    test.each([
      ['non-numeric', 'abc'],
      ['special characters', 'id!@#'],
      ['float', '1.5'],
      ['negative', '-1']
    ])(
      'GET /production/:productionId rejects %s productionId',
      async (_label, badId) => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/production/${badId}`
        });
        expect(response.statusCode).toBe(400);
      }
    );

    test('PATCH /production/:productionId rejects non-numeric id', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/production/abc',
        body: { name: 'valid-name' }
      });
      expect(response.statusCode).toBe(400);
    });

    test('DELETE /production/:productionId rejects non-numeric id', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/production/abc'
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // ── ProductionLine param validation ────────────────────────────

  describe('ProductionLine param validation', () => {
    test('GET /production/:id/line rejects non-numeric productionId', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/production/abc/line'
      });
      expect(response.statusCode).toBe(400);
    });

    test('GET /production/:id/line/:lineId rejects non-numeric productionId', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/production/abc/line/lid-1'
      });
      expect(response.statusCode).toBe(400);
    });

    test('POST /production/:id/line rejects non-numeric productionId', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production/abc/line',
        body: { name: 'new-line' }
      });
      expect(response.statusCode).toBe(400);
    });

    test('PATCH /production/:id/line/:lineId rejects non-numeric productionId', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/production/abc/line/lid-1',
        body: { name: 'updated' }
      });
      expect(response.statusCode).toBe(400);
    });

    test('DELETE /production/:id/line/:lineId rejects non-numeric productionId', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/production/abc/line/lid-1'
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // ── Session param validation ───────────────────────────────────

  describe('Session param validation', () => {
    test('PATCH /session/:sessionId accepts non-empty sessionId', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/session/valid-session-id',
        body: { sdpAnswer: 'v=0\r\n' }
      });
      // Should not be 400 — it will fail deeper (no session found), but param is valid
      expect(response.statusCode).not.toBe(400);
    });

    test('DELETE /session/:sessionId accepts non-empty sessionId', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/session/valid-session-id'
      });
      expect(response.statusCode).not.toBe(400);
    });

    test('GET /heartbeat/:sessionId accepts non-empty sessionId', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/heartbeat/valid-session-id'
      });
      expect(response.statusCode).not.toBe(400);
    });
  });

  // ── Body validation: NewProduction ─────────────────────────────

  describe('POST /production body validation', () => {
    test('rejects empty name', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: { name: '', lines: [{ name: 'l1' }] }
      });
      expect(response.statusCode).toBe(400);
    });

    test('rejects name exceeding 200 characters', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: { name: 'x'.repeat(201), lines: [{ name: 'l1' }] }
      });
      expect(response.statusCode).toBe(400);
    });

    test('accepts name at exactly 200 characters', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: { name: 'x'.repeat(200), lines: [{ name: 'l1' }] }
      });
      expect(response.statusCode).toBe(200);
    });

    test('rejects empty line name', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: { name: 'valid-prod', lines: [{ name: '' }] }
      });
      expect(response.statusCode).toBe(400);
    });

    test('rejects line name exceeding 200 characters', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: {
          name: 'valid-prod',
          lines: [{ name: 'x'.repeat(201) }]
        }
      });
      expect(response.statusCode).toBe(400);
    });

    test('rejects missing name field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: { lines: [{ name: 'l1' }] }
      });
      expect(response.statusCode).toBe(400);
    });

    test('rejects missing lines field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production',
        body: { name: 'valid-prod' }
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // ── Body validation: NewProductionLine ─────────────────────────

  describe('POST /production/:id/line body validation', () => {
    test('rejects empty line name', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production/1/line',
        body: { name: '' }
      });
      expect(response.statusCode).toBe(400);
    });

    test('rejects line name exceeding 200 characters', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production/1/line',
        body: { name: 'x'.repeat(201) }
      });
      expect(response.statusCode).toBe(400);
    });

    test('rejects missing name field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production/1/line',
        body: {}
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // ── Body validation: NewSession ────────────────────────────────

  describe('POST /session body validation', () => {
    test('rejects non-numeric productionId', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/session',
        body: { productionId: 'abc', lineId: 'lid-1', username: 'user' }
      });
      expect(response.statusCode).toBe(400);
    });

    test('rejects empty productionId', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/session',
        body: { productionId: '', lineId: 'lid-1', username: 'user' }
      });
      expect(response.statusCode).toBe(400);
    });

    test('rejects empty lineId', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/session',
        body: { productionId: '1', lineId: '', username: 'user' }
      });
      expect(response.statusCode).toBe(400);
    });

    test('rejects empty username', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/session',
        body: { productionId: '1', lineId: 'lid-1', username: '' }
      });
      expect(response.statusCode).toBe(400);
    });

    test('rejects username exceeding 200 characters', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/session',
        body: {
          productionId: '1',
          lineId: 'lid-1',
          username: 'x'.repeat(201)
        }
      });
      expect(response.statusCode).toBe(400);
    });

    test('rejects missing required fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/session',
        body: {}
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // ── Participants route param validation ────────────────────────

  describe('POST /production/:id/line/:lineId/participants param validation', () => {
    test('rejects non-numeric productionId', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/production/abc/line/lid-1/participants'
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // ── Heartbeat route param validation ───────────────────────────

  describe('GET /heartbeat/:sessionId param validation', () => {
    test('returns 200 for known alive session', async () => {
      mockProductionManager.updateUserLastSeen.mockReturnValueOnce(true);
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/heartbeat/alive-session'
      });
      expect(response.statusCode).toBe(200);
    });

    test('returns 410 for unknown session', async () => {
      mockProductionManager.updateUserLastSeen.mockReturnValueOnce(false);
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/heartbeat/dead-session'
      });
      expect(response.statusCode).toBe(410);
    });
  });
});
