// Mock the Log module before imports
jest.mock('./log', () => ({
  Log: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));

import Fastify, { FastifyInstance } from 'fastify';
import { getApiCalls } from './api_calls';
import { initJwt, generateToken } from './auth/jwt';
import { CallError } from './call_manager';
import type { CallManager } from './call_manager';
import type { StatusManager } from './websocket/status_manager';
import type { ClientRegistry } from './client_registry';
import { CallDocument } from './models/call';

// Mock CallManager
const mockCallManager = {
  initiateCall: jest.fn(),
  completeCallerSignaling: jest.fn(),
  joinCall: jest.fn(),
  completeCalleeSignaling: jest.fn(),
  endCall: jest.fn(),
  getActiveCallsForClient: jest.fn(),
  getCall: jest.fn(),
  endCallDueToDisconnect: jest.fn(),
  destroy: jest.fn()
};

// Mock StatusManager
const mockStatusManager = {
  sendToClient: jest.fn(),
  broadcastToAll: jest.fn()
};

// Mock ClientRegistry
const mockClientRegistry = {
  getClient: jest.fn()
};

// Helper to create Fastify app with call routes
async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify();

  // Register the call routes plugin
  await app.register(getApiCalls(), {
    prefix: 'api/v1',
    callManager: mockCallManager as any as CallManager,
    statusManager: mockStatusManager as any as StatusManager,
    clientRegistry: mockClientRegistry as any as ClientRegistry
  });

  await app.ready();
  return app;
}

// Helper to generate auth token
function createAuthToken(
  clientId: string,
  name = 'Test User',
  role = 'producer',
  location = 'Stockholm'
): string {
  return generateToken(clientId, name, role, location);
}

// Sample call documents for tests
const sampleCall: CallDocument = {
  _id: 'call_123',
  docType: 'call',
  callerId: 'client1',
  callerName: 'Alice',
  calleeId: 'client2',
  calleeName: 'Bob',
  smbConferenceId: 'conf_abc',
  state: 'offering',
  callerEndpointId: 'ep1',
  calleeEndpointId: 'ep2',
  callerReady: false,
  calleeReady: false,
  createdAt: '2024-01-01T00:00:00Z',
  endedAt: null
};

const activeCall: CallDocument = {
  ...sampleCall,
  state: 'active',
  callerReady: true,
  calleeReady: true
};

const endedCall: CallDocument = {
  ...sampleCall,
  state: 'ended',
  endedAt: '2024-01-01T01:00:00Z',
  endedBy: 'client1',
  endReason: 'caller_hangup'
};

