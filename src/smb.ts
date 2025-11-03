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

export class SmbProtocol {
  async allocateConference(smbUrl: string, smbKey: string): Promise<string> {
    const allocateResponse = await fetch(smbUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
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
      (await allocateResponse.json()) as AllocateConferenceResponse;
    return allocateResponseJson['id'];
  }

  async allocateEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    audio: boolean,
    data: boolean,
    iceControlling: boolean,
    relayType: 'ssrc-rewrite' | 'forwarder' | 'mixed',
    idleTimeout: number,
    smbKey: string
  ): Promise<SmbEndpointDescription> {
    const request: BaseAllocationRequest = {
      action: 'allocate',
      'bundle-transport': {
        'ice-controlling': iceControlling,
        ice: true,
        dtls: true,
        sdes: false
      },
      audio: {
        ssrcs: []
      },
      video: {
        ssrcs: []
      }
    };

    if (audio) {
      request['audio'] = { 'relay-type': relayType };
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

  async configureEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    smbKey: string
  ): Promise<void> {
    const request = JSON.parse(JSON.stringify(endpointDescription));
    request['action'] = 'configure';
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
      const contentType = response.headers.get('content-type');

      let text;
      let json;

      if (contentType && contentType.indexOf('text/plain') > -1) {
        text = await response.text();
      } else if (contentType && contentType.indexOf('application/json') > -1) {
        json = await response.json();
      }

      throw new Error(
        `Failed to configure endpoint ${text ? text : JSON.stringify(json)}`
      );
    }
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
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      }
    });

    if (!response.ok) {
      return [];
    }

    const responseBody: Conference[] = (await response.json()) as Conference[];
    return responseBody;
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
