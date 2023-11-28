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

interface SmbPayloadType {
  id: number;
  name: string;
  clockrate: number;
  channels?: number;
  parameters?: any;
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
  audio?: {
    ssrcs: number[];
    'payload-type': SmbPayloadType;
    'rtp-hdrexts': SmbRtpHeaderExtension[];
  };

  video?: {
    streams: SmbVideoStream[];
    'payload-types': SmbPayloadType[];
    'rtp-hdrexts'?: SmbRtpHeaderExtension[];
  };

  data?: {
    port: number;
  };
  idleTimeout?: number;
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

    const allocateResponseJson: any = await allocateResponse.json();
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
    const request: any = {
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

    const smbEndpointDescription: any = await response.json();
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

    const responseBody: any = await response.json();
    return responseBody;
  }
}
