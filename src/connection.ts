import { SessionDescription } from 'sdp-transform';

import {
  AudioSmbPayloadParameters,
  MediaDescriptionBase,
  SfuEndpointDescription,
  VideoSmbPayloadType
} from './sfu/interface';
import {
  NORMALIZED_VIDEO_PT_MAIN,
  NORMALIZED_VIDEO_PT_RTX
} from './sfu/constants';
import { MediaStreamsInfo } from './media_streams_info';
import { Log } from './log';

export class Connection {
  private resourceId: string;
  private connectionId: string;
  private nextMid = 0;
  private usedMids: string[] = [];

  protected mediaStreams?: MediaStreamsInfo;
  protected endpointDescription?: SfuEndpointDescription;
  protected endpointId?: string;

  constructor(
    resourceId: string,
    mediaStreams: MediaStreamsInfo,
    endpointDescription: SfuEndpointDescription,
    endpointId: string
  ) {
    this.resourceId = resourceId;
    this.connectionId = endpointId;
    this.mediaStreams = mediaStreams;
    this.endpointDescription = endpointDescription;
    this.log(`Create, sfuResourceId ${resourceId}`);
  }

  getId(): string {
    return this.connectionId;
  }

  getResourceId(): string {
    return this.resourceId;
  }

  protected log(...args: string[] | Connection[]) {
    Log().info(`[connection ${this.connectionId}]`, ...args);
  }

  protected error(...args: string[] | Connection[]) {
    Log().error(`[connection ${this.connectionId}]`, ...args);
  }

  createOffer(): SessionDescription {
    const offer: SessionDescription = {
      version: 0,
      origin: {
        username: '-',
        sessionId: '2438602337097565327',
        sessionVersion: 2,
        netType: 'IN',
        ipVer: 4,
        address: '127.0.0.1'
      },
      name: '-',
      timing: {
        start: 0,
        stop: 0
      },
      media: []
    };

    this.addSFUMids(offer);
    this.addIngestMids(offer);

    let msidSemanticToken = 'feedbackvideomslabel';
    if (this.mediaStreams) {
      if (this.mediaStreams.audio.ssrcs.length !== 0) {
        const mslabels = this.mediaStreams.audio.ssrcs.map(
          (element) => element.mslabel
        );
        msidSemanticToken = `${mslabels.join(' ')}`;
      }
      if (this.mediaStreams.video?.ssrcs.length) {
        const videoMslabels = this.mediaStreams.video.ssrcs.map(
          (element) => element.mslabel
        );
        msidSemanticToken = `${msidSemanticToken} ${videoMslabels.join(' ')}`;
      }
    }

    offer.msidSemantic = {
      semantic: 'WMS',
      token: msidSemanticToken
    };
    offer.groups = [
      {
        type: 'BUNDLE',
        mids: this.usedMids.join(' ')
      }
    ];

    return offer;
  }

  protected makeMediaDescription(type: string): MediaDescriptionBase {
    if (!this.endpointDescription) {
      throw new Error('Missing endpointDescription');
    }
    if (!this.endpointDescription['bundle-transport']) {
      throw new Error('Missing bundle-transport in endpointDescription');
    }

    const transport = this.endpointDescription['bundle-transport'];

    if (!transport.ice) {
      throw new Error('Missing ice in endpointDescription');
    }
    if (!transport.dtls) {
      throw new Error('Missing dtls in endpointDescription');
    }
    const result = {
      mid: this.nextMid.toString(),
      type: type,
      port: 9,
      protocol: 'RTP/SAVPF',
      payloads: '',
      rtp: [],
      fmtp: [],
      rtcpFb: [],
      rtcp: {
        port: 9,
        netType: 'IN',
        ipVer: 4,
        address: '0.0.0.0'
      },
      ext: [],
      ssrcs: [],
      ssrcGroups: [],
      iceUfrag: transport.ice.ufrag,
      icePwd: transport.ice.pwd,
      fingerprint: {
        type: transport.dtls.type,
        hash: transport.dtls.hash
      },
      setup: transport.dtls.setup === 'actpass' ? 'active' : 'actpass',
      direction: <
        'sendrecv' | 'recvonly' | 'sendonly' | 'inactive' | undefined
      >'sendrecv',
      rtcpMux: 'rtcp-mux' as const,
      connection: {
        version: 4,
        ip: '0.0.0.0'
      },
      candidates: transport.ice.candidates.map((element) => {
        return {
          foundation: element.foundation,
          component: element.component,
          transport: element.protocol,
          priority: element.priority,
          ip: element.ip,
          port: element.port,
          type: element.type,
          raddr: element['rel-addr'],
          rport: element['rel-port'],
          generation: element.generation,
          'network-id': element.network
        };
      })
    };

    this.usedMids.push(this.nextMid.toString());
    this.nextMid++;
    return result;
  }

