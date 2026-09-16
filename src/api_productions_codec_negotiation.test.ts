jest.mock('./log', () => ({
  Log: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));

import { parse } from 'sdp-transform';
import {
  CoreFunctions,
  selectVideoCodec,
  smbAdvertisedVideoCodecs
} from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { RtpCodec } from './media_streams_info';
import { MockSmbProtocol } from './mock-smb-protocol';
import { SmbEndpointDescription } from './models';
import { ProductionManager } from './production_manager';
import {
  audioVideoOffer,
  createMockEndpointDescription
} from './test-fixtures/sdp-fixtures';

// The video codec a bridge can carry is SMB's to decide, not the client's.
// SMB's compiled default is VP8, so any deployment that does not explicitly
// set codec.videoCodec advertises VP8 only — while every browser, OBS and
// whip-mpegts offers H264. Negotiating from the offer alone therefore answers
// H264 to a VP8-only bridge: the publisher encodes H264, SMB cannot forward
// it, and every receiver gets working audio with permanently black video and
// no error on any code path.

const smbUrl = 'http://smb.test';
const smbKey = 'key';

/** An SMB allocation whose video block advertises exactly `codecs` (+ RTX). */
const endpointAdvertising = (codecs: string[]): SmbEndpointDescription => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const endpoint = createMockEndpointDescription() as any;
  endpoint.video['payload-types'] = [
    ...codecs.map((name, index) => ({
      id: 100 + index,
      name,
      clockrate: 90000,
      parameters: {},
      'rtcp-fbs': [{ type: 'nack', subtype: '' }]
    })),
    {
      id: 120,
      name: 'rtx',
      clockrate: 90000,
      parameters: { apt: '100' },
      'rtcp-fbs': []
    }
  ];
  return endpoint as SmbEndpointDescription;
};

const rtp = (codec: string, payload: number): RtpCodec =>
  ({ codec, payload, rate: 90000 } as RtpCodec);

describe('video codec negotiation', () => {
  describe('smbAdvertisedVideoCodecs', () => {
    test('reports the advertised codecs, uppercased, without RTX', () => {
      expect(smbAdvertisedVideoCodecs(endpointAdvertising(['vp8']))).toEqual([
        'VP8'
      ]);
    });

    test('is empty when the allocation carried no video payload-types', () => {
      expect(smbAdvertisedVideoCodecs(createMockEndpointDescription())).toEqual(
        []
      );
    });
  });

  describe('selectVideoCodec', () => {
    const offered = [rtp('VP8', 96), rtp('H264', 98)];

    test('picks VP8 when the bridge only advertises VP8', () => {
      expect(selectVideoCodec(offered, ['VP8'])?.codec).toBe('VP8');
    });

    test('picks H264 when the bridge advertises H264', () => {
      expect(selectVideoCodec(offered, ['H264'])?.codec).toBe('H264');
    });

    test('prefers H264 when the bridge advertises both', () => {
      expect(selectVideoCodec(offered, ['VP8', 'H264'])?.codec).toBe('H264');
    });

    test('falls back to pipeline preference when SMB advertised nothing', () => {
      expect(selectVideoCodec(offered, [])?.codec).toBe('H264');
    });

    test('returns undefined when offer and bridge share no codec', () => {
      expect(selectVideoCodec([rtp('H264', 98)], ['VP8'])).toBeUndefined();
    });
  });

  describe('against a VP8-only bridge (regression)', () => {
    let coreFunctions: CoreFunctions;
    let mockSmb: MockSmbProtocol;

    beforeEach(() => {
      mockSmb = new MockSmbProtocol();
      coreFunctions = new CoreFunctions(
        {} as ProductionManager,
        new ConnectionQueue()
      );
    });

    test('configures SMB with VP8 even though the offer also carries H264', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = endpointAdvertising(['VP8']);

      await coreFunctions.configureEndpointForWhipWhep(
        audioVideoOffer(),
        endpoint,
        mockSmb,
        smbUrl,
        smbKey,
        confId,
        'ep-vp8'
      );

      const configured = mockSmb.getEndpoint(confId, 'ep-vp8');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((configured as any)?.video['payload-type'].name).toBe('VP8');
    });

    test('answers the publisher with VP8 only, so it cannot encode H264', async () => {
      const endpoint = endpointAdvertising(['VP8']);

      const answer = await coreFunctions.createWhipWhepAnswer(
        audioVideoOffer(),
        endpoint
      );

      const video = parse(answer).media.find((m) => m.type === 'video');
      const codecs = (video?.rtp ?? []).map((r) => r.codec.toUpperCase());
      expect(codecs).toContain('VP8');
      expect(codecs).not.toContain('H264');
    });

    test('rejects an H264-only publisher instead of negotiating a dead stream', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const endpoint = endpointAdvertising(['VP8']);
      const offer = audioVideoOffer();
      const video = offer.media.find((m) => m.type === 'video');
      // Drop VP8 from the offer: an H264-only publisher, e.g. whip-mpegts.
      if (video) {
        video.rtp = video.rtp.filter(
          (r) => r.codec.toUpperCase() !== 'VP8'
        ) as typeof video.rtp;
      }

      await expect(
        coreFunctions.configureEndpointForWhipWhep(
          offer,
          endpoint,
          mockSmb,
          smbUrl,
          smbKey,
          confId,
          'ep-h264-only'
        )
      ).rejects.toThrow(/No video codec in common.*SMB advertises: VP8/s);
    });
  });

  describe('against an H264 bridge', () => {
    test('still negotiates H264, so existing deployments are unchanged', async () => {
      const endpoint = endpointAdvertising(['H264']);
      const coreFunctions = new CoreFunctions(
        {} as ProductionManager,
        new ConnectionQueue()
      );

      const answer = await coreFunctions.createWhipWhepAnswer(
        audioVideoOffer(),
        endpoint
      );

      const video = parse(answer).media.find((m) => m.type === 'video');
      const codecs = (video?.rtp ?? []).map((r) => r.codec.toUpperCase());
      expect(codecs).toContain('H264');
      expect(codecs).not.toContain('VP8');
    });
  });
});
