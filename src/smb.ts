import { Log } from './log';
import {
  Conference,
  DetailedConference,
  SmbAudioEndpointDescription,
  SmbEndpointDescription
} from './models';

interface AllocateConferenceResponse {
  id: string;
}

/**
 * Thrown when SMB rejects a configure/reconfigure action. Carries the HTTP
 * status and raw response body so callers can tell a transient race apart from
 * a real failure without parsing the message string.
 */
export class SmbEndpointActionError extends Error {
  constructor(
    readonly action: 'configure' | 'reconfigure',
    readonly status: number,
    readonly body: string
  ) {
    super(`Failed to ${action} endpoint: status=${status} body=${body}`);
    this.name = 'SmbEndpointActionError';
  }

  /**
   * True when SMB refused a reconfigure because the endpoint exists but has
   * never been configured. An endpoint is allocated first and configured only
   * once the client's SDP answer arrives, so anything that reconfigures it in
   * between — pinning a video source, for instance — loses a race it can win
   * by retrying. Transient by nature: the caller should tell the client to
   * retry rather than report a failure.
   */
  get isEndpointNotConfiguredYet(): boolean {
    return (
      this.status === 400 && /not configured in first place/i.test(this.body)
    );
  }
}

interface BaseAllocationRequest {
  action: string;
  'bundle-transport': {
    'ice-controlling': boolean;
    ice: boolean;
    dtls: boolean;
    sdes: boolean;
  };
  audio?: object;
  video?: object;
  data?: object;
  idleTimeout?: number;
}

interface AudioAllocationRequest {
  action: string;
  audio?: object;
  data?: object;
  idleTimeout?: number;
}

export interface ISmbProtocol {
  allocateConference(
    smbUrl: string,
    smbKey: string,
    lastN?: number
  ): Promise<string>;
  allocateEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    audio: boolean,
    video: boolean,
    data: boolean,
    iceControlling: boolean,
    relayType: 'ssrc-rewrite' | 'forwarder' | 'mixed',
    idleTimeout: number,
    smbKey: string,
    videoRelayType?: 'ssrc-rewrite' | 'forwarder' | 'mixed'
  ): Promise<SmbEndpointDescription>;
  allocateAudioEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    relayType: 'ssrc-rewrite' | 'forwarder',
    idleTimeout: number,
    smbKey: string
  ): Promise<SmbAudioEndpointDescription>;
  configureEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    smbKey: string
  ): Promise<void>;
  reconfigureEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    smbKey: string
  ): Promise<void>;
  requestKeyframe(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    smbKey: string
  ): Promise<void>;
  getConferences(smbUrl: string, smbKey: string): Promise<string[]>;
  getConferencesWithUsers(
    smbUrl: string,
    smbKey: string
  ): Promise<Conference[]>;
  getConference(
    smbUrl: string,
    conferenceId: string,
    smbKey: string
  ): Promise<DetailedConference[]>;
}

