import {
  MediaDescription,
  SessionDescription,
  parse,
  write
} from 'sdp-transform';
import { v4 as uuidv4 } from 'uuid';
import { Connection } from './connection';
import { ConnectionQueue } from './connection_queue';
import {
  Fmtp,
  MediaStreamsInfoSsrc,
  RtcpFb,
  RtpCodec,
  RtpHeaderExt
} from './media_streams_info';
import { LineResponse, Production, SmbEndpointDescription } from './models';
import { ProductionManager } from './production_manager';
import { SmbProtocol } from './smb';

export class CoreFunctions {
  private productionManager: ProductionManager;
  private connectionQueue: ConnectionQueue;

  constructor(
    productionManager: ProductionManager,
    connectionQueue: ConnectionQueue
  ) {
    this.productionManager = productionManager;
    this.connectionQueue = connectionQueue;
  }

  async createConnection(
    smbConferenceId: string,
    productionId: string,
    lineId: string,
    endpoint: SmbEndpointDescription,
    username: string,
    endpointId: string,
    sessionId: string
  ): Promise<string> {
    if (!endpoint.audio) {
      throw new Error('Missing audio when creating offer');
    }

    const ssrcs: MediaStreamsInfoSsrc[] = [];
    endpoint.audio.ssrcs.forEach((ssrcsNr) => {
      ssrcs.push({
        ssrc: ssrcsNr.toString(),
        cname: uuidv4(),
        mslabel: uuidv4(),
        label: uuidv4()
      });
    });

    const endpointMediaStreamInfo = {
      audio: {
        ssrcs: ssrcs
      }
    };

    const connection = new Connection(
      username,
      endpointMediaStreamInfo,
      endpoint as any, // Type assertion to bypass type error temporarily
      endpointId
    );

    const offer: SessionDescription = connection.createOffer();
    const sdpOffer: string = write(offer);

    if (sdpOffer) {
      this.productionManager.createUserSession(
        smbConferenceId,
        productionId,
        lineId,
        sessionId,
        username,
        false
      );
      this.productionManager.updateUserEndpoint(
        sessionId,
        endpointId,
        endpoint
      );
    }
    return sdpOffer;
  }

  async createEndpoint(
    smb: SmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string,
    lineId: string,
    endpointId: string,
    audio: boolean,
    data: boolean,
    iceControlling: boolean,
    relayType: 'ssrc-rewrite' | 'forwarder',
    endpointIdleTimeout: number
  ): Promise<SmbEndpointDescription> {
    const endpoint: SmbEndpointDescription = await smb.allocateEndpoint(
      smbServerUrl,
      lineId,
      endpointId,
      audio,
      data,
      iceControlling,
      relayType,
      endpointIdleTimeout,
      smbServerApiKey
    );

    return endpoint;
  }

