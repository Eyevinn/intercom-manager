import { v4 as uuidv4 } from 'uuid';
import { write, parse } from 'sdp-transform';
import { Connection } from './connection';
import { DbManager } from './db/interface';
import { ClientRegistry } from './client_registry';
import { SmbProtocol } from './smb';
import { CallDocument } from './models/call';
import { SmbEndpointDescription } from './models';
import { Log } from './log';

const CALL_TIMEOUT_MS = 30_000; // 30s timeout if callee never joins

/**
 * Represents a single SMB (Symphony Media Bridge) instance for
 * multi-SMB load distribution. Each instance tracks its own conference
 * count in memory for least-loaded routing.
 */
export interface SmbInstance {
  /** Full URL to the SMB conferences endpoint, e.g. "https://host/conferences/" */
  url: string;
  /** Bearer token API key for this SMB instance */
  apiKey: string;
  /** In-memory count of active conferences allocated on this instance */
  conferenceCount: number;
  /** Maximum conferences before this instance is considered full (default 80) */
  maxConferences: number;
}

/**
 * CallManager handles the lifecycle of directed P2P calls:
 * - Allocate SMB conference + endpoints (with multi-SMB routing)
 * - Generate SDP offers for caller and callee
 * - Process SDP answers and configure SMB endpoints
 * - Track call state, handle timeouts, clean up
 *
 * Each call creates a dedicated SMB conference with two endpoints
 * (caller and callee) for audio isolation per requirement R2.1.
 *
 * Multi-SMB mode: when multiple SmbInstances are provided, new calls
 * are routed to the instance with the fewest active conferences
 * (least-loaded routing). Conference counts are tracked in memory
 * and reset to 0 on restart (safe: SMB idle timeout cleans orphans).
 */
export class CallManager {
  private dbManager: DbManager;
  private clientRegistry: ClientRegistry;
  private smb: SmbProtocol;
  private smbInstances: SmbInstance[];
  private endpointIdleTimeout: number;
  private callTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /**
   * Maps conferenceId -> SmbInstance URL for looking up which SMB
   * instance a call's conference lives on. Populated on allocate,
   * removed on call end/timeout/disconnect.
   */
  private conferenceToSmbUrl: Map<string, string> = new Map();

  constructor(
    dbManager: DbManager,
    clientRegistry: ClientRegistry,
    smb: SmbProtocol,
    smbInstances: SmbInstance[],
    endpointIdleTimeout: number
  ) {
    this.dbManager = dbManager;
    this.clientRegistry = clientRegistry;
    this.smb = smb;
    this.smbInstances = smbInstances;
    this.endpointIdleTimeout = endpointIdleTimeout;

    Log().info(
      `CallManager initialized with ${
        smbInstances.length
      } SMB instance(s): ${smbInstances.map((s) => s.url).join(', ')}`
    );
  }

  /**
   * Select the SMB instance with the fewest active conferences
   * (least-loaded routing). Throws 503 if all instances are at capacity.
   */
  private selectSmbInstance(): SmbInstance {
    let best: SmbInstance | null = null;

    for (const instance of this.smbInstances) {
      if (instance.conferenceCount < instance.maxConferences) {
        if (!best || instance.conferenceCount < best.conferenceCount) {
          best = instance;
        }
      }
    }

    if (!best) {
      throw new CallError(
        503,
        `All ${this.smbInstances.length} SMB instances at capacity (max ${
          this.smbInstances[0]?.maxConferences ?? 0
        } conferences each)`
      );
    }

    return best;
  }

  /**
   * Resolve the SMB URL for an existing call's conference.
   * First checks the in-memory map, then falls back to the call document's
   * smbInstanceUrl field, and finally falls back to the first SMB instance.
   */
  private getSmbUrlForConference(
    conferenceId: string,
    call?: CallDocument
  ): string {
    // 1. In-memory lookup (fastest, always available for calls created this session)
    const memUrl = this.conferenceToSmbUrl.get(conferenceId);
    if (memUrl) return memUrl;

    // 2. Persisted in call document (available after restart)
    if (call?.smbInstanceUrl) return call.smbInstanceUrl;

    // 3. Fallback: first instance (backward compat for pre-multi-SMB calls)
    return this.smbInstances[0].url;
  }

  /**
   * Get the API key for an SMB instance by its URL.
   */
  private getApiKeyForUrl(smbUrl: string): string {
    const instance = this.smbInstances.find((s) => s.url === smbUrl);
    return instance?.apiKey ?? this.smbInstances[0].apiKey;
  }

