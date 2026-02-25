import { Connection } from './connection';
import { SfuEndpointDescription } from './sfu/interface';
import { MediaStreamsInfo } from './media_streams_info';

// Suppress log output in tests
jest.mock('./log', () => ({
  Log: () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  })
}));

// ── Test fixtures ──────────────────────────────────────────────────────────

function createEndpointDescription(
  overrides: Partial<SfuEndpointDescription> = {}
): SfuEndpointDescription {
  return {
    'bundle-transport': {
      ice: {
        ufrag: 'test-ufrag',
        pwd: 'test-pwd',
        candidates: [
          {
            foundation: '1',
            component: 1,
            protocol: 'udp',
            port: 10000,
            ip: '192.168.1.1',
            priority: 2130706431,
            type: 'host',
            generation: 0,
            network: 1
          }
        ]
      },
      dtls: {
        setup: 'actpass',
        type: 'sha-256',
        hash: 'AA:BB:CC:DD'
      }
    },
    audio: {
      ssrcs: [],
      'payload-type': {
        id: 111,
        name: 'opus',
        clockrate: 48000,
        channels: 2,
        parameters: {} as any
      },
      'rtp-hdrexts': []
    },
    data: {
      port: 5000
    },
    ...overrides
  };
}

function createMediaStreams(
  ssrcs: MediaStreamsInfo['audio']['ssrcs'] = []
): MediaStreamsInfo {
  return { audio: { ssrcs } };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Connection', () => {
  // ── Constructor / getters ────────────────────────────────────────────

  describe('constructor and getters', () => {
    it('should return the endpointId as connectionId', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams(),
        createEndpointDescription(),
        'ep-1'
      );

      expect(conn.getId()).toBe('ep-1');
    });

    it('should return the resourceId', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams(),
        createEndpointDescription(),
        'ep-1'
      );

      expect(conn.getResourceId()).toBe('res-1');
    });
  });

  // ── createOffer ──────────────────────────────────────────────────────

  describe('createOffer', () => {
    it('should return a valid SessionDescription with version and origin', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();

      expect(offer.version).toBe(0);
      expect(offer.origin).toEqual(
        expect.objectContaining({
          username: '-',
          netType: 'IN',
          ipVer: 4
        })
      );
      expect(offer.name).toBe('-');
      expect(offer.timing).toEqual({ start: 0, stop: 0 });
    });

    it('should include a data channel media description first (addSFUMids)', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();

      expect(offer.media.length).toBeGreaterThanOrEqual(1);
      const dataMedia = offer.media[0] as any;
      expect(dataMedia.type).toBe('application');
      expect(dataMedia.protocol).toBe('UDP/DTLS/SCTP');
      expect(dataMedia.payloads).toBe('webrtc-datachannel');
      expect(dataMedia.sctpPort).toBe(5000);
      expect(dataMedia.maxMessageSize).toBe(262144);
    });

    it('should include audio media descriptions for each SSRC', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' },
          { ssrc: '2002', cname: 'cn2', mslabel: 'ms2', label: 'lbl2' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();

      // 1 data + 2 audio
      expect(offer.media).toHaveLength(3);
      expect(offer.media[1].type).toBe('audio');
      expect(offer.media[2].type).toBe('audio');
    });

    it('should set correct ICE credentials from endpoint description', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();
      const media = offer.media[0];

      expect(media.iceUfrag).toBe('test-ufrag');
      expect(media.icePwd).toBe('test-pwd');
    });

    it('should set DTLS fingerprint and flip setup from actpass to active', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();
      const media = offer.media[0];

      expect(media.fingerprint).toEqual({
        type: 'sha-256',
        hash: 'AA:BB:CC:DD'
      });
      expect(media.setup).toBe('active');
    });

    it('should set setup to actpass when dtls.setup is not actpass', () => {
      const endpoint = createEndpointDescription();
      endpoint['bundle-transport']!.dtls!.setup = 'active';

      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        endpoint,
        'ep-1'
      );

      const offer = conn.createOffer();
      expect(offer.media[0].setup).toBe('actpass');
    });

    it('should map ICE candidates correctly', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();
      const candidate = offer.media[0].candidates![0];

      expect(candidate).toEqual(
        expect.objectContaining({
          foundation: '1',
          component: 1,
          transport: 'udp',
          priority: 2130706431,
          ip: '192.168.1.1',
          port: 10000,
          type: 'host',
          generation: 0,
          'network-id': 1
        })
      );
    });

    it('should assign sequential MIDs starting from 0', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' },
          { ssrc: '2002', cname: 'cn2', mslabel: 'ms2', label: 'lbl2' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();

      expect(offer.media[0].mid).toBe('0'); // data
      expect(offer.media[1].mid).toBe('1'); // audio 1
      expect(offer.media[2].mid).toBe('2'); // audio 2
    });

    it('should set BUNDLE group with all MIDs', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();

      expect(offer.groups).toEqual([{ type: 'BUNDLE', mids: '0 1' }]);
    });

    it('should set msidSemantic token from audio mslabels', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'streamA', label: 'lbl1' },
          { ssrc: '2002', cname: 'cn2', mslabel: 'streamB', label: 'lbl2' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();

      expect(offer.msidSemantic).toEqual({
        semantic: 'WMS',
        token: 'streamA streamB'
      });
    });

    it('should use default msidSemanticToken when no audio SSRCs', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();

      expect(offer.msidSemantic).toEqual({
        semantic: 'WMS',
        token: 'feedbackvideomslabel'
      });
    });

    it('should populate audio SSRC attributes (cname, label, mslabel, msid)', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();
      const audioMedia = offer.media[1];

      expect(audioMedia.ssrcs).toEqual([
        { id: 1001, attribute: 'cname', value: 'cn1' },
        { id: 1001, attribute: 'label', value: 'lbl1' },
        { id: 1001, attribute: 'mslabel', value: 'ms1' },
        { id: 1001, attribute: 'msid', value: 'ms1 lbl1' }
      ]);
    });

    it('should set audio RTP payload from endpoint description', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();
      const audioMedia = offer.media[1];

      expect(audioMedia.payloads).toBe('111');
      expect(audioMedia.rtp).toEqual([
        {
          payload: 111,
          codec: 'opus',
          rate: 48000,
          encoding: 2
        }
      ]);
    });

    it('should include fmtp when payload parameters exist', () => {
      const endpoint = createEndpointDescription();
      endpoint.audio['payload-type'].parameters = {
        minptime: '10',
        useinbandfec: '1'
      };

      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        endpoint,
        'ep-1'
      );

      const offer = conn.createOffer();
      const audioMedia = offer.media[1];

      expect(audioMedia.fmtp).toEqual([
        {
          payload: 111,
          config: 'minptime=10;useinbandfec=1'
        }
      ]);
    });

    it('should not include fmtp when payload parameters are empty', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();
      const audioMedia = offer.media[1];

      expect(audioMedia.fmtp).toEqual([]);
    });

    it('should include rtp-hdrexts in audio media ext', () => {
      const endpoint = createEndpointDescription();
      endpoint.audio['rtp-hdrexts'] = [
        { id: 1, uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' },
        {
          id: 3,
          uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
        }
      ];

      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        endpoint,
        'ep-1'
      );

      const offer = conn.createOffer();
      const audioMedia = offer.media[1];

      expect(audioMedia.ext).toEqual([
        { value: 1, uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' },
        {
          value: 3,
          uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
        }
      ]);
    });

    it('should set direction to sendrecv and rtcpMux', () => {
      const conn = new Connection(
        'res-1',
        createMediaStreams([
          { ssrc: '1001', cname: 'cn1', mslabel: 'ms1', label: 'lbl1' }
        ]),
        createEndpointDescription(),
        'ep-1'
      );

      const offer = conn.createOffer();

      for (const media of offer.media) {
        expect(media.direction).toBe('sendrecv');
        expect(media.rtcpMux).toBe('rtcp-mux');
      }
    });
  });
});