describe('api_calls', () => {
  let app: FastifyInstance;

  beforeAll(() => {
    initJwt('test-secret-for-calls');
  });

  beforeEach(async () => {
    app = await createTestApp();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── POST /api/v1/call — Initiate call ──

  describe('POST /api/v1/call', () => {
    it('returns 201 with callId, sdpOffer, calleeId, calleeName on success', async () => {
      const token = createAuthToken('client1', 'Alice');

      mockCallManager.initiateCall.mockResolvedValue({
        call: sampleCall,
        callerSdpOffer: 'v=0\r\no=- 123 IN IP4 127.0.0.1\r\n'
      });

      mockClientRegistry.getClient.mockResolvedValue({
        clientId: 'client1',
        name: 'Alice',
        role: 'producer',
        location: 'Stockholm',
        isOnline: true
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/call',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          calleeId: 'client2'
        }
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        callId: 'call_123',
        calleeId: 'client2',
        calleeName: 'Bob'
      });
      expect(body.sdpOffer).toContain('v=0');
      expect(mockCallManager.initiateCall).toHaveBeenCalledWith(
        'client1',
        'Alice',
        'client2'
      );
      expect(mockStatusManager.sendToClient).toHaveBeenCalledWith(
        'client2',
        expect.objectContaining({
          type: 'call_incoming',
          callId: 'call_123'
        })
      );
    });

    it('returns 400 when calleeId is missing', async () => {
      const token = createAuthToken('client1', 'Alice');

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/call',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {}
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when calling yourself', async () => {
      const token = createAuthToken('client1', 'Alice');

      mockCallManager.initiateCall.mockRejectedValue(
        new CallError(400, 'Cannot call yourself')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/call',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          calleeId: 'client1'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Cannot call yourself');
    });

    it('returns 404 when callee does not exist', async () => {
      const token = createAuthToken('client1', 'Alice');

      mockCallManager.initiateCall.mockRejectedValue(
        new CallError(404, 'Client not found')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/call',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          calleeId: 'nonexistent'
        }
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Client not found');
    });

    it('returns 409 when callee is offline', async () => {
      const token = createAuthToken('client1', 'Alice');

      mockCallManager.initiateCall.mockRejectedValue(
        new CallError(409, 'Client is offline')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/call',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          calleeId: 'client2'
        }
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Client is offline');
    });

    it('returns 401 without JWT', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/call',
        payload: {
          calleeId: 'client2'
        }
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── PATCH /api/v1/call/:callId — Caller signaling ──

  describe('PATCH /api/v1/call/:callId', () => {
    it('returns 204 on success', async () => {
      const token = createAuthToken('client1', 'Alice');

      mockCallManager.completeCallerSignaling.mockResolvedValue(undefined);
      mockCallManager.getCall.mockResolvedValue(sampleCall);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/call/call_123',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          sdpAnswer: 'v=0\r\na=sendonly\r\n'
        }
      });

      expect(response.statusCode).toBe(204);
      expect(mockCallManager.completeCallerSignaling).toHaveBeenCalledWith(
        'call_123',
        'client1',
        'v=0\r\na=sendonly\r\n'
      );
    });

    it('broadcasts call_started when both sides ready', async () => {
      const token = createAuthToken('client1', 'Alice');

      mockCallManager.completeCallerSignaling.mockResolvedValue(undefined);
      mockCallManager.getCall.mockResolvedValue(activeCall);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/call/call_123',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          sdpAnswer: 'v=0\r\na=sendonly\r\n'
        }
      });

      expect(response.statusCode).toBe(204);
      expect(mockStatusManager.broadcastToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'call_started',
          callId: 'call_123'
        })
      );
    });

    it('returns 401 when not the caller', async () => {
      const token = createAuthToken('client3', 'Charlie');

      mockCallManager.completeCallerSignaling.mockRejectedValue(
        new CallError(401, 'Not authorized for this call')
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/call/call_123',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          sdpAnswer: 'v=0\r\na=sendonly\r\n'
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when call not found', async () => {
      const token = createAuthToken('client1', 'Alice');

      mockCallManager.completeCallerSignaling.mockRejectedValue(
        new CallError(404, 'Call not found')
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/call/nonexistent',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          sdpAnswer: 'v=0\r\na=sendonly\r\n'
        }
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 409 when call has ended', async () => {
      const token = createAuthToken('client1', 'Alice');

      mockCallManager.completeCallerSignaling.mockRejectedValue(
        new CallError(409, 'Call has ended')
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/call/call_123',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          sdpAnswer: 'v=0\r\na=sendonly\r\n'
        }
      });

      expect(response.statusCode).toBe(409);
    });

    it('returns 401 without JWT', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/call/call_123',
        payload: {
          sdpAnswer: 'v=0\r\na=sendonly\r\n'
        }
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── POST /api/v1/call/:callId/join — Callee join ──

  describe('POST /api/v1/call/:callId/join', () => {
    it('returns 200 with callId, sdpOffer, callerId, callerName', async () => {
      const token = createAuthToken('client2', 'Bob');

      mockCallManager.joinCall.mockResolvedValue(
        'v=0\r\no=- 456 IN IP4 127.0.0.1\r\n'
      );
      mockCallManager.getCall.mockResolvedValue(sampleCall);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/call/call_123/join',
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        callId: 'call_123',
        callerId: 'client1',
        callerName: 'Alice'
      });
      expect(body.sdpOffer).toContain('v=0');
      expect(mockCallManager.joinCall).toHaveBeenCalledWith(
        'call_123',
        'client2'
      );
    });

    it('returns 401 when not the callee', async () => {
      const token = createAuthToken('client3', 'Charlie');

      mockCallManager.joinCall.mockRejectedValue(
        new CallError(401, 'Not authorized for this call')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/call/call_123/join',
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when call not found', async () => {
      const token = createAuthToken('client2', 'Bob');

      mockCallManager.joinCall.mockRejectedValue(
        new CallError(404, 'Call not found')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/call/nonexistent/join',
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 401 without JWT', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/call/call_123/join'
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── PATCH /api/v1/call/:callId/answer — Callee answer ──

  describe('PATCH /api/v1/call/:callId/answer', () => {
    it('returns 204 on success', async () => {
      const token = createAuthToken('client2', 'Bob');

      mockCallManager.completeCalleeSignaling.mockResolvedValue(sampleCall);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/call/call_123/answer',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          sdpAnswer: 'v=0\r\na=recvonly\r\n'
        }
      });

      expect(response.statusCode).toBe(204);
      expect(mockCallManager.completeCalleeSignaling).toHaveBeenCalledWith(
        'call_123',
        'client2',
        'v=0\r\na=recvonly\r\n'
      );
    });

    it('broadcasts call_started when both sides ready', async () => {
      const token = createAuthToken('client2', 'Bob');

      mockCallManager.completeCalleeSignaling.mockResolvedValue(activeCall);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/call/call_123/answer',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          sdpAnswer: 'v=0\r\na=recvonly\r\n'
        }
      });

      expect(response.statusCode).toBe(204);
      expect(mockStatusManager.broadcastToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'call_started',
          callId: 'call_123'
        })
      );
    });

    it('returns 401 when not the callee', async () => {
      const token = createAuthToken('client3', 'Charlie');

      mockCallManager.completeCalleeSignaling.mockRejectedValue(
        new CallError(401, 'Not authorized for this call')
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/call/call_123/answer',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          sdpAnswer: 'v=0\r\na=recvonly\r\n'
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 without JWT', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/call/call_123/answer',
        payload: {
          sdpAnswer: 'v=0\r\na=recvonly\r\n'
        }
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── DELETE /api/v1/call/:callId — End call ──

  describe('DELETE /api/v1/call/:callId', () => {
    it('caller can end call and returns 200', async () => {
      const token = createAuthToken('client1', 'Alice');

      mockCallManager.endCall.mockResolvedValue(endedCall);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/call/call_123',
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        callId: 'call_123',
        message: 'Call ended'
      });
      expect(mockCallManager.endCall).toHaveBeenCalledWith(
        'call_123',
        'client1'
      );
      expect(mockStatusManager.sendToClient).toHaveBeenCalledWith(
        'client2',
        expect.objectContaining({
          type: 'call_ended',
          callId: 'call_123',
          endedBy: 'client1'
        })
      );
      expect(mockStatusManager.broadcastToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'call_ended',
          callId: 'call_123'
        })
      );
    });

    it('callee can end call and returns 200', async () => {
      const token = createAuthToken('client2', 'Bob');

      const callEndedByCallee = {
        ...endedCall,
        endedBy: 'client2'
      };
      mockCallManager.endCall.mockResolvedValue(callEndedByCallee);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/call/call_123',
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      expect(response.statusCode).toBe(200);
      expect(mockStatusManager.sendToClient).toHaveBeenCalledWith(
        'client1',
        expect.objectContaining({
          type: 'call_ended',
          endedBy: 'client2'
        })
      );
    });

    it('returns 401 when not a participant', async () => {
      const token = createAuthToken('client3', 'Charlie');

      mockCallManager.endCall.mockRejectedValue(
        new CallError(401, 'Not authorized for this call')
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/call/call_123',
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 409 when call already ended', async () => {
      const token = createAuthToken('client1', 'Alice');

      mockCallManager.endCall.mockRejectedValue(
        new CallError(409, 'Call has ended')
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/call/call_123',
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      expect(response.statusCode).toBe(409);
    });

    it('returns 401 without JWT', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/call/call_123'
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── GET /api/v1/call/active — List active calls ──

  describe('GET /api/v1/call/active', () => {
    it('returns empty array when no calls', async () => {
      const token = createAuthToken('client1', 'Alice');

      mockCallManager.getActiveCallsForClient.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/call/active',
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.calls).toEqual([]);
    });

    it('returns active calls with correct direction field', async () => {
      const token = createAuthToken('client1', 'Alice');

      const outgoingCall: CallDocument = {
        ...activeCall,
        _id: 'call_456',
        callerId: 'client1',
        callerName: 'Alice',
        calleeId: 'client2',
        calleeName: 'Bob'
      };

      const incomingCall: CallDocument = {
        ...activeCall,
        _id: 'call_789',
        callerId: 'client3',
        callerName: 'Charlie',
        calleeId: 'client1',
        calleeName: 'Alice'
      };

      mockCallManager.getActiveCallsForClient.mockResolvedValue([
        outgoingCall,
        incomingCall
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/call/active',
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.calls).toHaveLength(2);

      // First call should be outgoing (client1 is caller)
      expect(body.calls[0]).toMatchObject({
        callId: 'call_456',
        direction: 'outgoing',
        callerId: 'client1',
        calleeId: 'client2'
      });

      // Second call should be incoming (client1 is callee)
      expect(body.calls[1]).toMatchObject({
        callId: 'call_789',
        direction: 'incoming',
        callerId: 'client3',
        calleeId: 'client1'
      });
    });

    it('returns 401 without JWT', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/call/active'
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