export class SmbProtocol implements ISmbProtocol {
  async allocateConference(
    smbUrl: string,
    smbKey: string,
    lastN?: number
  ): Promise<string> {
    const requestBody: Record<string, unknown> = {};
    if (typeof lastN === 'number' && lastN > 0) {
      requestBody['last-n'] = lastN;
    }
    const allocateResponse = await fetch(smbUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      },
      body: JSON.stringify(requestBody)
    });

    if (!allocateResponse.ok) {
      throw new Error(
        `Failed to allocate conference: ${JSON.stringify(
          allocateResponse
        )}, responds with: ${allocateResponse.statusText}`
      );
    }

    const allocateResponseJson: AllocateConferenceResponse =
      (await allocateResponse.json()) as AllocateConferenceResponse;
    return allocateResponseJson['id'];
  }

  async allocateEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    audio: boolean,
    video: boolean,
    data: boolean,
    iceControlling: boolean,
    relayType: 'ssrc-rewrite' | 'forwarder' | 'mixed',
    idleTimeout: number,
    smbKey: string,
    videoRelayType?: 'ssrc-rewrite' | 'forwarder' | 'mixed'
  ): Promise<SmbEndpointDescription> {
    const request: BaseAllocationRequest = {
      action: 'allocate',
      'bundle-transport': {
        'ice-controlling': iceControlling,
        ice: true,
        dtls: true,
        sdes: false
      }
    };

    if (audio) {
      request['audio'] = { 'relay-type': relayType };
    }

    if (video) {
      request['video'] = { 'relay-type': videoRelayType ?? relayType };
    }

    if (data) {
      request['data'] = {};
    }
    if (idleTimeout) {
      request['idleTimeout'] = idleTimeout;
    }
    Log().debug(request);

    const url = smbUrl + conferenceId + '/' + endpointId;
    Log().debug(url);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(
        `Failed to allocate endpoint:  ${JSON.stringify(
          request
        )}, responds with: ${response.statusText}`
      );
    }

    const smbEndpointDescription: SmbEndpointDescription =
      (await response.json()) as SmbEndpointDescription;

    return smbEndpointDescription;
  }

  async allocateAudioEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    relayType: 'ssrc-rewrite' | 'forwarder',
    idleTimeout: number,
    smbKey: string
  ): Promise<SmbAudioEndpointDescription> {
    const request: AudioAllocationRequest = {
      action: 'allocate',
      audio: {
        'relay-type': relayType,
        transport: {
          ice: true,
          dtls: true,
          sdes: false
        }
      },
      idleTimeout: idleTimeout
    };

    Log().debug(request);

    const url = smbUrl + conferenceId + '/' + endpointId;
    Log().debug(url);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(
        `Failed to allocate endpoint:  ${JSON.stringify(
          request
        )}, responds with: ${response.statusText}`
      );
    }

    const smbEndpointDescription: SmbAudioEndpointDescription =
      (await response.json()) as SmbAudioEndpointDescription;

    return smbEndpointDescription;
  }

  private async sendEndpointAction(
    action: 'configure' | 'reconfigure',
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    smbKey: string
  ): Promise<void> {
    const request = JSON.parse(JSON.stringify(endpointDescription));
    request['action'] = action;
    const url = smbUrl + conferenceId + '/' + endpointId;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new SmbEndpointActionError(action, response.status, body);
    }
  }

  async configureEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    smbKey: string
  ): Promise<void> {
    return this.sendEndpointAction(
      'configure',
      smbUrl,
      conferenceId,
      endpointId,
      endpointDescription,
      smbKey
    );
  }

  async reconfigureEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    smbKey: string
  ): Promise<void> {
    return this.sendEndpointAction(
      'reconfigure',
      smbUrl,
      conferenceId,
      endpointId,
      endpointDescription,
      smbKey
    );
  }

  /**
   * Force a fresh keyframe (IDR) to be delivered to a receiver's egress slot.
   *
   * This SMB version exposes no dedicated "request keyframe" / FIR action in
   * its REST surface (only allocate / configure / reconfigure / expire — see
   * SymphonyMediaBridge doc/api/READMEapi.md). A keyframe is only ever
   * solicited internally by `VideoForwarderReceiveJob`, which sends a PLI to a
   * publisher when forwarding for an inbound SSRC (re)initializes and the first
   * forwarded packet is not a keyframe.
   *
   * Swapping the receiver's `ssrc-whitelist` in place (the pin-change path)
   * does NOT re-init that forwarding context, so the decoder freezes on the
   * previous publisher's last frame until the new source emits its next
   * natural keyframe.
   *
   * The viable mechanism with this SMB version is a whitelist remove -> re-add
   * cycle on the receiver's own egress endpoint: clearing then re-applying the
   * whitelist forces SMB to tear down and re-establish the outbound forwarding
   * context for the newly pinned SSRC, which re-engages the
   * "first forwarded packet not a keyframe -> send PLI to publisher" path and
   * yields a fresh IDR. Both steps are plain `reconfigure` PUTs, so this stays
   * consistent with the existing SMB client patterns.
   */
  async requestKeyframe(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    smbKey: string
  ): Promise<void> {
    const targetWhitelist = endpointDescription.video?.['ssrc-whitelist'];
    // Nothing to refresh if there is no video block or no pinned source.
    if (!endpointDescription.video || !targetWhitelist) {
      return;
    }

    // Step 1: clear the whitelist so SMB drops the current forwarding context.
    const cleared: SmbEndpointDescription = JSON.parse(
      JSON.stringify(endpointDescription)
    );
    if (cleared.video) {
      delete cleared.video['ssrc-whitelist'];
    }
    await this.sendEndpointAction(
      'reconfigure',
      smbUrl,
      conferenceId,
      endpointId,
      cleared,
      smbKey
    );

    // Step 2: re-apply the target whitelist. The freshly initialized
    // forwarding context triggers a PLI to the publisher -> fresh keyframe.
    await this.sendEndpointAction(
      'reconfigure',
      smbUrl,
      conferenceId,
      endpointId,
      endpointDescription,
      smbKey
    );
  }

  async getConferences(smbUrl: string, smbKey: string): Promise<string[]> {
    const response = await fetch(smbUrl, {
      method: 'GET',
      headers: {
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      }
    });

    if (!response.ok) {
      return [];
    }

    const responseBody: string[] = (await response.json()) as string[];
    return responseBody;
  }

  async getConferencesWithUsers(
    smbUrl: string,
    smbKey: string
  ): Promise<Conference[]> {
    const url = smbUrl + '?brief';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return [];
      }

      const responseBody: Conference[] =
        (await response.json()) as Conference[];
      return responseBody;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getConference(
    smbUrl: string,
    conferenceId: string,
    smbKey: string
  ): Promise<DetailedConference[]> {
    const url = smbUrl + conferenceId;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      }
    });

    if (!response.ok) {
      return [];
    }

    const responseBody: DetailedConference[] =
      (await response.json()) as DetailedConference[];
    return responseBody;
  }
}
