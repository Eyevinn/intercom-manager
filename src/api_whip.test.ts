import Fastify from 'fastify';
import { CoreFunctions } from './api_productions_core_functions';
import apiWhip from './api_whip';
import { ConnectionQueue } from './connection_queue';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-session-id')
}));

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
  once: jest.fn()
} as any;

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
coreFunctions.configureEndpointForWhip = jest.fn().mockResolvedValue(undefined);
coreFunctions.createAnswer = jest
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
  publicHost: 'https://example.com'
};

const createTestServer = async () => {
  const fastify = Fastify();

  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      done(null, body);
    }
  );

  fastify.register(apiWhip, defaultOptions);
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
        url: '/whip/prod1/line1/testuser',
        headers: {
          'content-type': 'application/sdp'
        },
        payload:
          'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\nm=audio 0 RTP/AVP 0\r\na=mid:0\r\n'
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers['content-type']).toBe('application/sdp');
      expect(response.headers['location']).toContain(
        '/whip/prod1/line1/mock-session-id'
      );
      expect(response.payload).toContain('v=0');
    });

    it('should return 406 if SDP answer misses m= sections', async () => {
      (coreFunctions.createAnswer as jest.Mock).mockResolvedValueOnce(
        'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\n'
      );

      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'POST',
        url: '/whip/prod1/line1/testuser',
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
        url: '/whip/prod1/line1/testuser',
        headers: {
          'content-type': 'application/json'
        },
        payload: JSON.stringify({ foo: 'bar' })
      });

      expect(response.statusCode).toBe(415);
    });
  });

  describe('DELETE /whip/:productionId/:lineId/:sessionId', () => {
    it('should terminate a session and return 200 OK', async () => {
      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/whip/prod1/line1/mock-session-id'
      });

      expect(response.statusCode).toBe(200);
      expect(response.payload).toBe('OK');
    });

    it('should return 404 if session not found', async () => {
      mockProductionManager.removeUserSession.mockReturnValueOnce(undefined);

      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/whip/prod1/line1/nonexistent-session'
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'WHIP session not found' });
    });
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
    it('should return 405 method not allowed', async () => {
      const fastify = await createTestServer();

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/whip/prod1/line1/mock-session-id',
        headers: { 'content-type': 'application/trickle-ice-sdpfrag' },
        payload: 'a=candidate:1 1 UDP 12345 192.168.1.2 54321 typ host'
      });

      expect(response.statusCode).toBe(405);
      expect(response.payload).toBe('Method not allowed');
    });
  });
});
