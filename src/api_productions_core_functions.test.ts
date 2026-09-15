jest.mock('./log', () => ({
  Log: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));

import { MockSmbProtocol } from './mock-smb-protocol';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { Production } from './models';
import {
  audioOnlyOffer,
  audioVideoOffer,
  createMockEndpointDescription,
  clientSdpAnswer,
  audioOnlySdpAnswer
} from './test-fixtures/sdp-fixtures';
import { parse } from 'sdp-transform';

// ── Mock ProductionManager ───────────────────────────────────────────

const mockProduction: Production = {
  _id: 1,
  name: 'sdp-test-prod',
  lines: [{ name: 'Line A', id: 'line-a', smbConferenceId: '' }]
};

const mockProductionManager = {
  requireProduction: jest.fn().mockImplementation(async (id: number) => {
    if (id === mockProduction._id) return mockProduction;
    throw new Error(`Production ${id} not found`);
  }),
  requireLine: jest
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation((lines: any[], lineId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const line = lines.find((l: any) => l.id === lineId);
      if (!line) throw new Error(`Line ${lineId} not found`);
      return line;
    }),
  getLine: jest
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation((lines: any[], lineId: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lines.find((l: any) => l.id === lineId)
    ),
  getProduction: jest.fn().mockImplementation(async (id: number) => {
    if (id === mockProduction._id) return mockProduction;
    return undefined;
  }),
  setLineId: jest
    .fn()
    .mockImplementation(
      async (_prodId: number, lineId: string, smbId: string) => {
        const line = mockProduction.lines.find((l) => l.id === lineId);
        if (line) {
          line.smbConferenceId = smbId;
          return line;
        }
        return undefined;
      }
    ),
  createUserSession: jest.fn().mockResolvedValue(undefined),
  updateUserEndpoint: jest.fn().mockResolvedValue(undefined),
  getUsersForLine: jest.fn().mockReturnValue([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// ── Test suite ───────────────────────────────────────────────────────

describe('CoreFunctions SDP Tests', () => {
  let mockSmb: MockSmbProtocol;
  let coreFunctions: CoreFunctions;
  const smbUrl = 'http://mock-smb/conferences/';
  const smbKey = 'test-key';

  beforeEach(() => {
    mockSmb = new MockSmbProtocol();
    const connectionQueue = new ConnectionQueue();
    coreFunctions = new CoreFunctions(mockProductionManager, connectionQueue);
    mockProduction.lines[0].smbConferenceId = '';
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════
  // Step 3B: configureEndpointForWhipWhep
  // ══════════════════════════════════════════════════════════════════

  describe('configureEndpointForWhipWhep', () => {
    test('extracts ICE ufrag/pwd from session-level offer', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioOnlyOffer();

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-1'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-1');
      expect(configured?.['bundle-transport']?.ice?.ufrag).toBe('clientUfrag');
      expect(configured?.['bundle-transport']?.ice?.pwd).toBe('clientPassword');
    });

    test('extracts ICE ufrag/pwd from media-level when session-level absent', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioVideoOffer();
      // audioVideoOffer has ICE at media-level only

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-2'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-2');
      expect(configured?.['bundle-transport']?.ice?.ufrag).toBe('videoUfrag');
      expect(configured?.['bundle-transport']?.ice?.pwd).toBe('videoPassword');
    });

    test('extracts DTLS fingerprint from offer', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioOnlyOffer();

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-3'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-3');
      const dtls = configured?.['bundle-transport']?.dtls;
      expect(dtls?.type).toBe('sha-256');
      expect(dtls?.hash).toContain('AA:BB:CC');
    });

    test('converts ICE candidates from SDP to SMB format', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioOnlyOffer();

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-4'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-4');
      const candidates = configured?.['bundle-transport']?.ice?.candidates;
      expect(candidates).toBeDefined();
      expect(candidates!.length).toBe(2);
      expect(candidates![0].ip).toBe('192.168.1.100');
      expect(candidates![0].port).toBe(50000);
      expect(candidates![0].type).toBe('host');
      expect(candidates![0].protocol).toBe('udp');
      expect(candidates![1].type).toBe('srflx');
    });

    test('extracts audio SSRCs with msid attribute', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioOnlyOffer();

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-5'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-5');
      expect(configured?.audio.ssrcs).toContain(1001);
    });

    test('sets audio payload type from first rtp entry', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioOnlyOffer();

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-6'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-6');
      expect(configured?.audio['payload-type'].id).toBe(111);
    });

    test('extracts audio rtp header extensions', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioOnlyOffer();

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-7'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-7');
      const exts = configured?.audio['rtp-hdrexts'];
      expect(exts).toBeDefined();
      expect(
        exts!.some(
          (e) => e.uri === 'urn:ietf:params:rtp-hdrext:ssrc-audio-level'
        )
      ).toBe(true);
    });

    test('handles video streams with FID ssrc groups', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioVideoOffer();

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-8'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-8');
      expect(configured?.video).toBeDefined();
      expect(configured?.video?.['payload-type']?.name).toBe('H264');
      expect(configured?.video?.['payload-type']?.clockrate).toBe(90000);
    });

    test('filters video codecs to supported only (VP8/H264)', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioVideoOffer();

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-9'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-9');
      // H264 (98) is preferred over VP8 (96); rtx (97/99) and VP9 are
      // filtered out of the supported set.
      expect(configured?.video?.['payload-type']?.id).toBe(98);
    });

    test('filters video rtp-hdrexts to abs-send-time and rtp-stream-id', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioVideoOffer();

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-10'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-10');
      const videoExts = configured?.video?.['rtp-hdrexts'];
      expect(videoExts).toBeDefined();
      videoExts!.forEach((ext) => {
        expect(
          ext.uri.includes('abs-send-time') || ext.uri.includes('rtp-stream-id')
        ).toBe(true);
      });
    });

    test('clears data field on configured endpoint', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      endpoint.data = { port: 5000 };
      const offer = audioOnlyOffer();

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-11'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-11');
      expect(configured?.data).toBeUndefined();
    });

    test('calls smb.configureEndpoint with correct args', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioOnlyOffer();

      const spy = jest.spyOn(mockSmb, 'configureEndpoint');

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-12'
      );

      expect(spy).toHaveBeenCalledWith(
        smbUrl,
        confId,
        'ep-12',
        expect.any(Object),
        smbKey
      );
    });

    test('throws when bundle-transport is missing', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      delete (endpoint as any)['bundle-transport'];
      const offer = audioOnlyOffer();

      await expect(
        coreFunctions.configureEndpointForWhipWhep(
          offer,
          endpoint,
          mockSmb,
          smbUrl,
          smbKey,
          confId,
          'ep-err'
        )
      ).rejects.toThrow('Missing bundle-transport');
    });

    test('throws when dtls is missing', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      delete (endpoint as any)['bundle-transport'].dtls;
      const offer = audioOnlyOffer();

      await expect(
        coreFunctions.configureEndpointForWhipWhep(
          offer,
          endpoint,
          mockSmb,
          smbUrl,
          smbKey,
          confId,
          'ep-err'
        )
      ).rejects.toThrow('Missing dtls');
    });

    test('throws when ice is missing', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      delete (endpoint as any)['bundle-transport'].ice;
      const offer = audioOnlyOffer();

      await expect(
        coreFunctions.configureEndpointForWhipWhep(
          offer,
          endpoint,
          mockSmb,
          smbUrl,
          smbKey,
          confId,
          'ep-err'
        )
      ).rejects.toThrow('Missing ice');
    });

    test('deep-clones inputs to avoid mutation', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioOnlyOffer();
      const originalUfrag = endpoint['bundle-transport']!.ice!.ufrag;

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-clone'
      );

      // Original should be unchanged
      expect(endpoint['bundle-transport']!.ice!.ufrag).toBe(originalUfrag);
    });

    // A WHIP publisher builds no video receive path, so any video SMB forwards
    // to it lands on an unlinked webrtcbin transport and kills the whole
    // pipeline (GST_FLOW_NOT_LINKED) — taking the publisher's own outbound
    // video with it. An empty-but-present ssrc-whitelist is the only value SMB
    // reads as "forward nothing"; deleting the key means last-N, i.e. forward
    // everything.
    test('blocks video egress to a WHIP publisher with an empty ssrc-whitelist', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioVideoOffer();

      // receiveOnly omitted — this is the WHIP publisher path.
      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-whip-egress'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-whip-egress');
      // Present, and empty — not absent, which would mean forward-everything.
      expect(configured?.video?.['ssrc-whitelist']).toEqual([]);
      // Ingress must be untouched: SMB still needs this publisher's own video.
      expect(configured?.video?.streams?.length).toBeGreaterThan(0);
      expect(configured?.video?.ssrcs?.length).toBeGreaterThan(0);
    });

    test('does not block video egress for a receive-only WHEP endpoint', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();
      const offer = audioVideoOffer();

      await coreFunctions.configureEndpointForWhipWhep(
        offer,
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-whep-egress',
        true // receiveOnly
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-whep-egress');
      // Unpinned WHEP must fall back to last-N, so the key must stay absent.
      expect(configured?.video?.['ssrc-whitelist']).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Step 3C: createWhipWhepAnswer
  // ══════════════════════════════════════════════════════════════════

  describe('createWhipWhepAnswer', () => {
    test('returns valid SDP string', async () => {
      const offer = audioOnlyOffer();
      const endpoint = createMockEndpointDescription();

      const sdpAnswer = await coreFunctions.createWhipWhepAnswer(
        offer,
        endpoint
      );

      expect(typeof sdpAnswer).toBe('string');
      expect(sdpAnswer).toContain('v=0');
      expect(sdpAnswer).toContain('m=audio');
    });

    test('increments origin sessionVersion', async () => {
      const offer = audioOnlyOffer();
      const originalVersion = offer.origin!.sessionVersion;
      const endpoint = createMockEndpointDescription();

      await coreFunctions.createWhipWhepAnswer(offer, endpoint);

      expect(offer.origin!.sessionVersion).toBe(originalVersion + 1);
    });

    test('sets ICE credentials from endpoint transport', async () => {
      const offer = audioOnlyOffer();
      const endpoint = createMockEndpointDescription();

      const sdpAnswer = await coreFunctions.createWhipWhepAnswer(
        offer,
        endpoint
      );
      const parsed = parse(sdpAnswer);
      const audioMedia = parsed.media.find((m) => m.type === 'audio');

      expect(audioMedia?.iceUfrag).toBe('smbUfrag');
      expect(audioMedia?.icePwd).toBe('smbPassword');
    });

    test('sets DTLS fingerprint from endpoint', async () => {
      const offer = audioOnlyOffer();
      const endpoint = createMockEndpointDescription();

      const sdpAnswer = await coreFunctions.createWhipWhepAnswer(
        offer,
        endpoint
      );
      const parsed = parse(sdpAnswer);
      const audioMedia = parsed.media.find((m) => m.type === 'audio');

      expect(audioMedia?.fingerprint?.type).toBe('sha-256');
      expect(audioMedia?.fingerprint?.hash).toContain('SM:BF');
    });

    test('toggles setup attribute (actpass -> active)', async () => {
      // Use audioVideoOffer which has setup at media level
      const offer = audioVideoOffer();
      const endpoint = createMockEndpointDescription();

      const sdpAnswer = await coreFunctions.createWhipWhepAnswer(
        offer,
        endpoint
      );
      const parsed = parse(sdpAnswer);
      const audioMedia = parsed.media.find((m) => m.type === 'audio');

      // actpass at media level -> active
      expect(audioMedia?.setup).toBe('active');
    });

    test('adds ICE candidates only to first media section', async () => {
      const offer = audioVideoOffer();
      const endpoint = createMockEndpointDescription();

      const sdpAnswer = await coreFunctions.createWhipWhepAnswer(
        offer,
        endpoint
      );
      const parsed = parse(sdpAnswer);

      expect(parsed.media[0].candidates?.length).toBeGreaterThan(0);
      expect(parsed.media[1].candidates).toBeUndefined();
    });

    test('filters audio to opus only', async () => {
      const offer = audioOnlyOffer();
      const endpoint = createMockEndpointDescription();

      const sdpAnswer = await coreFunctions.createWhipWhepAnswer(
        offer,
        endpoint
      );
      const parsed = parse(sdpAnswer);
      const audioMedia = parsed.media.find((m) => m.type === 'audio');

      // Should only have opus, not PCMU
      expect(audioMedia?.rtp.length).toBe(1);
      expect(audioMedia?.rtp[0].codec).toBe('opus');
    });

    test('flips audio direction (sendrecv -> recvonly)', async () => {
      const offer = audioOnlyOffer();
      const endpoint = createMockEndpointDescription();

      const sdpAnswer = await coreFunctions.createWhipWhepAnswer(
        offer,
        endpoint
      );
      const parsed = parse(sdpAnswer);
      const audioMedia = parsed.media.find((m) => m.type === 'audio');

      expect(audioMedia?.direction).toBe('recvonly');
    });

    test('filters video to H264 + RTX only', async () => {
      const offer = audioVideoOffer();
      const endpoint = createMockEndpointDescription();

      const sdpAnswer = await coreFunctions.createWhipWhepAnswer(
        offer,
        endpoint
      );
      const parsed = parse(sdpAnswer);
      const videoMedia = parsed.media.find((m) => m.type === 'video');

      // H264 (98) is preferred over VP8 (96); its RTX (99, apt=98) is kept.
      expect(videoMedia?.rtp.length).toBe(2);
      const codecs = videoMedia?.rtp.map((r) => r.codec);
      expect(codecs).toContain('H264');
      expect(codecs).toContain('rtx');
      expect(codecs).not.toContain('VP8');
    });

    test('sets BUNDLE group with all media mids', async () => {
      const offer = audioVideoOffer();
      const endpoint = createMockEndpointDescription();

      const sdpAnswer = await coreFunctions.createWhipWhepAnswer(
        offer,
        endpoint
      );
      const parsed = parse(sdpAnswer);

      expect(parsed.groups).toBeDefined();
      expect(parsed.groups![0].type).toBe('BUNDLE');
      expect(parsed.groups![0].mids).toBe('0 1');
    });

    test('output is parseable by sdp-transform', async () => {
      const offer = audioVideoOffer();
      const endpoint = createMockEndpointDescription();

      const sdpAnswer = await coreFunctions.createWhipWhepAnswer(
        offer,
        endpoint
      );
      const reparsed = parse(sdpAnswer);

      expect(reparsed.version).toBe(0);
      expect(reparsed.media.length).toBe(2);
    });

    test('throws when endpoint is missing', async () => {
      const offer = audioOnlyOffer();

      await expect(
        coreFunctions.createWhipWhepAnswer(offer, undefined as any)
      ).rejects.toThrow('Missing endpointDescription');
    });

    test('throws when audio is missing', async () => {
      const offer = audioOnlyOffer();
      const endpoint = createMockEndpointDescription();
      delete (endpoint as any).audio;

      await expect(
        coreFunctions.createWhipWhepAnswer(offer, endpoint)
      ).rejects.toThrow('Missing endpointDescription audio');
    });

    test('throws when audio ssrcs are empty', async () => {
      const offer = audioOnlyOffer();
      const endpoint = createMockEndpointDescription();
      endpoint.audio.ssrcs = [];

      await expect(
        coreFunctions.createWhipWhepAnswer(offer, endpoint)
      ).rejects.toThrow('Missing audio ssrcs');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Step 3D: handleAnswerRequest
  // ══════════════════════════════════════════════════════════════════

  describe('handleAnswerRequest', () => {
    test('parses SDP answer and extracts audio SSRCs from media[1]', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();

      const spy = jest.spyOn(mockSmb, 'configureEndpoint');

      await coreFunctions.handleAnswerRequest(
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-1',
        endpoint,
        clientSdpAnswer()
      );

      // The configured endpoint should have SSRCs from the answer's audio
      const configuredEndpoint = spy.mock.calls[0][3];
      expect(configuredEndpoint.audio.ssrcs.length).toBeGreaterThan(0);
      expect(configuredEndpoint.audio.ssrcs[0]).toBe(5001);
    });

    test('sets transport ICE credentials from answer', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();

      const spy = jest.spyOn(mockSmb, 'configureEndpoint');

      await coreFunctions.handleAnswerRequest(
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-2',
        endpoint,
        clientSdpAnswer()
      );

      const configuredEndpoint = spy.mock.calls[0][3];
      const transport = configuredEndpoint['bundle-transport']!;
      expect(transport.ice!.ufrag).toBe('answerUfrag');
      expect(transport.ice!.pwd).toBe('answerPassword');
    });

    test('sets DTLS fingerprint from answer', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();

      const spy = jest.spyOn(mockSmb, 'configureEndpoint');

      await coreFunctions.handleAnswerRequest(
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-3',
        endpoint,
        clientSdpAnswer()
      );

      const configuredEndpoint = spy.mock.calls[0][3];
      const dtls = configuredEndpoint['bundle-transport']!.dtls!;
      expect(dtls.hash).toContain('CC:DD:EE');
    });

    test('maps ICE candidates from answer', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();

      const spy = jest.spyOn(mockSmb, 'configureEndpoint');

      await coreFunctions.handleAnswerRequest(
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-4',
        endpoint,
        clientSdpAnswer()
      );

      const configuredEndpoint = spy.mock.calls[0][3];
      const candidates =
        configuredEndpoint['bundle-transport']!.ice!.candidates;
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].ip).toBe('192.168.1.200');
      expect(candidates[0].port).toBe(60000);
    });

    test('calls smb.configureEndpoint', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();

      const spy = jest.spyOn(mockSmb, 'configureEndpoint');

      await coreFunctions.handleAnswerRequest(
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-5',
        endpoint,
        clientSdpAnswer()
      );

      expect(spy).toHaveBeenCalledWith(
        smbUrl,
        confId,
        'ep-5',
        expect.any(Object),
        smbKey
      );
    });

    test('throws when endpoint is missing', async () => {
      await expect(
        coreFunctions.handleAnswerRequest(
          mockSmb,
          smbUrl,
          smbKey,
          'conf',
          'ep',
          undefined as any,
          clientSdpAnswer()
        )
      ).rejects.toThrow('Missing endpointDescription');
    });

    test('throws when audio is missing in endpoint', async () => {
      const endpoint = createMockEndpointDescription();
      delete (endpoint as any).audio;

      await expect(
        coreFunctions.handleAnswerRequest(
          mockSmb,
          smbUrl,
          smbKey,
          'conf',
          'ep',
          endpoint,
          clientSdpAnswer()
        )
      ).rejects.toThrow('Missing endpointDescription audio');
    });

    // ── media[1] bug regression test (fixed) ─────────────────────

    test('handles audio-only SDP answer without data channel', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = createMockEndpointDescription();

      const spy = jest.spyOn(mockSmb, 'configureEndpoint');

      // Audio-only answer has only 1 m= line (audio at index 0).
      // Previously crashed because media[1] was hardcoded; now
      // uses .find(m => m.type === 'audio') to locate audio media.
      await coreFunctions.handleAnswerRequest(
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-audio-only',
        endpoint,
        audioOnlySdpAnswer()
      );

      expect(spy).toHaveBeenCalled();
      const configuredEndpoint = spy.mock.calls[0]![3];
      // SSRC 6001 comes from the audio-only SDP answer fixture
      expect(configuredEndpoint!.audio.ssrcs).toContain(6001);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Step 3E: createConferenceForLine and createEndpoint
  // ══════════════════════════════════════════════════════════════════

  describe('createConferenceForLine', () => {
    test('allocates new conference for line with empty smbConferenceId', async () => {
      const conferenceId = await coreFunctions.createConferenceForLine(
        mockSmb,
        smbUrl,
        smbKey,
        '1',
        'line-a'
      );

      expect(conferenceId).toMatch(/^mock-conf-/);
      expect(mockSmb.hasConference(conferenceId)).toBe(true);
    });

    test('reuses conference when already active in SMB', async () => {
      const existingId = await mockSmb.allocateConference(smbUrl, smbKey);
      mockProduction.lines[0].smbConferenceId = existingId;

      const conferenceId = await coreFunctions.createConferenceForLine(
        mockSmb,
        smbUrl,
        smbKey,
        '1',
        'line-a'
      );

      expect(conferenceId).toBe(existingId);
      expect(mockProductionManager.setLineId).not.toHaveBeenCalled();
    });

    test('allocates new conference when existing one is not active', async () => {
      mockProduction.lines[0].smbConferenceId = 'stale-conf-id';

      const conferenceId = await coreFunctions.createConferenceForLine(
        mockSmb,
        smbUrl,
        smbKey,
        '1',
        'line-a'
      );

      expect(conferenceId).not.toBe('stale-conf-id');
      expect(mockProductionManager.setLineId).toHaveBeenCalledWith(
        1,
        'line-a',
        conferenceId
      );
    });
  });

  describe('createEndpoint', () => {
    test('allocates endpoint with audio via mock SMB', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);

      const endpoint = await coreFunctions.createEndpoint(
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-1',
        true,
        false,
        false,
        true,
        'ssrc-rewrite',
        60
      );

      expect(endpoint).toBeDefined();
      expect(endpoint.audio.ssrcs.length).toBeGreaterThan(0);
      expect(endpoint['bundle-transport']).toBeDefined();
    });

    test('throws when conference does not exist', async () => {
      await expect(
        coreFunctions.createEndpoint(
          mockSmb,
          smbUrl,
          smbKey,
          'nonexistent',
          'ep-1',
          true,
          false,
          false,
          true,
          'ssrc-rewrite',
          60
        )
      ).rejects.toThrow('not found');
    });
  });
});