  /**
   * Decrement the conference count for the SMB instance hosting the given
   * conference, and remove the conference from the in-memory map.
   */
  private releaseConference(conferenceId: string): void {
    const smbUrl = this.conferenceToSmbUrl.get(conferenceId);
    if (smbUrl) {
      const instance = this.smbInstances.find((s) => s.url === smbUrl);
      if (instance && instance.conferenceCount > 0) {
        instance.conferenceCount--;
        Log().info(
          `SMB ${smbUrl}: released conference ${conferenceId} (now ${instance.conferenceCount}/${instance.maxConferences})`
        );
      }
      this.conferenceToSmbUrl.delete(conferenceId);
    }
  }

  /**
   * Initiate a new call from callerId to calleeId.
   * Allocates SMB conference + both endpoints, generates caller SDP offer.
   * Returns the call document and the caller's SDP offer string.
   */
  async initiateCall(
    callerId: string,
    callerName: string,
    calleeId: string
  ): Promise<{
    call: CallDocument;
    callerSdpOffer: string;
  }> {
    // 1. Verify callee exists and is online
    const callee = await this.clientRegistry.getClient(calleeId);
    if (!callee) throw new CallError(404, 'Client not found');
    if (!callee.isOnline) throw new CallError(409, 'Client is offline');
    if (callerId === calleeId) throw new CallError(400, 'Cannot call yourself');

    // 2. Select SMB instance (least-loaded routing)
    const smbInstance = this.selectSmbInstance();
    const smbUrl = smbInstance.url;
    const smbApiKey = smbInstance.apiKey;

    Log().info(
      `Routing call to SMB ${smbUrl} (${smbInstance.conferenceCount}/${smbInstance.maxConferences} conferences)`
    );

    // 3. Allocate SMB conference
    const conferenceId = await this.smb.allocateConference(smbUrl, smbApiKey);

    // Track conference -> SMB instance mapping
    smbInstance.conferenceCount++;
    this.conferenceToSmbUrl.set(conferenceId, smbUrl);

    Log().info(
      `SMB ${smbUrl}: allocated conference ${conferenceId} (now ${smbInstance.conferenceCount}/${smbInstance.maxConferences})`
    );

    // 4. Allocate caller endpoint (audio + data channel)
    const callerEndpointId = uuidv4();
    const callerEndpoint = await this.smb.allocateEndpoint(
      smbUrl,
      conferenceId,
      callerEndpointId,
      true, // audio
      true, // data
      true, // iceControlling
      'ssrc-rewrite',
      this.endpointIdleTimeout,
      smbApiKey
    );

    // 5. Allocate callee endpoint (audio + data channel)
    const calleeEndpointId = uuidv4();
    const calleeEndpoint = await this.smb.allocateEndpoint(
      smbUrl,
      conferenceId,
      calleeEndpointId,
      true, // audio
      true, // data
      true, // iceControlling
      'ssrc-rewrite',
      this.endpointIdleTimeout,
      smbApiKey
    );

    // 6. Generate caller SDP offer
    const callerSdpOffer = this.generateSdpOffer(
      callerEndpointId,
      callerEndpoint
    );

    // 7. Create call document
    const callId = `call_${uuidv4()}`;
    const call: CallDocument = {
      _id: callId,
      docType: 'call',
      callerId,
      callerName,
      calleeId,
      calleeName: callee.name,
      smbConferenceId: conferenceId,
      smbInstanceUrl: smbUrl,
      state: 'offering',
      callerEndpointId,
      calleeEndpointId,
      callerSessionDescription: callerEndpoint,
      calleeSessionDescription: calleeEndpoint,
      callerReady: false,
      calleeReady: false,
      createdAt: new Date().toISOString(),
      endedAt: null
    };

    await this.dbManager.saveCall(call);

    // 8. Start timeout for callee join
    this.startCallTimeout(callId);

    Log().info(
      `Call initiated: ${callId} (${callerName} -> ${callee.name}) on SMB ${smbUrl}`
    );
    return { call, callerSdpOffer };
  }

