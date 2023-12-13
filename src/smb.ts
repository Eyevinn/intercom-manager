interface SmbCandidate {
  generation: number;
  component: number;
  protocol: string;
  port: number;
  ip: string;
  'rel-port'?: number;
  'rel-addr'?: string;
  foundation: string;
  priority: number;
  type: string;
  network?: number;
}

interface SmbTransport {
  'rtcp-mux'?: boolean;
  ice?: {
    ufrag: string;
    pwd: string;
    candidates: SmbCandidate[];
  };
  dtls?: {
    setup: string;
    type: string;
    hash: string;
  };
}

interface RtcpFeedback {
  type: string;
  subtype: string;
}

interface AudioSmbPayloadParameters {
  minptime: string;
  useinbandfec: string;
}

interface AudioSmbPayloadType {
  id: number;
  name: string;
  clockrate: number;
  channels?: number;
  parameters: AudioSmbPayloadParameters;
  'rtcp-fbs'?: RtcpFeedback[];
}
interface SmbRtpHeaderExtension {
  id: number;
  uri: string;
}

export interface SmbVideoSource {
  main: number;
  feedback?: number;
}

export interface SmbVideoStream {
  sources: SmbVideoSource[];
  id: string;
  content: string;
}

export interface SmbEndpointDescription {
  'bundle-transport'?: SmbTransport;
  audio: {
    ssrcs: number[];
    'payload-type': AudioSmbPayloadType;
    'rtp-hdrexts': SmbRtpHeaderExtension[];
  };

  data?: {
    port: number;
  };
  idleTimeout?: number;
}

export interface AllocateConferenceResponse {
  id: string;
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
  data?: object;
  idleTimeout?: number;
}

export interface DetailedConference {
  dtlsState: string;
  iceState: string;
  id: string;
  isActiveTalker: boolean;
  isDominantSpeaker: boolean;
  ActiveTalker?: {
    noiseLevel: number;
    ptt: boolean;
    score: number;
  };
}

export class SmbProtocol {
  async allocateConference(smbUrl: string): Promise<string> {
    const allocateResponse = await fetch(smbUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: '{}'
    });

    if (!allocateResponse.ok) {
      throw new Error(
        `Failed to allocate conference: ${JSON.stringify(
          allocateResponse
        )}, responds with: ${allocateResponse.statusText}`
      );
    }

    const allocateResponseJson: AllocateConferenceResponse =
      await allocateResponse.json();
    return allocateResponseJson['id'];
  }

  async allocateEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    audio: boolean,
    data: boolean,
    idleTimeout: number
  ): Promise<SmbEndpointDescription> {
    const request: BaseAllocationRequest = {
      action: 'allocate',
      'bundle-transport': {
        'ice-controlling': true,
        ice: true,
        dtls: true,
        sdes: false
      }
    };

    if (audio) {
      request['audio'] = { 'relay-type': 'mixed' };
    }
    if (data) {
      request['data'] = {};
    }
    if (idleTimeout) {
      request['idleTimeout'] = idleTimeout;
    }
    console.log(request);

    const url = smbUrl + conferenceId + '/' + endpointId;
    console.log(url);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
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
      await response.json();
    return smbEndpointDescription;
  }

  async configureEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription
  ): Promise<void> {
    const request = JSON.parse(JSON.stringify(endpointDescription));
    request['action'] = 'configure';
    const url = smbUrl + conferenceId + '/' + endpointId;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });
    console.log(request);

    if (!response.ok) {
      console.log(JSON.stringify(request));
      throw new Error('Failed to configure endpoint');
    }
  }

  async getConferences(smbUrl: string): Promise<string[]> {
    const response = await fetch(smbUrl, {
      method: 'GET'
    });

    if (!response.ok) {
      return [];
    }

    const responseBody: string[] = await response.json();
    return responseBody;
  }

  async getConference(
    smbUrl: string,
    conferenceId: string
  ): Promise<DetailedConference[]> {
    const url = smbUrl + conferenceId;
    const response = await fetch(url, {
      method: 'GET'
    });

    if (!response.ok) {
      return [];
    }

    const responseBody: DetailedConference[] = await response.json();
    return responseBody;
  }
}
