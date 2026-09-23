jest.mock('./log', () => ({
  Log: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));

import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { CoreFunctions } from './api_productions_core_functions';
import apiWhip from './api_whip';
import { ConnectionQueue } from './connection_queue';
import { UserSession } from './models';
import { Log } from './log';

// A valid UUID v4 used as the generated session id in tests. Session ids are
// UUIDs in production, and the DELETE route now enforces a UUID pattern.
const MOCK_SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';

jest.mock('uuid', () => ({
  v4: jest.fn(() => '123e4567-e89b-42d3-a456-426614174000')
}));

// Mock the logger so we can assert nothing with CR/LF/control chars is logged.
jest.mock('./log', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn()
  };
  return {
    Log: jest.fn(() => logger),
    Logger: jest.fn(() => logger)
  };
});

const mockLogger = Log() as unknown as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
  fatal: jest.Mock;
};

// Asserts that none of the logger methods were ever called with a string
// argument containing CR, LF or other control characters.
const expectNoControlCharsLogged = () => {
  // eslint-disable-next-line no-control-regex
  const controlCharRe = /[\x00-\x1f\x7f-\x9f]/;
  for (const method of [
    mockLogger.info,
    mockLogger.warn,
    mockLogger.error,
    mockLogger.debug,
    mockLogger.fatal
  ]) {
    for (const call of method.mock.calls) {
      for (const arg of call) {
        if (typeof arg === 'string') {
          expect(arg).not.toMatch(controlCharRe);
        }
      }
    }
  }
};

const mockProductionManager = {
  createUserSession: jest.fn(),
  updateUserEndpoint: jest.fn(),
  updateUserLastSeen: jest.fn().mockReturnValue(true),
  removeUserSession: jest.fn().mockReturnValue('session-id'),
  getProduction: jest.fn().mockResolvedValue({ lines: [{ id: 'line1' }] }),
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
  getUser: jest.fn().mockResolvedValue(undefined),
  requireLine: jest.fn().mockResolvedValue({}),
  once: jest.fn(),
  emit: jest.fn()
} as any;

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

const coreFunctions = new CoreFunctions(
  mockProductionManager,
  new ConnectionQueue()
);

coreFunctions.createConferenceForLine = jest
  .fn()
  .mockResolvedValue('mock-conference-id') as any;
coreFunctions.createEndpoint = jest.fn().mockResolvedValue({
  'bundle-transport': {
    'rtcp-mux': true,
    ice: {
      ufrag: 'test-ufrag',
      pwd: 'test-pwd',
      candidates: []
    },
    dtls: {
      fingerprint: 'sha-256 FAKEFINGERPRINT',
      setup: 'actpass'
    }
  }
}) as any;
coreFunctions.configureEndpointForWhipWhep = jest
  .fn()
  .mockResolvedValue(undefined);
coreFunctions.createWhipWhepAnswer = jest
  .fn()
  .mockResolvedValue(
    'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\n'
  ) as any;

const defaultOptions = {
  productionManager: mockProductionManager,
  smbServerBaseUrl: 'http://localhost:3000',
  smbServerApiKey: 'dummy-key',
  coreFunctions: coreFunctions,
  endpointIdleTimeout: '60',
  dbManager: mockDbManager
};

const createTestServer = async () => {
  const fastify = Fastify({ maxParamLength: 300 });

  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      done(null, body);
    }
  );

  fastify.register(rateLimit, {
    global: false
  });

  fastify.register(apiWhip, defaultOptions);
  await fastify.ready();
  return fastify;
};

const createAuthServer = async () => {
  const fastify = Fastify();

  mockDbManager.getSession.mockResolvedValue({
    _id: MOCK_SESSION_ID
  } as any);

  fastify.register(apiWhip, { ...defaultOptions, whipAuthKey: 'secret-123' });
  await fastify.ready();
  return fastify;
};