  /**
   * Complete caller signaling: parse caller's SDP answer and configure
   * the caller endpoint on SMB.
   */
  async completeCallerSignaling(
    callId: string,
    clientId: string,
    sdpAnswer: string
  ): Promise<void> {
    const call = await this.getCallOrThrow(callId);
    if (call.callerId !== clientId) {
      throw new CallError(401, 'Not authorized for this call');
    }
    if (call.state === 'ended') {
      throw new CallError(409, 'Call has ended');
    }

    // Configure caller endpoint on SMB with the SDP answer
    await this.configureEndpointFromSdpAnswer(
      call.smbConferenceId,
      call.callerEndpointId,
      call.callerSessionDescription as SmbEndpointDescription,
      sdpAnswer,
      call
    );

    // Update call state
    const updates: Partial<CallDocument> = { callerReady: true };

    // Check if both sides are ready
    if (call.calleeReady) {
      updates.state = 'active';
    }

    await this.dbManager.updateCall(callId, updates);
    Log().info(`Caller signaling complete for call ${callId}`);
  }

  /**
   * Callee joins the call: generate SDP offer for the callee's
   * pre-allocated endpoint.
   */
  async joinCall(callId: string, clientId: string): Promise<string> {
    const call = await this.getCallOrThrow(callId);
    if (call.calleeId !== clientId) {
      throw new CallError(401, 'Not authorized for this call');
    }
    if (call.state === 'ended') {
      throw new CallError(409, 'Call has ended');
    }

    // Generate callee SDP offer from pre-allocated endpoint
    const calleeSdpOffer = this.generateSdpOffer(
      call.calleeEndpointId,
      call.calleeSessionDescription as SmbEndpointDescription
    );

    Log().info(`Callee joining call ${callId}`);
    return calleeSdpOffer;
  }

  /**
   * Complete callee signaling: parse callee's SDP answer and configure
   * the callee endpoint on SMB.
   */
  async completeCalleeSignaling(
    callId: string,
    clientId: string,
    sdpAnswer: string
  ): Promise<CallDocument> {
    const call = await this.getCallOrThrow(callId);
    if (call.calleeId !== clientId) {
      throw new CallError(401, 'Not authorized for this call');
    }
    if (call.state === 'ended') {
      throw new CallError(409, 'Call has ended');
    }

    // Idempotency guard: if callee signaling already completed, return
    // the existing call document. This handles duplicate calls from the
    // frontend (React race condition) without hitting SMB again.
    if (call.calleeReady) {
      Log().info(
        `Callee signaling already complete for call ${callId}, skipping duplicate`
      );
      return call;
    }

    // Configure callee endpoint on SMB with the SDP answer
    await this.configureEndpointFromSdpAnswer(
      call.smbConferenceId,
      call.calleeEndpointId,
      call.calleeSessionDescription as SmbEndpointDescription,
      sdpAnswer,
      call
    );

    // Update call state
    const updates: Partial<CallDocument> = { calleeReady: true };

    // Fetch latest state to check if caller is ready
    const latestCall = await this.getCallOrThrow(callId);
    if (latestCall.callerReady) {
      updates.state = 'active';
    }

    // Clear timeout since callee has joined
    this.clearCallTimeout(callId);

    const updatedCall = await this.dbManager.updateCall(callId, updates);
    Log().info(`Callee signaling complete for call ${callId}`);

    return updatedCall || { ...latestCall, ...updates };
  }

  /**
   * End a call: clean up SMB conference and update state.
   * Either the caller or the callee can end the call.
   */
  async endCall(
    callId: string,
    clientId: string,
    reason?: string
  ): Promise<CallDocument> {
    const call = await this.getCallOrThrow(callId);
    if (call.callerId !== clientId && call.calleeId !== clientId) {
      throw new CallError(401, 'Not authorized for this call');
    }
    if (call.state === 'ended') {
      throw new CallError(409, 'Call has already ended');
    }

    // Determine end reason
    const endReason =
      reason ||
      (call.callerId === clientId ? 'caller_hangup' : 'callee_hangup');

    // Clean up SMB conference and release conference count
    await this.cleanupSmbConference(call.smbConferenceId);
    this.releaseConference(call.smbConferenceId);

    // Clear timeout
    this.clearCallTimeout(callId);

    // Update call state
    const updates: Partial<CallDocument> = {
      state: 'ended',
      endedAt: new Date().toISOString(),
      endedBy: clientId,
      endReason: endReason as CallDocument['endReason']
    };

    const updatedCall = await this.dbManager.updateCall(callId, updates);
    Log().info(`Call ended: ${callId} (reason: ${endReason})`);

    return updatedCall || ({ ...call, ...updates } as CallDocument);
  }