  async configureEndpointForWhip(
    sdpOffer: SessionDescription,
    endpointDescription: SmbEndpointDescription,
    smb: SmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string,
    smbConferenceId: string,
    endpointId: string
  ): Promise<void> {
    const offer: SessionDescription = JSON.parse(JSON.stringify(sdpOffer));
    const endpoint: SmbEndpointDescription = JSON.parse(
      JSON.stringify(endpointDescription)
    );

    const transport = endpoint['bundle-transport'];

    if (!transport) {
      throw new Error('Missing bundle-transport in endpointDescription');
    }
    if (!transport.dtls) {
      throw new Error('Missing dtls in endpointDescription');
    }
    if (!transport.ice) {
      throw new Error('Missing ice in endpointDescription');
    }

    const audioMedia = {
      ...offer.media.find((media) => media.type === 'audio')
    } as MediaDescription;

    transport.ice.ufrag = offer.iceUfrag ?? audioMedia?.iceUfrag ?? '';
    transport.ice.pwd = offer.icePwd ?? audioMedia?.icePwd ?? '';
    transport.dtls.hash =
      offer.fingerprint?.hash ?? audioMedia?.fingerprint?.hash ?? '';
    transport.dtls.type =
      offer.fingerprint?.type ?? audioMedia?.fingerprint?.type ?? '';
    transport.dtls.setup = offer.setup ?? audioMedia?.setup ?? '';

    if (!transport.ice.candidates || transport.ice.candidates.length === 0) {
      throw new Error('ICE candidates missing in transport');
    }

    const videoStreams: any[] = [];
    const streamsMap = new Map();

    for (const media of offer.media) {
      if (media.type === 'audio') {
        endpoint.audio.ssrcs = [];
        media.ssrcs
          ?.filter((ssrc) => ssrc.attribute === 'msid')
          .forEach((ssrc) => endpoint.audio.ssrcs.push(parseInt(`${ssrc.id}`)));
        endpoint.audio['payload-type'].id = media.rtp[0].payload;
        endpoint.audio['rtp-hdrexts'] = [];
        media.ext?.forEach((ext: RtpHeaderExt) =>
          endpoint.audio['rtp-hdrexts'].push({
            id: ext.value,
            uri: ext.uri
          })
        );
      } else if (media.type === 'video') {
        media.ssrcs
          ?.filter((ssrc) => ssrc.attribute === 'msid' && ssrc.value)
          .forEach((ssrc) => {
            const mediaStreamId = ssrc.value?.split(' ')[0];
            let smbVideoStream = streamsMap.get(mediaStreamId);
            if (!smbVideoStream) {
              smbVideoStream = {
                sources: [],
                id: mediaStreamId,
                content: 'video'
              };
              streamsMap.set(mediaStreamId, smbVideoStream);
            }

            const feedbackGroup = media.ssrcGroups
              ?.filter((element) => element.semantics === 'FID')
              .filter((element) => element.ssrcs.indexOf(`${ssrc.id}`) !== -1)
              .pop();

            if (feedbackGroup) {
              const ssrcsSplit = feedbackGroup.ssrcs.split(' ');
              if (`${ssrc.id}` === ssrcsSplit[0]) {
                smbVideoStream.sources = [
                  {
                    main: parseInt(ssrcsSplit[0]),
                    feedback: parseInt(ssrcsSplit[1])
                  }
                ];
              }
            } else {
              smbVideoStream.sources = [
                {
                  main: parseInt(`${ssrc.id}`)
                }
              ];
            }
          });

        streamsMap.forEach((value) => videoStreams.push(value));
        const supportedCodecs = ['VP8', 'H264', 'VP9'];
        const matchingCodecs =
          media.rtp?.filter((rtp: RtpCodec) =>
            supportedCodecs.includes(rtp.codec.toUpperCase())
          ) || [];

        if (matchingCodecs.length > 0) {
          media.rtp = matchingCodecs;
        }

        const seenPayloads = new Set<number>();
        media.rtp = media.rtp.filter((rtp: RtpCodec) => {
          if (seenPayloads.has(rtp.payload)) return false;
          seenPayloads.add(rtp.payload);
          return true;
        });

        media.fmtp =
          media.fmtp?.filter((fmtp: Fmtp) =>
            media.rtp.some((rtp: RtpCodec) => rtp.payload === fmtp.payload)
          ) ?? [];

        media.rtcpFb =
          media.rtcpFb?.filter((fb: RtcpFb) =>
            media.rtp.some((rtp: RtpCodec) => rtp.payload === fb.payload)
          ) ?? [];

        media.payloads = media.rtp
          .map((rtp: RtpCodec) => rtp.payload)
          .join(' ');

        media.ext =
          media.ext?.filter(
            (ext: RtpHeaderExt) =>
              ext.uri ===
                'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time' ||
              ext.uri === 'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id'
          ) ?? [];

        media.ssrcGroups = undefined;

        endpoint.video = endpoint.video || {};

        const selectedCodec = media.rtp[0];
        if (typeof selectedCodec.rate !== 'number') {
          throw new Error('Selected video codec is missing a valid clockrate');
        }

        const payload = {
          id: selectedCodec.payload,
          name: selectedCodec.codec,
          clockrate: selectedCodec.rate,
          parameters: {},
          'rtcp-fbs': [] as { type: string; subtype?: string }[]
        };

        const fmtp = media.fmtp.find(
          (f) => f.payload === selectedCodec.payload
        );
        if (fmtp?.config) {
          payload.parameters = Object.fromEntries(
            fmtp.config.split(';').map((kv) => {
              const [key, val] = kv.trim().split('=');
              return [key, val ?? ''];
            })
          );
        }

        const rtcpFbs = media.rtcpFb?.filter(
          (f: RtcpFb) => f.payload === selectedCodec.payload
        );
        if (rtcpFbs?.length) {
          payload['rtcp-fbs'] = rtcpFbs.map((fb: RtcpFb) => ({
            type: fb.type,
            subtype: fb.subtype ?? undefined
          }));
        }

        endpoint.video['payload-type'] = payload;
        endpoint.video['rtp-hdrexts'] = media.ext.map((ext: RtpHeaderExt) => ({
          id: ext.value,
          uri: ext.uri
        }));

        endpoint.video.ssrcs =
          media.ssrcs?.map((ssrc) => Number(ssrc.id)) ?? [];
      }
    }

    await smb.configureEndpoint(
      smbServerUrl,
      smbConferenceId,
      endpointId,
      endpoint,
      smbServerApiKey
    );
  }

