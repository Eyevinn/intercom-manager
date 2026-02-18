import { Static, Type } from '@sinclair/typebox';

// ── TypeBox schemas for P2P call management (M2) ──

export const CallState = Type.Union([
  Type.Literal('offering'),
  Type.Literal('active'),
  Type.Literal('ended')
]);
export type CallState = Static<typeof CallState>;

export const CallEndReason = Type.Union([
  Type.Literal('caller_hangup'),
  Type.Literal('callee_hangup'),
  Type.Literal('caller_disconnected'),
  Type.Literal('callee_disconnected'),
  Type.Literal('timeout')
]);
export type CallEndReason = Static<typeof CallEndReason>;

/**
 * Core call document stored in CouchDB.
 * _id is prefixed with "call_" followed by a UUID v4.
 * Each call represents a directed P2P audio session between two clients,
 * backed by a dedicated SMB conference for audio isolation.
 */
export const CallDocument = Type.Object({
  _id: Type.String({ description: 'Call ID (prefixed with call_)' }),
  _rev: Type.Optional(Type.String()),
  docType: Type.Literal('call'),
  callerId: Type.String(),
  callerName: Type.String(),
  calleeId: Type.String(),
  calleeName: Type.String(),
  smbConferenceId: Type.String(),
  smbInstanceUrl: Type.Optional(
    Type.String({
      description: 'SMB instance URL used for this call (multi-SMB routing)'
    })
  ),
  state: CallState,
  callerEndpointId: Type.String(),
  calleeEndpointId: Type.String(),
  callerSessionDescription: Type.Optional(Type.Any()),
  calleeSessionDescription: Type.Optional(Type.Any()),
  callerReady: Type.Boolean(),
  calleeReady: Type.Boolean(),
  createdAt: Type.String({ format: 'date-time' }),
  endedAt: Type.Optional(
    Type.Union([Type.String({ format: 'date-time' }), Type.Null()])
  ),
  endedBy: Type.Optional(Type.String()),
  endReason: Type.Optional(CallEndReason)
});
export type CallDocument = Static<typeof CallDocument>;

// ── API Request/Response schemas ──

/**
 * Request body for POST /api/v1/calls (initiate a call)
 */
export const InitiateCallRequest = Type.Object({
  calleeId: Type.String({ description: 'Target client ID' })
});
export type InitiateCallRequest = Static<typeof InitiateCallRequest>;

/**
 * Response body for POST /api/v1/calls (caller receives SDP offer)
 */
export const InitiateCallResponse = Type.Object({
  callId: Type.String(),
  sdpOffer: Type.String(),
  calleeId: Type.String(),
  calleeName: Type.String()
});
export type InitiateCallResponse = Static<typeof InitiateCallResponse>;

/**
 * Request body for PATCH /api/v1/calls/:callId/answer (SDP answer)
 */
export const CallSdpAnswer = Type.Object({
  sdpAnswer: Type.String({
    maxLength: 16384,
    description: 'SDP answer from client'
  })
});
export type CallSdpAnswer = Static<typeof CallSdpAnswer>;

/**
 * Response body for callee joining a call (SDP offer for callee)
 */
export const JoinCallResponse = Type.Object({
  callId: Type.String(),
  sdpOffer: Type.String(),
  callerId: Type.String(),
  callerName: Type.String()
});
export type JoinCallResponse = Static<typeof JoinCallResponse>;

/**
 * Response body for DELETE /api/v1/calls/:callId (end a call)
 */
export const EndCallResponse = Type.Object({
  callId: Type.String(),
  message: Type.String()
});
export type EndCallResponse = Static<typeof EndCallResponse>;

/**
 * Single entry in the active calls list
 */
export const ActiveCallEntry = Type.Object({
  callId: Type.String(),
  callerId: Type.String(),
  callerName: Type.String(),
  calleeId: Type.String(),
  calleeName: Type.String(),
  state: CallState,
  direction: Type.Union([Type.Literal('incoming'), Type.Literal('outgoing')]),
  createdAt: Type.String({ format: 'date-time' })
});
export type ActiveCallEntry = Static<typeof ActiveCallEntry>;

/**
 * Response body for GET /api/v1/calls (list active calls for current client)
 */
export const ActiveCallsResponse = Type.Object({
  calls: Type.Array(ActiveCallEntry)
});
export type ActiveCallsResponse = Static<typeof ActiveCallsResponse>;
