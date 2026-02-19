import { ISmbProtocol } from './smb';
import { Static } from '@sinclair/typebox';
import {
  Conference,
  DetailedConference,
  SmbEndpointDescription,
  SmbAudioEndpointDescription
} from './models';

type SmbEndpoint = Static<typeof SmbEndpointDescription>;
type SmbAudioEndpoint = Static<typeof SmbAudioEndpointDescription>;
type ConferenceType = Static<typeof Conference>;
type DetailedConferenceType = Static<typeof DetailedConference>;

export class MockSmbProtocol implements ISmbProtocol {
  private conferences: Map<string, Map<string, SmbEndpoint>> = new Map();
  private nextConferenceId = 1;

  async allocateConference(_smbUrl: string, _smbKey: string): Promise<string> {
    const id = `mock-conf-${this.nextConferenceId++}`;
    this.conferences.set(id, new Map());
    return id;
  }

  async allocateEndpoint(
    _smbUrl: string,
    conferenceId: string,
    endpointId: string,
    audio: boolean,
    _data: boolean,
    _iceControlling: boolean,
    _relayType: 'ssrc-rewrite' | 'forwarder' | 'mixed',
    _idleTimeout: number,
    _smbKey: string
  ): Promise<SmbEndpoint> {
    const endpoint: SmbEndpoint = {
      'bundle-transport': {
        'rtcp-mux': true,
        ice: {
          ufrag: `ufrag-${endpointId.slice(0, 8)}`,
          pwd: `pwd-${endpointId.slice(0, 8)}`,
          candidates: [
            {
              generation: 0,
              component: 1,
              protocol: 'udp',
              port: 10000,
              ip: '192.168.1.1',
              foundation: '1',
              priority: 2130706431,
              type: 'host',
              network: 1
            }
          ]
        },
        dtls: {
          setup: 'actpass',
          type: 'sha-256',
          hash: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'
        }
      },
      audio: {
        ssrcs: audio ? [1000 + Math.floor(Math.random() * 9000)] : [],
        'payload-type': {
          id: 111,
          name: 'opus',
          clockrate: 48000,
          channels: 2,
          parameters: { minptime: '10', useinbandfec: '1' },
          'rtcp-fbs': []
        },
        'rtp-hdrexts': [
          {
            id: 1,
            uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level'
          },
          {
            id: 3,
            uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
          }
        ]
      },
      video: {
        ssrcs: [],
        'payload-type': {
          id: 100,
          name: 'VP8',
          clockrate: 90000,
          parameters: {},
          'rtcp-fbs': [{ type: 'nack', subtype: '' }]
        },
        'rtp-hdrexts': []
      },
      data: _data ? { port: 5000 } : undefined
    };

    const conf = this.conferences.get(conferenceId);
    if (!conf) {
      throw new Error(
        `Conference ${conferenceId} not found in MockSmbProtocol`
      );
    }
    conf.set(endpointId, endpoint);
    return endpoint;
  }

  async allocateAudioEndpoint(
    _smbUrl: string,
    conferenceId: string,
    endpointId: string,
    _relayType: 'ssrc-rewrite' | 'forwarder',
    _idleTimeout: number,
    _smbKey: string
  ): Promise<SmbAudioEndpoint> {
    const endpoint: SmbAudioEndpoint = {
      audio: {
        ssrcs: [2000 + Math.floor(Math.random() * 9000)],
        'payload-type': {
          id: 111,
          name: 'opus',
          clockrate: 48000,
          channels: 2,
          parameters: { minptime: '10', useinbandfec: '1' },
          'rtcp-fbs': []
        },
        'rtp-hdrexts': [
          {
            id: 1,
            uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level'
          }
        ],
        transport: {
          'rtcp-mux': true,
          ice: {
            ufrag: `ufrag-audio-${endpointId.slice(0, 8)}`,
            pwd: `pwd-audio-${endpointId.slice(0, 8)}`,
            candidates: [
              {
                generation: 0,
                component: 1,
                protocol: 'udp',
                port: 10001,
                ip: '192.168.1.1',
                foundation: '1',
                priority: 2130706431,
                type: 'host',
                network: 1
              }
            ]
          },
          dtls: {
            setup: 'actpass',
            type: 'sha-256',
            hash: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'
          }
        }
      },
      data: { port: 5000 }
    };

    const conf = this.conferences.get(conferenceId);
    if (conf) {
      conf.set(endpointId, endpoint as any);
    }
    return endpoint;
  }

  async configureEndpoint(
    _smbUrl: string,
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpoint,
    _smbKey: string
  ): Promise<void> {
    const conf = this.conferences.get(conferenceId);
    if (!conf) {
      throw new Error(
        `Conference ${conferenceId} not found in MockSmbProtocol`
      );
    }
    conf.set(endpointId, endpointDescription);
  }

  async getConferences(_smbUrl: string, _smbKey: string): Promise<string[]> {
    return Array.from(this.conferences.keys());
  }

  async getConferencesWithUsers(
    _smbUrl: string,
    _smbKey: string
  ): Promise<ConferenceType[]> {
    const result: ConferenceType[] = [];
    for (const [id, endpoints] of this.conferences) {
      const users = Array.from(endpoints.keys());
      result.push({ id, userCount: users.length, users });
    }
    return result;
  }

  async getConference(
    _smbUrl: string,
    conferenceId: string,
    _smbKey: string
  ): Promise<DetailedConferenceType[]> {
    const conf = this.conferences.get(conferenceId);
    if (!conf) {
      return [];
    }
    const result: DetailedConferenceType[] = [];
    for (const endpointId of conf.keys()) {
      result.push({
        dtlsState: 'connected',
        iceState: 'connected',
        id: endpointId,
        isActiveTalker: false,
        isDominantSpeaker: false
      });
    }
    return result;
  }

  // ── Test helpers (not part of ISmbProtocol) ─────────────────────────

  reset(): void {
    this.conferences.clear();
    this.nextConferenceId = 1;
  }

  getEndpoint(
    conferenceId: string,
    endpointId: string
  ): SmbEndpoint | undefined {
    return this.conferences.get(conferenceId)?.get(endpointId);
  }

  getConferenceEndpoints(
    conferenceId: string
  ): Map<string, SmbEndpoint> | undefined {
    return this.conferences.get(conferenceId);
  }

  hasConference(conferenceId: string): boolean {
    return this.conferences.has(conferenceId);
  }
}