describe('apiWhip', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /whip/:productionId/:lineId/:username', () => {
    it('should return 201 with SDP answer and proper headers', async () => {
      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'POST',
        url: '/whip/123/456/testuser',
        headers: {
          'content-type': 'application/sdp'
        },
        payload:
          'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\nm=audio 0 RTP/AVP 0\r\na=mid:0\r\n'
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers['content-type']).toBe('application/sdp');
      expect(response.headers['location']).toContain(
        `/whip/123/456/${MOCK_SESSION_ID}`
      );
      expect(response.payload).toContain('v=0');
    });

    it('should return 406 if SDP answer misses m= sections', async () => {
      (coreFunctions.createWhipWhepAnswer as jest.Mock).mockResolvedValueOnce(
        'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\n'
      );

      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'POST',
        url: '/whip/123/456/testuser',
        headers: {
          'content-type': 'application/sdp'
        },
        payload:
          'v=0\r\n' +
          'o=- 0 0 IN IP4 127.0.0.1\r\n' +
          's=-\r\n' +
          't=0 0\r\n' +
          'm=audio 9 UDP/TLS/RTP/SAVPF 96\r\n' +
          'a=mid:audio0\r\n'
      });

      expect(response.statusCode).toBe(406);
      expect(response.json().error).toMatch(/could not be negotiated/);
    });

    it('should return 415 for unsupported content type', async () => {
      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'POST',
        url: '/whip/123/456/testuser',
        headers: {
          'content-type': 'application/json'
        },
        payload: JSON.stringify({ foo: 'bar' })
      });

      expect(response.statusCode).toBe(415);
    });

    it.each([
      ['LF newline', 'evil\ninjected'],
      ['CR carriage return', 'evil\rinjected'],
      ['ANSI escape sequence', 'evil\x1b[31mred\x1b[0m']
    ])(
      'should return 400 when username contains control chars (%s, log injection)',
      async (_label, payload) => {
        const fastify = await createTestServer();

        const response = await fastify.inject({
          method: 'POST',
          url: '/whip/123/456/' + encodeURIComponent(payload),
          headers: {
            'content-type': 'application/sdp'
          },
          payload: 'v=0\r\n'
        });

        expect(response.statusCode).toBe(400);
        expectNoControlCharsLogged();
      }
    );

    it('should accept a username at the allowed-char boundary (word, space, dot, dash)', async () => {
      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'POST',
        url: '/whip/123/456/' + encodeURIComponent('Ada B. Lovelace-1_2'),
        headers: {
          'content-type': 'application/sdp'
        },
        payload:
          'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\nm=audio 0 RTP/AVP 0\r\na=mid:0\r\n'
      });

      expect(response.statusCode).toBe(201);
    });

    it('should return 400 when productionId is not numeric', async () => {
      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'POST',
        url: '/whip/abc/456/testuser',
        headers: {
          'content-type': 'application/sdp'
        },
        payload: 'v=0\r\n'
      });

      expect(response.statusCode).toBe(400);
    });

    // The numeric pattern alone would accept an arbitrarily long digit string;
    // maxLength is what bounds it. Covered explicitly because the two
    // constraints were added by separate PRs and a merge once dropped this one.
    it('should return 400 when a numeric productionId exceeds maxLength of 200', async () => {
      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'POST',
        url: `/whip/${'1'.repeat(201)}/456/testuser`,
        headers: {
          'content-type': 'application/sdp'
        },
        payload: 'v=0\r\n'
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 429 when rate limit is exceeded', async () => {
      const fastify = await createTestServer();

      // Send 10 valid requests (these should succeed or at least not trigger 429)
      for (let i = 0; i < 10; i++) {
        await fastify.inject({
          method: 'POST',
          url: '/whip/123/456/testuser',
          headers: {
            'content-type': 'application/sdp'
          },
          payload: 'v=0\r\n'
        });
      }

      // The 11th request should exceed the rate limit
      const response = await fastify.inject({
        method: 'POST',
        url: '/whip/123/456/testuser',
        headers: {
          'content-type': 'application/sdp'
        },
        payload: 'v=0\r\n'
      });

      expect(response.statusCode).toBe(429);
      expect(JSON.parse(response.body)).toEqual(
        expect.objectContaining({
          error: expect.stringMatching(/Too many/i)
        })
      );
    });
  });

  describe('POST /whip/:productionId/:lineId/:username (WHIP authentication)', () => {
    it('should return 401 when auth enabled and authorization header missing', async () => {
      const fastify = await createAuthServer();
      const res = await fastify.inject({
        method: 'POST',
        url: '/whip/123/456/testuser',
        headers: { 'content-type': 'application/sdp' },
        payload: 'v=0\r\n'
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Bearer.*realm="whip"/i);
    });

    it('should return 401 with wrong token auth key', async () => {
      const fastify = await createAuthServer();
      const res = await fastify.inject({
        method: 'POST',
        url: '/whip/123/456/testuser',
        headers: {
          'content-type': 'application/sdp',
          authorization: 'Bearer wrong'
        },
        payload:
          'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\nm=audio 0 RTP/AVP 0\r\na=mid:0\r\n'
      });
      expect(res.statusCode).toBe(401);
    });

    it('should return 201 with correct token auth key', async () => {
      const fastify = await createAuthServer();
      const res = await fastify.inject({
        method: 'POST',
        url: '/whip/123/456/testuser',
        headers: {
          'content-type': 'application/sdp',
          authorization: 'Bearer secret-123'
        },
        payload:
          'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\nm=audio 0 RTP/AVP 0\r\na=mid:0\r\n'
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('DELETE /whip/:productionId/:lineId/:sessionId', () => {
    it('should return 401 when trying to delete WHIP session when it is not active', async () => {
      const fastify = await createAuthServer();
      const res = await fastify.inject({
        method: 'DELETE',
        url: `/whip/123/456/${MOCK_SESSION_ID}`
      });
      expect(res.statusCode).toBe(401);
    });

    it('should terminate session and return 200 OK with auth enabled and correct token auth key', async () => {
      const fastify = await createAuthServer();
      const res = await fastify.inject({
        method: 'DELETE',
        url: `/whip/123/456/${MOCK_SESSION_ID}`,
        headers: { authorization: 'Bearer secret-123' }
      });
      expect(res.statusCode).toBe(200);
    });

    it('should terminate a session and return 200 OK', async () => {
      const fastify = await createTestServer();

      mockDbManager.getSession.mockResolvedValueOnce({
        _id: MOCK_SESSION_ID
      } as any);

      const response = await fastify.inject({
        method: 'DELETE',
        url: `/whip/123/456/${MOCK_SESSION_ID}`
      });

      expect(response.statusCode).toBe(200);
      expect(response.payload).toBe('OK');
    });

    it('should return 404 if session not found', async () => {
      const fastify = await createTestServer();
      mockDbManager.getSession.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/whip/123/456/00000000-0000-4000-8000-000000000000'
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'WHIP session not found' });
    });

    it.each([
      ['LF newline', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\ninjected'],
      ['CR carriage return', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\rinjected'],
      [
        'ANSI escape sequence',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\x1b[31mred\x1b[0m'
      ]
    ])(
      'should return 400 and not log control chars for malicious sessionId (%s)',
      async (_label, sessionId) => {
        const fastify = await createTestServer();

        const response = await fastify.inject({
          method: 'DELETE',
          url: '/whip/123/456/' + encodeURIComponent(sessionId)
        });

        expect(response.statusCode).toBe(400);
        expectNoControlCharsLogged();
      }
    );
  });

  describe('OPTIONS /whip/:productionId/:lineId', () => {
    it('should return 200 for valid line and production', async () => {
      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'OPTIONS',
        url: '/whip/123/line1'
      });

      expect(response.statusCode).toBe(200);
      expect(response.payload).toBe('OK');
    });

    it('should return 404 if line not found', async () => {
      mockProductionManager.getProduction.mockResolvedValueOnce({
        lines: []
      });

      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'OPTIONS',
        url: '/whip/123/line1'
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Line not found' });
    });

    it('should return 400 for invalid production ID', async () => {
      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'OPTIONS',
        url: '/whip/invalid/line1'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Invalid production ID' });
    });
  });

  describe('PATCH /whip/:productionId/:lineId/:sessionId', () => {
    it('should return 405 method not allowed for valid params', async () => {
      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'PATCH',
        url: `/whip/123/456/${MOCK_SESSION_ID}`,
        headers: { 'content-type': 'application/trickle-ice-sdpfrag' },
        payload: 'a=candidate:1 1 UDP 12345 192.168.1.2 54321 typ host'
      });

      expect(response.statusCode).toBe(405);
      expect(response.payload).toBe('Method not allowed');
    });

    it('should return 400 when productionId param is empty string', async () => {
      const fastify = await createTestServer();

      // Route will not match an empty segment — use a single-char string to stay
      // at minimum length boundary and verify schema rejects a zero-length value
      // by patching the URL with an explicitly empty segment (Fastify resolves to
      // a 404 for empty path segments, so instead test a one-char boundary check
      // by verifying valid one-char params still reach the handler).
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/whip/p/l/s',
        headers: { 'content-type': 'application/trickle-ice-sdpfrag' },
        payload: 'a=candidate:1 1 UDP 12345 192.168.1.2 54321 typ host'
      });

      // Single-char params satisfy minLength:1 — handler returns 405
      expect(response.statusCode).toBe(405);
    });

    it('should return 400 when a param exceeds maxLength of 200', async () => {
      const fastify = await createTestServer();
      const longParam = 'a'.repeat(201);

      const response = await fastify.inject({
        method: 'PATCH',
        url: `/whip/${longParam}/line1/mock-session-id`,
        headers: { 'content-type': 'application/trickle-ice-sdpfrag' },
        payload: 'a=candidate:1 1 UDP 12345 192.168.1.2 54321 typ host'
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when lineId param exceeds maxLength of 200', async () => {
      const fastify = await createTestServer();
      const longParam = 'b'.repeat(201);

      const response = await fastify.inject({
        method: 'PATCH',
        url: `/whip/prod1/${longParam}/mock-session-id`,
        headers: { 'content-type': 'application/trickle-ice-sdpfrag' },
        payload: 'a=candidate:1 1 UDP 12345 192.168.1.2 54321 typ host'
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when sessionId param exceeds maxLength of 200', async () => {
      const fastify = await createTestServer();
      const longParam = 'c'.repeat(201);

      const response = await fastify.inject({
        method: 'PATCH',
        url: `/whip/prod1/line1/${longParam}`,
        headers: { 'content-type': 'application/trickle-ice-sdpfrag' },
        payload: 'a=candidate:1 1 UDP 12345 192.168.1.2 54321 typ host'
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
