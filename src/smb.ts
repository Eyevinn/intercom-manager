import { Log } from './log';
import { SmbEndpointDescription, DetailedConference } from './models';

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
  data?: object;
  idleTimeout?: number;
}

export class SmbProtocol {
  async allocateConference(smbUrl: string, smbKey: string): Promise<string> {
    console.log('Allocate conference', smbUrl);
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
      await allocateResponse.json();
    return allocateResponseJson['id'];
  }

  async allocateEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    audio: boolean,
    data: boolean,
    idleTimeout: number,
    smbKey: string
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
      request['audio'] = { 'relay-type': 'ssrc-rewrite' };
    }
    if (data) {
      request['data'] = {};
    }
    if (idleTimeout) {
      request['idleTimeout'] = idleTimeout;
    }

    const url = smbUrl + conferenceId + '/' + endpointId;
    Log().debug('Allocate endpoint', url, request);
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
      await response.json();
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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      },
      body: JSON.stringify(request)
    });
    Log().debug('Configure endpoint', url, request);

    if (!response.ok) {
      Log().debug(JSON.stringify(request));

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

    const responseBody: string[] = await response.json();
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

    const responseBody: DetailedConference[] = await response.json();
    return responseBody;
  }
}
