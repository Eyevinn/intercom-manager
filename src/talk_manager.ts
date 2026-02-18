import { CallManager } from './call_manager';
import { Log } from './log';

/**
 * In-memory talk state for a single client currently pressing PTT.
 * This is ephemeral — NOT stored in CouchDB.
 * See M3 contract section 2a.
 */
export interface TalkState {
  clientId: string;
  clientName: string;
  targets: Array<{
    clientId: string;
    clientName: string;
    callId: string;
  }>;
  startedAt: string; // ISO 8601 timestamp
}

/**
 * TalkManager manages the in-memory talk state layer (M3).
 *
 * Talk state tracks "who is currently pressing PTT and to whom."
 * This is separate from call state (CouchDB). A call can be `active`
 * with no one currently talking.
 *
 * Rules (from M3 contract section 2a):
 * - A client has at most ONE TalkState entry at a time.
 * - Only the caller in a call can send talk_start.
 * - On talk_stop, the entry is removed entirely.
 * - On client disconnect, talk state is auto-removed.
 * - On call_ended, the target is removed from the targets array.
 */
export class TalkManager {
  private activeTalks: Map<string, TalkState> = new Map();
  private callManager: CallManager;

  constructor(callManager: CallManager) {
    this.callManager = callManager;
  }

  /**
   * Handle a talk_start message from a client.
   *
   * Validates callIds against CallManager: each call must exist,
   * be in 'active' state, and the sender must be the callerId.
   * Invalid call IDs are silently filtered out (contract section 7a).
   *
   * If the client already has an active talk state, it is replaced
   * (contract section 8c — re-pressing PTT with different calls).
   *
   * Returns the TalkState if at least one callId is valid, null otherwise.
   */
  async handleTalkStart(
    clientId: string,
    clientName: string,
    callIds: string[]
  ): Promise<TalkState | null> {
    const validTargets: TalkState['targets'] = [];

    for (const callId of callIds) {
      try {
        const call = await this.callManager.getCall(callId);
        if (call && call.state === 'active' && call.callerId === clientId) {
          validTargets.push({
            clientId: call.calleeId,
            clientName: call.calleeName,
            callId: call._id
          });
        }
      } catch {
        // Invalid call, skip (contract section 7a: silently filtered)
      }
    }

    if (validTargets.length === 0) {
      Log().debug(`talk_start from ${clientId}: all callIds invalid, ignoring`);
      return null;
    }

    const talkState: TalkState = {
      clientId,
      clientName,
      targets: validTargets,
      startedAt: new Date().toISOString()
    };

    this.activeTalks.set(clientId, talkState);
    Log().info(
      `Talk started: ${clientName} -> [${validTargets
        .map((t) => t.clientName)
        .join(', ')}]`
    );
    return talkState;
  }

  /**
   * Handle a talk_stop message from a client.
   *
   * Returns the previous TalkState if the client was talking, null otherwise.
   * If the client has no active talk state, the message is silently ignored
   * (contract section 4b — idempotent).
   */
  handleTalkStop(clientId: string): TalkState | null {
    const existing = this.activeTalks.get(clientId);
    if (!existing) return null;

    this.activeTalks.delete(clientId);
    Log().info(`Talk stopped: ${existing.clientName}`);
    return existing;
  }

  /**
   * Remove all talk state for a client (on disconnect).
   * Returns the removed TalkState if the client was talking, null otherwise.
   * See contract section 8a.
   */
  removeTalksForClient(clientId: string): TalkState | null {
    return this.handleTalkStop(clientId); // Same logic
  }

  /**
   * Remove a specific call from any active talk states.
   * Called when a call ends while someone is talking on it.
   * See contract section 8b.
   *
   * Returns:
   * - { updated: TalkState } if the caller still has other targets
   * - { stopped: TalkState } if the caller's targets are now empty (talk stopped)
   * - null if the call wasn't part of any active talk
   */
  removeCallFromTalks(
    callId: string
  ): { updated: TalkState } | { stopped: TalkState } | null {
    for (const [clientId, talkState] of this.activeTalks) {
      const targetIndex = talkState.targets.findIndex(
        (t) => t.callId === callId
      );
      if (targetIndex === -1) continue;

      // Remove this target
      talkState.targets.splice(targetIndex, 1);

      if (talkState.targets.length === 0) {
        // No more targets — talk stopped entirely
        this.activeTalks.delete(clientId);
        Log().info(`Talk stopped (call ended): ${talkState.clientName}`);
        return { stopped: talkState };
      } else {
        // Still has other targets — update in place
        Log().info(
          `Talk updated (call ended): ${
            talkState.clientName
          } -> [${talkState.targets.map((t) => t.clientName).join(', ')}]`
        );
        return { updated: talkState };
      }
    }
    return null;
  }

  /**
   * Get all active talks (for REST endpoint and WebSocket snapshot).
   * Returns a copy of the values to avoid external mutation.
   */
  getActiveTalks(): TalkState[] {
    return Array.from(this.activeTalks.values());
  }

  /**
   * Get talk state for a specific client.
   */
  getTalkState(clientId: string): TalkState | null {
    return this.activeTalks.get(clientId) || null;
  }

  /**
   * Clean up all state (for graceful shutdown).
   */
  destroy(): void {
    this.activeTalks.clear();
  }
}
