import { FastifyPluginCallback } from 'fastify';
import { requireAuth } from './auth/middleware';
import { CallManager, CallError } from './call_manager';
import { StatusManager } from './websocket/status_manager';
import { ClientRegistry } from './client_registry';
import {
  InitiateCallRequest,
  InitiateCallResponse,
  CallSdpAnswer,
  JoinCallResponse,
  EndCallResponse,
  ActiveCallsResponse
} from './models/call';
import { Log } from './log';

export interface ApiCallsOptions {
  callManager: CallManager;
  statusManager: StatusManager;
  clientRegistry: ClientRegistry;
}

/**
 * Fastify plugin providing all M2 call REST endpoints.
 *
 * Endpoints:
 * - POST   /call           — Initiate a directed P2P call
 * - PATCH  /call/:callId   — Caller sends SDP answer
 * - POST   /call/:callId/join    — Callee gets SDP offer
 * - PATCH  /call/:callId/answer  — Callee sends SDP answer
 * - DELETE /call/:callId   — End a call
 * - GET    /call/active    — List active calls for current client
 */
export const getApiCalls = (): FastifyPluginCallback<ApiCallsOptions> => {
  return (fastify, opts, next) => {
    const { callManager, statusManager, clientRegistry } = opts;

    // ── POST /call — Initiate a call ──
    fastify.post<{
      Body: typeof InitiateCallRequest.static;
      Reply: typeof InitiateCallResponse.static;
    }>(
      '/call',
      {
        preHandler: requireAuth,
        config: {
          rateLimit: {
            max: 20,
            timeWindow: '1 minute'
          }
        },
        schema: {
          description: 'Initiate a directed P2P call',
          body: InitiateCallRequest,
          response: { 201: InitiateCallResponse }
        }
      },
      async (request, reply) => {
        const { clientId, name } = request.client!;
        const { calleeId } = request.body;

        try {
          const { call, callerSdpOffer } = await callManager.initiateCall(
            clientId,
            name,
            calleeId
          );

          // Send call_incoming WebSocket event to callee
          const caller = await clientRegistry.getClient(clientId);
          statusManager.sendToClient(call.calleeId, {
            type: 'call_incoming',
            callId: call._id,
            callerId: call.callerId,
            callerName: call.callerName,
            callerRole: caller?.role || '',
            callerLocation: caller?.location || '',
            timestamp: call.createdAt
          });

          reply.code(201).send({
            callId: call._id,
            sdpOffer: callerSdpOffer,
            calleeId: call.calleeId,
            calleeName: call.calleeName
          });
        } catch (err: any) {
          if (err instanceof CallError) {
            reply.code(err.statusCode).send({ message: err.message } as any);
          } else {
            Log().error(`Failed to initiate call: ${err.message}`);
            reply
              .code(500)
              .send({ message: 'Failed to establish media connection' } as any);
          }
        }
      }
    );

    // ── PATCH /call/:callId — Caller sends SDP answer ──
    fastify.patch<{
      Params: { callId: string };
      Body: typeof CallSdpAnswer.static;
    }>(
      '/call/:callId',
      {
        preHandler: requireAuth,
        schema: {
          description: 'Complete caller WebRTC signaling',
          body: CallSdpAnswer
        }
      },
      async (request, reply) => {
        const { callId } = request.params;
        const { clientId } = request.client!;
        const { sdpAnswer } = request.body;

        try {
          await callManager.completeCallerSignaling(callId, clientId, sdpAnswer);

          // Check if call is now active (both sides ready)
          const call = await callManager.getCall(callId);
          if (call && call.state === 'active') {
            statusManager.broadcastToAll({
              type: 'call_started',
              callId: call._id,
              callerId: call.callerId,
              callerName: call.callerName,
              calleeId: call.calleeId,
              calleeName: call.calleeName,
              timestamp: new Date().toISOString()
            });
          }

          reply.code(204).send();
        } catch (err: any) {
          if (err instanceof CallError) {
            reply.code(err.statusCode).send({ message: err.message } as any);
          } else {
            Log().error(`Failed to complete caller signaling: ${err.message}`);
            reply
              .code(500)
              .send({
                message: 'Failed to configure media connection'
              } as any);
          }
        }
      }
    );

    // ── POST /call/:callId/join — Callee gets SDP offer ──
    fastify.post<{
      Params: { callId: string };
      Reply: typeof JoinCallResponse.static;
    }>(
      '/call/:callId/join',
      {
        preHandler: requireAuth,
        schema: {
          description: 'Callee joins call and gets SDP offer',
          response: { 200: JoinCallResponse }
        }
      },
      async (request, reply) => {
        const { callId } = request.params;
        const { clientId } = request.client!;

        try {
          const sdpOffer = await callManager.joinCall(callId, clientId);
          const call = await callManager.getCall(callId);

          reply.send({
            callId,
            sdpOffer,
            callerId: call!.callerId,
            callerName: call!.callerName
          });
        } catch (err: any) {
          if (err instanceof CallError) {
            reply.code(err.statusCode).send({ message: err.message } as any);
          } else {
            Log().error(`Failed to join call: ${err.message}`);
            reply
              .code(500)
              .send({ message: 'Failed to generate media offer' } as any);
          }
        }
      }
    );

    // ── PATCH /call/:callId/answer — Callee sends SDP answer ──
    fastify.patch<{
      Params: { callId: string };
      Body: typeof CallSdpAnswer.static;
    }>(
      '/call/:callId/answer',
      {
        preHandler: requireAuth,
        schema: {
          description: 'Complete callee WebRTC signaling',
          body: CallSdpAnswer
        }
      },
      async (request, reply) => {
        const { callId } = request.params;
        const { clientId } = request.client!;
        const { sdpAnswer } = request.body;

        try {
          const updatedCall = await callManager.completeCalleeSignaling(
            callId,
            clientId,
            sdpAnswer
          );

          // Check if call is now active (both sides ready)
          if (
            updatedCall.state === 'active' ||
            (updatedCall.calleeReady && updatedCall.callerReady)
          ) {
            statusManager.broadcastToAll({
              type: 'call_started',
              callId: updatedCall._id,
              callerId: updatedCall.callerId,
              callerName: updatedCall.callerName,
              calleeId: updatedCall.calleeId,
              calleeName: updatedCall.calleeName,
              timestamp: new Date().toISOString()
            });
          }

          reply.code(204).send();
        } catch (err: any) {
          if (err instanceof CallError) {
            reply.code(err.statusCode).send({ message: err.message } as any);
          } else {
            Log().error(`Failed to complete callee signaling: ${err.message}`);
            reply
              .code(500)
              .send({
                message: 'Failed to configure media connection'
              } as any);
          }
        }
      }
    );

    // ── DELETE /call/:callId — End a call ──
    fastify.delete<{
      Params: { callId: string };
      Reply: typeof EndCallResponse.static;
    }>(
      '/call/:callId',
      {
        preHandler: requireAuth,
        schema: {
          description: 'End a call',
          response: { 200: EndCallResponse }
        }
      },
      async (request, reply) => {
        const { callId } = request.params;
        const { clientId } = request.client!;

        try {
          const endedCall = await callManager.endCall(callId, clientId);

          // Determine the other party to notify directly
          const otherClientId =
            endedCall.callerId === clientId
              ? endedCall.calleeId
              : endedCall.callerId;

          const callEndedEvent = {
            type: 'call_ended' as const,
            callId: endedCall._id,
            callerId: endedCall.callerId,
            callerName: endedCall.callerName,
            calleeId: endedCall.calleeId,
            calleeName: endedCall.calleeName,
            endedBy: clientId,
            reason: endedCall.endReason || 'caller_hangup',
            timestamp: new Date().toISOString()
          };

          // Send to the other party specifically
          statusManager.sendToClient(otherClientId, callEndedEvent);
          // Also broadcast to all for status API (M3 prep)
          statusManager.broadcastToAll(callEndedEvent);

          reply.send({
            callId: endedCall._id,
            message: 'Call ended'
          });
        } catch (err: any) {
          if (err instanceof CallError) {
            reply.code(err.statusCode).send({ message: err.message } as any);
          } else {
            Log().error(`Failed to end call: ${err.message}`);
            reply.code(500).send({ message: 'Failed to end call' } as any);
          }
        }
      }
    );

    // ── GET /call/active — List active calls for current client ──
    fastify.get<{
      Reply: typeof ActiveCallsResponse.static;
    }>(
      '/call/active',
      {
        preHandler: requireAuth,
        schema: {
          description: 'List active calls for the authenticated client',
          response: { 200: ActiveCallsResponse }
        }
      },
      async (request, reply) => {
        const { clientId } = request.client!;

        const calls = await callManager.getActiveCallsForClient(clientId);

        reply.send({
          calls: calls.map((call) => ({
            callId: call._id,
            callerId: call.callerId,
            callerName: call.callerName,
            calleeId: call.calleeId,
            calleeName: call.calleeName,
            state: call.state,
            direction:
              call.callerId === clientId
                ? ('outgoing' as const)
                : ('incoming' as const),
            createdAt: call.createdAt
          }))
        });
      }
    );

    next();
  };
};
