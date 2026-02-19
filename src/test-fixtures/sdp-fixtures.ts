import { parse, SessionDescription } from 'sdp-transform';
import { Static } from '@sinclair/typebox';
import { SmbEndpointDescription } from '../models';

type SmbEndpoint = Static<typeof SmbEndpointDescription>;

// ── Audio-only SDP offer ─────────────────────────────────────────────

const AUDIO_ONLY_SDP = [
  'v=0',
  'o=- 123456 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=msid-semantic: WMS stream0',
  'a=ice-ufrag:clientUfrag',
  'a=ice-pwd:clientPassword',
  'a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
  'a=setup:actpass',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=mid:0',
  'a=sendrecv',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:0 PCMU/8000',
  'a=ssrc:1001 cname:audioStream',
  'a=ssrc:1001 msid:stream0 audio0',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
  'a=candidate:1 1 UDP 2130706431 192.168.1.100 50000 typ host',
  'a=candidate:2 1 UDP 1694498815 203.0.113.1 50001 typ srflx raddr 192.168.1.100 rport 50000',
  ''
].join('\r\n');

// ── Audio + Video SDP offer ──────────────────────────────────────────

const AUDIO_VIDEO_SDP = [
  'v=0',
  'o=- 789012 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'a=msid-semantic: WMS stream0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=ice-ufrag:videoUfrag',
  'a=ice-pwd:videoPassword',
  'a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00',
  'a=setup:actpass',
  'a=mid:0',
  'a=sendrecv',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:0 PCMU/8000',
  'a=ssrc:2001 cname:audioStream',
  'a=ssrc:2001 msid:stream0 audio0',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
  'a=candidate:1 1 UDP 2130706431 192.168.1.100 50000 typ host',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=ice-ufrag:videoUfrag',
  'a=ice-pwd:videoPassword',
  'a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00',
  'a=setup:actpass',
  'a=mid:1',
  'a=sendrecv',
  'a=rtcp-mux',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 rtx/90000',
  'a=rtpmap:98 H264/90000',
  'a=fmtp:97 apt=96',
  'a=fmtp:98 profile-level-id=42e01f;level-asymmetry-allowed=1;packetization-mode=1',
  'a=rtcp-fb:96 nack',
  'a=rtcp-fb:96 goog-remb',
  'a=rtcp-fb:96 transport-cc',
  'a=rtcp-fb:98 nack',
  'a=ssrc:3001 cname:videoStream',
  'a=ssrc:3001 msid:stream0 video0',
  'a=ssrc:3002 cname:videoStream',
  'a=ssrc:3002 msid:stream0 video0',
  'a=ssrc-group:FID 3001 3002',
  'a=extmap:4 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
  'a=extmap:5 urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id',
  'a=extmap:6 urn:ietf:params:rtp-hdrext:sdes:mid',
  ''
].join('\r\n');

// ── Client SDP answer (data + audio, 2 m= lines) ────────────────────

const CLIENT_SDP_ANSWER = [
  'v=0',
  'o=- 345678 3 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'a=fingerprint:sha-256 CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:answerUfrag',
  'a=ice-pwd:answerPassword',
  'a=setup:active',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=candidate:1 1 UDP 2130706431 192.168.1.200 60000 typ host',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=ice-ufrag:answerUfrag',
  'a=ice-pwd:answerPassword',
  'a=fingerprint:sha-256 CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB',
  'a=setup:active',
  'a=mid:1',
  'a=recvonly',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=ssrc:5001 cname:clientAudio',
  'a=ssrc:5001 msid:clientStream audio0',
  ''
].join('\r\n');

// ── Audio-only SDP answer (1 m= line, triggers media[1] bug) ────────

const AUDIO_ONLY_SDP_ANSWER = [
  'v=0',
  'o=- 345678 3 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=fingerprint:sha-256 CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=ice-ufrag:answerUfrag',
  'a=ice-pwd:answerPassword',
  'a=setup:active',
  'a=mid:0',
  'a=recvonly',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=ssrc:6001 cname:clientAudio',
  'a=ssrc:6001 msid:clientStream audio0',
  ''
].join('\r\n');

// ── Helper: create mock SMB endpoint description ─────────────────────

export function createMockEndpointDescription(
  overrides?: Partial<SmbEndpoint>
): SmbEndpoint {
  return {
    'bundle-transport': {
      'rtcp-mux': true,
      ice: {
        ufrag: 'smbUfrag',
        pwd: 'smbPassword',
        candidates: [
          {
            generation: 0,
            component: 1,
            protocol: 'udp',
            port: 10000,
            ip: '10.0.0.1',
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
        hash: 'SM:BF:IN:GE:RP:RI:NT:SM:BF:IN:GE:RP:RI:NT:SM:BF:IN:GE:RP:RI:NT:SM:BF:IN:GE:RP:RI:NT:SM:BF:IN:GE'
      }
    },
    audio: {
      ssrcs: [9001],
      'payload-type': {
        id: 111,
        name: 'opus',
        clockrate: 48000,
        channels: 2,
        parameters: { minptime: '10', useinbandfec: '1' },
        'rtcp-fbs': []
      },
      'rtp-hdrexts': [
        { id: 1, uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' },
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
    ...overrides
  };
}

// ── Parsed fixture accessors ─────────────────────────────────────────

export function audioOnlyOffer(): SessionDescription {
  return parse(AUDIO_ONLY_SDP);
}

export function audioVideoOffer(): SessionDescription {
  return parse(AUDIO_VIDEO_SDP);
}

export function clientSdpAnswer(): string {
  return CLIENT_SDP_ANSWER;
}

export function audioOnlySdpAnswer(): string {
  return AUDIO_ONLY_SDP_ANSWER;
}

export function clientSdpAnswerParsed(): SessionDescription {
  return parse(CLIENT_SDP_ANSWER);
}

export function audioOnlySdpAnswerParsed(): SessionDescription {
  return parse(AUDIO_ONLY_SDP_ANSWER);
}

// Export raw strings for handleAnswerRequest which takes string input
export {
  AUDIO_ONLY_SDP,
  AUDIO_VIDEO_SDP,
  CLIENT_SDP_ANSWER,
  AUDIO_ONLY_SDP_ANSWER
};