  protected addVideoMid(offer: SessionDescription) {
    if (!this.endpointDescription?.video) return;
    if (!this.mediaStreams?.video) return;

    const video = this.endpointDescription.video;

    const rawPayloadTypes: VideoSmbPayloadType[] =
      video['payload-types'] ??
      (video['payload-type'] ? [video['payload-type']] : []);

    if (!rawPayloadTypes.length) return;

    // Prefer H264; fall back to VP8 for older SMB deployments.
    // Restrict to a single codec to prevent Chrome from picking VP9
    // which would cause a PT mismatch with SMB and dropped video packets.
    const h264Raw = rawPayloadTypes.find(
      (pt) => pt.name.toUpperCase() === 'H264'
    );
    const vp8Raw = rawPayloadTypes.find(
      (pt) => pt.name.toUpperCase() === 'VP8'
    );
    const preferredCodec = h264Raw ?? vp8Raw;
    if (!preferredCodec) return;

    const rtxRaw = rawPayloadTypes.find(
      (pt) => pt.name.toLowerCase() === 'rtx'
    );

    const mainPt = NORMALIZED_VIDEO_PT_MAIN;
    const rtxPt = NORMALIZED_VIDEO_PT_RTX;

    const payloadTypes: VideoSmbPayloadType[] = [
      { ...preferredCodec, id: mainPt },
      ...(rtxRaw
        ? [
            {
              ...rtxRaw,
              id: rtxPt,
              parameters: { ...rtxRaw.parameters, apt: String(mainPt) }
            }
          ]
        : [])
    ];

    Log().debug(
      `[addVideoMid] smb rtcp-fbs for ${
        preferredCodec.name
      } pt=${mainPt} fbs=${JSON.stringify(preferredCodec['rtcp-fbs'] ?? [])}`
    );

    // Helper that builds one video m-line with the shared codec/ext block.
    // Caller decides what ssrcs (if any) to put on it.
    const buildVideoDescription = () => {
      const md = this.makeMediaDescription('video');
      md.payloads = payloadTypes.map((pt) => pt.id).join(' ');
      md.rtp = payloadTypes.map((pt) => ({
        payload: pt.id,
        codec: pt.name,
        rate: pt.clockrate
      }));
      md.fmtp = payloadTypes
        .filter((pt) => pt.parameters && Object.keys(pt.parameters).length > 0)
        .map((pt) => ({
          payload: pt.id,
          config: Object.entries(pt.parameters)
            .map(([k, v]) => (v ? `${k}=${v}` : k))
            .join(';')
        }));
      md.rtcpFb = payloadTypes
        .filter((pt) => pt['rtcp-fbs']?.length)
        .flatMap((pt) =>
          pt['rtcp-fbs'].map((fb) => ({
            payload: pt.id,
            type: fb.type,
            subtype: fb.subtype ?? ''
          }))
        );
      if (video['rtp-hdrexts']?.length) {
        md.ext = video['rtp-hdrexts'].map((ext) => ({
          value: ext.id,
          uri: ext.uri
        }));
      }
      return md;
    };

    const videoSsrcs = this.mediaStreams.video.ssrcs;

    if (videoSsrcs.length === 0) {
      offer.media.push(buildVideoDescription());
      return;
    }

    for (const element of videoSsrcs) {
      const md = buildVideoDescription();
      md.ssrcs.push({
        id: Number(element.ssrc),
        attribute: 'cname',
        value: element.cname
      });
      md.ssrcs.push({
        id: Number(element.ssrc),
        attribute: 'label',
        value: element.label
      });
      md.ssrcs.push({
        id: Number(element.ssrc),
        attribute: 'mslabel',
        value: element.mslabel
      });
      md.ssrcs.push({
        id: Number(element.ssrc),
        attribute: 'msid',
        value: `${element.mslabel} ${element.label}`
      });
      offer.media.push(md);
    }
  }

  protected addIngestMids(offer: SessionDescription) {
    if (!this.endpointDescription) {
      throw new Error('Missing endpointDescription');
    }
    if (!this.endpointDescription.audio) {
      throw new Error('Missing endpointDescription audio');
    }
    if (!this.mediaStreams) {
      throw new Error('Missing endpointDescription audio');
    }

    const audio = this.endpointDescription.audio;
    const audioPayloadType = audio['payload-type'];

    for (const element of this.mediaStreams.audio.ssrcs) {
      const audioDescription = this.makeMediaDescription('audio');
      audioDescription.payloads = audioPayloadType.id.toString();
      audioDescription.rtp = [
        {
          payload: audioPayloadType.id,
          codec: audioPayloadType.name,
          rate: audioPayloadType.clockrate,
          encoding: audioPayloadType.channels
        }
      ];

      const parameters: string[] = Object.keys(audioPayloadType.parameters);
      if (parameters.length !== 0) {
        audioDescription.fmtp = [
          {
            payload: audioPayloadType.id,
            config: parameters
              .map(
                (element) =>
                  `${element}=${
                    audioPayloadType.parameters[
                      element as keyof AudioSmbPayloadParameters
                    ]
                  }`
              )
              .join(';')
          }
        ];
      }

      audioDescription.ext = audio['rtp-hdrexts'].flatMap((element) => {
        return { value: element.id, uri: element.uri };
      });

      audioDescription.ssrcs.push({
        id: Number(element.ssrc),
        attribute: 'cname',
        value: element.cname
      });
      audioDescription.ssrcs.push({
        id: Number(element.ssrc),
        attribute: 'label',
        value: element.label
      });
      audioDescription.ssrcs.push({
        id: Number(element.ssrc),
        attribute: 'mslabel',
        value: element.mslabel
      });
      audioDescription.ssrcs.push({
        id: Number(element.ssrc),
        attribute: 'msid',
        value: `${element.mslabel} ${element.label}`
      });

      offer.media.push(audioDescription);
    }

    this.addVideoMid(offer);
  }

  protected addSFUMids(offer: SessionDescription) {
    const dataDescription = this.makeMediaDescription('application');
    dataDescription.protocol = 'UDP/DTLS/SCTP';
    dataDescription.payloads = 'webrtc-datachannel';
    dataDescription.sctpPort = this.endpointDescription?.data?.port;
    dataDescription.maxMessageSize = 262144;
    offer.media.push(dataDescription);
  }
}