  /**
   * End a call due to client disconnect. Called by StatusManager when
   * a client's WebSocket disconnects.
   */
  async endCallDueToDisconnect(
    callId: string,
    disconnectedClientId: string
  ): Promise<CallDocument | null> {
    try {
      const call = await this.dbManager.getCall(callId);
      if (!call || call.state === 'ended') return null;

      const reason =
        call.callerId === disconnectedClientId
          ? 'caller_disconnected'
          : 'callee_disconnected';

      await this.cleanupSmbConference(call.smbConferenceId);
      this.releaseConference(call.smbConferenceId);
      this.clearCallTimeout(callId);

      const updates: Partial<CallDocument> = {
        state: 'ended',
        endedAt: new Date().toISOString(),
        endedBy: disconnectedClientId,
        endReason: reason as CallDocument['endReason']
      };

      return await this.dbManager.updateCall(callId, updates);
    } catch (err: any) {
      Log().error(
        `Failed to end call ${callId} due to disconnect: ${err.message}`
      );
      return null;
    }
  }

  /**
   * Get active calls for a client (used for state recovery on page refresh).
   */
  async getActiveCallsForClient(clientId: string): Promise<CallDocument[]> {
    return this.dbManager.getActiveCallsForClient(clientId);
  }

  /**
   * Get a call by ID.
   */
  async getCall(callId: string): Promise<CallDocument | null> {
    return this.dbManager.getCall(callId);
  }

  /**
   * Get a snapshot of SMB instance load for monitoring/debugging.
   */
  getSmbInstanceStatus(): Array<{
    url: string;
    conferenceCount: number;
    maxConferences: number;
  }> {
    return this.smbInstances.map((s) => ({
      url: s.url,
      conferenceCount: s.conferenceCount,
      maxConferences: s.maxConferences
    }));
  }

  // ── Private helpers ──

  /**
   * Generate an SDP offer from an SMB endpoint description.
   * Follows the same pattern as CoreFunctions.createConnection in
   * api_productions_core_functions.ts.
   */
  private generateSdpOffer(
    endpointId: string,
    endpointDescription: SmbEndpointDescription
  ): string {
    if (!endpointDescription?.audio?.ssrcs) {
      throw new Error('Missing audio SSRCs in endpoint description');
    }

    const ssrcs = endpointDescription.audio.ssrcs.map((ssrcNr: number) => ({
      ssrc: ssrcNr.toString(),
      cname: uuidv4(),
      mslabel: uuidv4(),
      label: uuidv4()
    }));

    const connection = new Connection(
      `call_${endpointId}`,
      { audio: { ssrcs } },
      endpointDescription as any, // Cast: SmbEndpointDescription -> SfuEndpointDescription
      endpointId
    );

    const offer = connection.createOffer();
    return write(offer);
  }

