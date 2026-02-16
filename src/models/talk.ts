import { Static, Type } from '@sinclair/typebox';

// ── TypeBox schemas for talk state management (M3) ──

/**
 * A single target in an active talk (who is being talked to).
 */
export const TalkTarget = Type.Object({
  clientId: Type.String({ description: 'Target (callee) client ID' }),
  clientName: Type.String({ description: 'Target display name' }),
  callId: Type.String({
    description: 'Call ID through which this target is reached'
  })
});
export type TalkTarget = Static<typeof TalkTarget>;

/**
 * Represents one client currently pressing PTT.
 * In-memory only — not stored in the database.
 */
export const ActiveTalk = Type.Object({
  clientId: Type.String({ description: 'Talking client ID' }),
  clientName: Type.String({ description: 'Talking client display name' }),
  targets: Type.Array(TalkTarget, {
    description: 'Clients receiving audio'
  }),
  startedAt: Type.String({
    format: 'date-time',
    description: 'When PTT was pressed'
  })
});
export type ActiveTalk = Static<typeof ActiveTalk>;

/**
 * Response body for GET /api/v1/status/talks
 */
export const ActiveTalksResponse = Type.Object({
  talks: Type.Array(ActiveTalk),
  timestamp: Type.String({ format: 'date-time' })
});
export type ActiveTalksResponse = Static<typeof ActiveTalksResponse>;

// ── WebSocket message schemas (for validation) ──

/**
 * Client→Server: talk_start message
 */
export const TalkStartMessage = Type.Object({
  type: Type.Literal('talk_start'),
  callIds: Type.Array(Type.String(), {
    minItems: 1,
    description: 'Active call IDs to talk on'
  })
});
export type TalkStartMessage = Static<typeof TalkStartMessage>;

/**
 * Client→Server: talk_stop message
 */
export const TalkStopMessage = Type.Object({
  type: Type.Literal('talk_stop')
});
export type TalkStopMessage = Static<typeof TalkStopMessage>;