  async createAnswer(
    offer: SessionDescription,
    endpoint: SmbEndpointDescription
  ): Promise<string> {
    if (!endpoint) {
      throw new Error('Missing endpointDescription when handling sdp offer');
    }
    if (!endpoint.audio) {
      throw new Error(
        'Missing endpointDescription audio when handling sdp offer'
      );
    }
    if (!endpoint.audio.ssrcs || endpoint.audio.ssrcs.length === 0) {
      throw new Error('Missing audio ssrcs in SMB endpoint description');
    }

    if (offer.origin) {
      offer.origin.sessionVersion++;
    }

    if (!offer.msidSemantic) {
      offer.msidSemantic = { semantic: 'WMS', token: '' };
    } else {
      offer.msidSemantic.token = '*';
    }

    const transport = endpoint['bundle-transport'];
    if (!transport)
      throw new Error('Missing bundle-transport in endpointDescription');
    if (!transport.dtls) throw new Error('Missing dtls in endpointDescription');
    if (!transport.ice) throw new Error('Missing ice in endpointDescription');

    let bundleGroupMids = '';
    let candidatesAdded = false;

    for (const media of offer.media) {
      bundleGroupMids =
        bundleGroupMids === ''
          ? `${media.mid}`
          : `${bundleGroupMids} ${media.mid}`;

      (media as any).iceOptions = undefined;
      media.iceUfrag = transport.ice.ufrag;
      media.icePwd = transport.ice.pwd;
      media.fingerprint = {
        type: transport.dtls.type,
        hash: transport.dtls.hash
      };
      media.setup = media.setup === 'actpass' ? 'active' : 'actpass';
      media.ssrcGroups = undefined;
      media.ssrcs = undefined;
      media.msid = undefined;
      media.candidates = undefined;
      media.port = 9;
      media.rtcp = {
        port: 9,
        netType: 'IN',
        ipVer: 4,
        address: '0.0.0.0'
      };
      media.rtcpMux = 'rtcp-mux';

      if (!candidatesAdded) {
        media.candidates = transport.ice!.candidates.map((candidate: any) => ({
          foundation: candidate.foundation,
          component: candidate.component,
          transport: candidate.protocol,
          priority: candidate.priority,
          ip: candidate.ip,
          port: candidate.port,
          type: candidate.type,
          raddr: candidate['rel-addr'],
          rport: candidate['rel-port'],
          generation: candidate.generation,
          'network-id': candidate.network
        }));
        candidatesAdded = true;
      }

      if (media.type === 'audio') {
        media.rtp = media.rtp.filter(
          (rtp: RtpCodec) => rtp.codec.toLowerCase() === 'opus'
        );
        const opusPayloadType = media.rtp.at(0)?.payload;
        if (!opusPayloadType) throw new Error('Missing opus payload type');

        media.fmtp = media.fmtp.filter(
          (fmtp: Fmtp) => fmtp.payload === opusPayloadType
        );
        media.payloads = `${opusPayloadType}`;

        media.ext = media.ext?.filter(
          (ext: RtpHeaderExt) =>
            ext.uri === 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' ||
            ext.uri ===
              'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
        );

        media.direction = 'recvonly';
        media.rtcpFb = undefined;

        const defaultAudioExts = [
          { id: 1, uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' },
          {
            id: 2,
            uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
          }
        ];

        const hasRtpExts =
          Array.isArray(media.ext) &&
          media.ext.some(
            (ext) =>
              ext.uri === 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' ||
              ext.uri ===
                'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
          );

        const audioExts = hasRtpExts
          ? media.ext!.map((ext: RtpHeaderExt) => ({
              id: ext.value,
              uri: ext.uri
            }))
          : defaultAudioExts;

        media.ext = audioExts.map((ext) => ({ value: ext.id, uri: ext.uri }));
      } else if (media.type === 'video') {
        const vp8Codec = media.rtp.find(
          (rtp: RtpCodec) => rtp.codec.toUpperCase() === 'VP8'
        );
        if (vp8Codec) {
          const vp8PayloadType = vp8Codec.payload;

          const rtxFmtp = media.fmtp.find(
            (fmtp: Fmtp) => fmtp.config === `apt=${vp8PayloadType}`
          );
          const vp8RtxPayloadType = rtxFmtp?.payload;

          media.rtp = media.rtp.filter(
            (rtp: RtpCodec) =>
              rtp.payload === vp8PayloadType ||
              rtp.payload === vp8RtxPayloadType
          );

          media.fmtp = media.fmtp.filter(
            (fmtp: Fmtp) =>
              fmtp.payload === vp8PayloadType ||
              fmtp.payload === vp8RtxPayloadType
          );

          media.payloads = [vp8PayloadType, vp8RtxPayloadType]
            .filter(Boolean)
            .join(' ');
          media.ext =
            media.ext?.filter(
              (ext: RtpHeaderExt) =>
                ext.uri ===
                  'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time' ||
                ext.uri === 'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id'
            ) ?? [];

          media.rtcpFb = media.rtcpFb?.filter(
            (fb: RtcpFb) =>
              fb.payload === vp8PayloadType &&
              (fb.type === 'goog-remb' || fb.type === 'nack')
          );

          media.setup = 'active';
          media.direction = 'recvonly';
          media.ssrcGroups = undefined;
        } else {
          console.warn(
            'No VP8 codec found in offer video media. Skipping VP8-specific filtering.'
          );
          media.setup = 'active';
          media.direction = 'recvonly';
        }
      }
    }

    offer.groups = [
      {
        type: 'BUNDLE',
        mids: bundleGroupMids
      }
    ];

    const sdpAnswer = write(offer);

    const offerMediaDescription = offer.media[0];
    if (!offerMediaDescription) {
      throw new Error('Missing audio media description in offer');
    }

    return sdpAnswer;
  }

  async handleAnswerRequest(
    smb: SmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string,
    lineId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    answer: string
  ): Promise<void> {
    if (!endpointDescription) {
      throw new Error(
        'Missing endpointDescription when handling sdp answer from endpoint'
      );
    }
    if (!endpointDescription.audio) {
      throw new Error(
        'Missing endpointDescription audio when handling sdp answer from endpoint'
      );
    }
    endpointDescription.audio.ssrcs = [];

    const parsedAnswer = parse(answer);
    const answerMediaDescription = parsedAnswer.media[0];
    if (!answerMediaDescription) {
      throw new Error(
        'Missing audio media description when handling sdp answer from endpoint'
      );
    }

    if (parsedAnswer.media[1].ssrcs) {
      let parsedSsrcs = parsedAnswer.media[1].ssrcs[0].id;
      if (typeof parsedSsrcs === 'string') {
        parsedSsrcs = parseInt(parsedSsrcs, 10);
      }
      endpointDescription.audio.ssrcs.push(parsedSsrcs);
    }

    if (endpointDescription.audio.ssrcs.length === 0) {
      throw new Error(
        'Missing audio ssrcs when handling sdp answer from endpoint'
      );
    }

    const transport = endpointDescription['bundle-transport'];
    if (!transport) {
      throw new Error(
        'Missing endpointDescription when handling sdp answer from endpoint'
      );
    }
    if (!transport.dtls) {
      throw new Error('Missing dtls when handling sdp answer from endpoint');
    }
    if (!transport.ice) {
      throw new Error('Missing ice when handling sdp answer from endpoint');
    }

    const answerFingerprint = parsedAnswer.fingerprint
      ? parsedAnswer.fingerprint
      : answerMediaDescription.fingerprint;
    if (!answerFingerprint) {
      throw new Error(
        'Missing answerFingerprint when handling sdp answer from endpoint'
      );
    }
    transport.dtls.type = answerFingerprint.type;
    transport.dtls.hash = answerFingerprint.hash;
    transport.dtls.setup = answerMediaDescription.setup || '';
    transport.ice.ufrag = this.toStringIfNumber(
      answerMediaDescription.iceUfrag
    );
    transport.ice.pwd = answerMediaDescription.icePwd || '';
    transport.ice.candidates = !answerMediaDescription.candidates
      ? []
      : answerMediaDescription.candidates.flatMap((element) => {
          return {
            generation: element.generation ? element.generation : 0,
            component: element.component,
            protocol: element.transport.toLowerCase(),
            port: element.port,
            ip: element.ip,
            relPort: element.rport,
            relAddr: element.raddr,
            foundation: element.foundation.toString(),
            priority: parseInt(element.priority.toString(), 10),
            type: element.type,
            network: element['network-id']
          };
        });

    return await smb.configureEndpoint(
      smbServerUrl,
      lineId,
      endpointId,
      endpointDescription,
      smbServerApiKey
    );
  }

  /**
   * Create conference for a line if it does not exist, and return conference id
   *
   * This method MUST be queued. Multiple simultaneous calls to this method
   * will result in creating different conferences for each request, overwriting
   * previously created conference IDs, if the function call targets the same line.
   */
  private async createConference(
    smb: SmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string,
    productionId: string,
    lineId: string
  ): Promise<string> {
    const activeLines: string[] = await smb.getConferences(
      smbServerUrl,
      smbServerApiKey
    );

    const production = await this.productionManager.requireProduction(
      parseInt(productionId, 10)
    );

    const line = this.productionManager.requireLine(production.lines, lineId);

    if (activeLines.includes(line.smbConferenceId)) {
      return line.smbConferenceId;
    }

    const newConferenceId = await smb.allocateConference(
      smbServerUrl,
      smbServerApiKey
    );

    if (
      !(await this.productionManager.setLineId(
        production._id,
        line.id,
        newConferenceId
      ))
    ) {
      throw new Error(
        `Failed to set line smb id for line ${line.id} in production ${production._id}`
      );
    }

    return newConferenceId;
  }

  async createConferenceForLine(
    smb: SmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string,
    productionId: string,
    lineId: string
  ): Promise<string> {
    const createConf = () =>
      this.createConference(
        smb,
        smbServerUrl,
        smbServerApiKey,
        productionId,
        lineId
      );

    return this.connectionQueue.queueAsync(createConf);
  }

  getAllLinesResponse(production: Production): LineResponse[] {
    const allLinesResponse: LineResponse[] = production.lines.map(
      ({ name, id, smbConferenceId, programOutputLine }) => ({
        name,
        id,
        smbConferenceId,
        participants: this.productionManager.getUsersForLine(
          production._id.toString(),
          id
        ),
        programOutputLine
      })
    );
    return allLinesResponse;
  }

  private toStringIfNumber(value: string | number | undefined): string {
    if (typeof value === 'number') {
      return String(value);
    } else if (typeof value === 'string') {
      return value;
    } else {
      throw new Error(`${value} has incorrect type`);
    }
  }
}