  /**
   * Parse an SDP answer and configure the corresponding SMB endpoint.
   * Simplified version of CoreFunctions.handleAnswerRequest for
   * audio-only P2P calls.
   */
  private async configureEndpointFromSdpAnswer(
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    sdpAnswer: string,
    call?: CallDocument
  ): Promise<void> {
    if (!endpointDescription) {
      throw new Error('Missing endpoint description');
    }

    // Deep copy to avoid mutating stored description
    const endpoint: SmbEndpointDescription = JSON.parse(
      JSON.stringify(endpointDescription)
    );

    const parsedAnswer = parse(sdpAnswer);

    // Find the audio media description in the SDP answer.
    // The SDP typically has a data channel (application) as media[0] and
    // audio as media[1], but we search by type to be safe.
    const audioMedia = parsedAnswer.media.find((m) => m.type === 'audio');
    if (!audioMedia) {
      throw new Error('Missing audio media in SDP answer');
    }

    // Extract audio SSRCs from the answer
    endpoint.audio.ssrcs = [];
    if (audioMedia.ssrcs) {
      // Prefer SSRCs with msid attribute (most reliable)
      const msidSsrcs = audioMedia.ssrcs
        .filter((s) => s.attribute === 'msid')
        .map((s) =>
          typeof s.id === 'string' ? parseInt(s.id, 10) : (s.id as number)
        );

      if (msidSsrcs.length > 0) {
        endpoint.audio.ssrcs = msidSsrcs;
      } else if (audioMedia.ssrcs.length > 0) {
        // Fallback: use the first SSRC from any attribute
        const firstSsrc = audioMedia.ssrcs[0].id;
        endpoint.audio.ssrcs.push(
          typeof firstSsrc === 'string'
            ? parseInt(firstSsrc, 10)
            : (firstSsrc as number)
        );
      }
    }

    // Update bundle-transport from SDP answer (ICE + DTLS parameters)
    const transport = endpoint['bundle-transport'];
    if (transport) {
      // DTLS fingerprint
      if (transport.dtls) {
        const fingerprint = parsedAnswer.fingerprint || audioMedia.fingerprint;
        if (fingerprint) {
          transport.dtls.type = fingerprint.type;
          transport.dtls.hash = fingerprint.hash;
        }
        transport.dtls.setup = audioMedia.setup || '';
      }

      // ICE credentials and candidates
      if (transport.ice) {
        transport.ice.ufrag = String(audioMedia.iceUfrag || '');
        transport.ice.pwd = audioMedia.icePwd || '';
        transport.ice.candidates = !audioMedia.candidates
          ? []
          : audioMedia.candidates.map((c) => ({
              generation: c.generation ? c.generation : 0,
              component: c.component,
              protocol: c.transport?.toLowerCase() || 'udp',
              port: c.port,
              ip: c.ip,
              'rel-port': c.rport,
              'rel-addr': c.raddr,
              foundation: c.foundation?.toString() || '',
              priority: parseInt(String(c.priority), 10),
              type: c.type,
              network: c['network-id']
            }));
      }
    }

    // Resolve the correct SMB URL for this conference
    const smbUrl = this.getSmbUrlForConference(conferenceId, call);
    const smbApiKey = this.getApiKeyForUrl(smbUrl);

    // Configure the endpoint on SMB
    await this.smb.configureEndpoint(
      smbUrl,
      conferenceId,
      endpointId,
      endpoint,
      smbApiKey
    );
  }

  /**
   * Clean up an SMB conference. SMB's idle timeout provides a safety net;
   * endpoints will auto-expire if the backend fails to clean up explicitly.
   */
  private async cleanupSmbConference(conferenceId: string): Promise<void> {
    try {
      // SMB does not expose a direct "delete conference" API.
      // The conference will be cleaned up by SMB's idle timeout
      // (ENDPOINT_IDLE_TIMEOUT_S). This is the same behavior as
      // the existing line-based conference cleanup.
      Log().info(
        `SMB conference ${conferenceId} will be cleaned up by idle timeout`
      );
    } catch (err: any) {
      Log().error(
        `Failed to cleanup SMB conference ${conferenceId}: ${err.message}`
      );
    }
  }

  /**
   * Retrieve a call document or throw a 404 CallError.
   */
  private async getCallOrThrow(callId: string): Promise<CallDocument> {
    const call = await this.dbManager.getCall(callId);
    if (!call) throw new CallError(404, 'Call not found');
    return call;
  }

  /**
   * Start a timeout that auto-ends the call if the callee never joins.
   */
  private startCallTimeout(callId: string): void {
    const timeout = setTimeout(async () => {
      try {
        const call = await this.dbManager.getCall(callId);
        if (call && call.state === 'offering') {
          Log().info(`Call ${callId} timed out waiting for callee`);
          await this.cleanupSmbConference(call.smbConferenceId);
          this.releaseConference(call.smbConferenceId);
          await this.dbManager.updateCall(callId, {
            state: 'ended',
            endedAt: new Date().toISOString(),
            endReason: 'timeout'
          });
        }
      } catch (err: any) {
        Log().error(`Failed to timeout call ${callId}: ${err.message}`);
      }
      this.callTimeouts.delete(callId);
    }, CALL_TIMEOUT_MS);

    this.callTimeouts.set(callId, timeout);
  }

  /**
   * Clear a pending call timeout.
   */
  private clearCallTimeout(callId: string): void {
    const timeout = this.callTimeouts.get(callId);
    if (timeout) {
      clearTimeout(timeout);
      this.callTimeouts.delete(callId);
    }
  }

  /**
   * Clean up all pending timeouts (for graceful shutdown).
   */
  destroy(): void {
    for (const [, timeout] of this.callTimeouts) {
      clearTimeout(timeout);
    }
    this.callTimeouts.clear();
  }
}

/**
 * Custom error class for call-related errors with HTTP status codes.
 * Used by api_calls.ts route handlers to map errors to HTTP responses.
 */
export class CallError extends Error {
  public statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'CallError';
  }
}
