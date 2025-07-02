import { SessionDescription, parse, write } from 'sdp-transform';
import { v4 as uuidv4 } from 'uuid';
import { Connection } from './connection';
import { ConnectionQueue } from './connection_queue';
import { MediaStreamsInfoSsrc } from './media_streams_info';
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
        productionId,
        lineId,
        sessionId,
        username
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

  async createAnswer(
    smb: SmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string,
    smbConferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    offer: string
  ): Promise<string> {
    if (!endpointDescription) {
      throw new Error('Missing endpointDescription when handling sdp offer');
    }
    if (!endpointDescription.audio) {
      throw new Error(
        'Missing endpointDescription audio when handling sdp offer'
      );
    }

    // Parse the offer
    const parsedOffer = parse(offer);
    console.log('parsedOffer', JSON.stringify(parsedOffer));
    if (parsedOffer.origin) {
      parsedOffer.origin.sessionVersion++;
    }

    // Remove ICE controlling indicators from client offer to prevent role conflicts
    // This ensures SMB can be ICE controlling without conflicts
    // if ((parsedOffer as any).iceOptions) {
    //   delete (parsedOffer as any).iceOptions;
    // }

    // parsedOffer.media.forEach((media, index) => {
    //   if ((media as any).iceOptions) {
    //     delete (media as any).iceOptions;
    //   }
    // });

    // Set up MSID semantic if not present
    if (!parsedOffer.msidSemantic) {
      parsedOffer.msidSemantic = {
        semantic: 'WMS',
        // token: '*',
        token: ''
      };
    } else {
      // Ensure the token is set to '*' for proper MSID handling
      parsedOffer.msidSemantic.token = '*';
    }

    // Remove session-level ICE and DTLS parameters to avoid conflicts
    // delete parsedOffer.iceUfrag;
    // delete parsedOffer.icePwd;
    // delete parsedOffer.fingerprint;
    // delete parsedOffer.setup;

    // Get the first media description (usually audio)
    const offerMediaDescription = parsedOffer.media[0];
    if (!offerMediaDescription) {
      throw new Error('Missing audio media description in offer');
    }

    // Use SMB-provided SSRCs - no need to extract from offer
    if (
      !endpointDescription.audio.ssrcs ||
      endpointDescription.audio.ssrcs.length === 0
    ) {
      throw new Error('Missing audio ssrcs in SMB endpoint description');
    }

    // Get transport configuration from bundle-transport
    const transport = endpointDescription['bundle-transport'];
    if (!transport) {
      throw new Error('Missing bundle-transport in endpointDescription');
    }
    if (!transport.dtls) {
      throw new Error('Missing dtls in endpointDescription');
    }
    if (!transport.ice) {
      throw new Error('Missing ice in endpointDescription');
    }

    // Ensure SMB is ICE controlling
    // transport.ice.controlling = true;

    // Process all media sections to preserve order
    let bundleGroupMids = '';

    let candidatesAdded = false;

    for (let media of parsedOffer.media) {
      // Add to bundle group
      bundleGroupMids =
        bundleGroupMids === ''
          ? `${media.mid}`
          : `${bundleGroupMids} ${media.mid}`;

      // Set ICE and DTLS parameters
      // media.iceUfrag = transport.ice!.ufrag;
      // media.icePwd = transport.ice!.pwd;
      // media.fingerprint = {
      //   type: transport.dtls!.type,
      //   hash: transport.dtls!.hash
      // };
      media.setup = 'active';

      // Clear unnecessary fields
      media.ssrcGroups = undefined;
      media.msid = undefined;
      media.candidates = undefined;
      media.port = 9;
      media.rtcp = {
        port: 9,
        netType: 'IN',
        ipVer: 4,
        address: '0.0.0.0'
      };
      // media.rtcpMux = 'rtcp-mux';

      if (!candidatesAdded) {
        // Add ICE candidates
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
          (rtp) => rtp.codec.toLowerCase() === 'opus'
        );
        let opusPayloadType = media.rtp.at(0)?.payload;
        if (!opusPayloadType) {
          throw new Error('Missing opus payload type');
        }

        media.fmtp = media.fmtp.filter(
          (fmtp) => fmtp.payload === opusPayloadType
        );
        media.payloads = `${opusPayloadType}`;

        media.ext =
          media.ext &&
          media.ext.filter(
            (ext) =>
              ext.uri === 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' ||
              ext.uri ===
                'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
          );

        media.direction = 'recvonly';
        media.rtcpFb = undefined;
      } else if (media.type === 'video') {
        const vp8Codec = media.rtp.find((rtp) => rtp.codec === 'VP8');
        if (!vp8Codec) {
          throw new Error('Missing VP8 codec');
        }
        const vp8PayloadType = vp8Codec.payload;

        const rtxFmtp = media.fmtp.find(
          (fmtp) => fmtp.config === `apt=${vp8PayloadType}`
        );
        if (!rtxFmtp) {
          throw new Error('Missing RTX fmtp');
        }
        const vp8RtxPayloadType = rtxFmtp.payload;

        media.rtp = media.rtp.filter(
          (rtp) =>
            rtp.payload === vp8PayloadType || rtp.payload === vp8RtxPayloadType
        );

        media.fmtp = media.fmtp.filter(
          (fmtp) =>
            fmtp.payload === vp8PayloadType ||
            fmtp.payload === vp8RtxPayloadType
        );
        media.payloads = `${vp8PayloadType} ${vp8RtxPayloadType}`;
        media.setup = 'active';

        media.ext =
          media.ext &&
          media.ext.filter(
            (ext) =>
              ext.uri ===
                'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time' ||
              ext.uri === 'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id'
          );

        media.direction = 'recvonly';
        media.rtcpFb = media.rtcpFb?.filter(
          (rtcpFb) =>
            rtcpFb.payload === vp8PayloadType &&
            (rtcpFb.type === 'goog-remb' || rtcpFb.type === 'nack')
        );

        media.ssrcGroups = undefined;
      }
    }

    // Set up bundle group
    parsedOffer.groups = [
      {
        type: 'BUNDLE',
        mids: bundleGroupMids
      }
    ];

    transport.dtls.setup = offerMediaDescription.setup || '';
    transport.dtls.type = offerMediaDescription?.fingerprint?.type || '';
    transport.dtls.hash = offerMediaDescription?.fingerprint?.hash || '';
    transport.ice.ufrag = offerMediaDescription.iceUfrag || '';
    transport.ice.pwd = offerMediaDescription.icePwd || '';
    // transport.ice.candidates = [];
    transport.ice.candidates =
      offerMediaDescription.candidates?.map((c) => {
        return {
          ...c,
          generation: c.generation,
          component: c.component,
          priority: c.priority,
          foundation: c.foundation?.toString(),
          protocol: 'udp',
          port: c.port,
          ip: c.ip,
          type: c.type.toString()
        };
      }) || [];

    for (let media of parsedOffer.media) {
      if (media.type === 'audio') {
        endpointDescription.audio.ssrcs = [];
        media.ssrcs
          ?.filter((ssrc) => ssrc.attribute === 'msid')
          .forEach((ssrc) =>
            endpointDescription.audio.ssrcs.push(parseInt(`${ssrc.id}`))
          );
      } else if (media.type === 'video') {
        // endpointDescription.video = endpointDescription.video || {};
        // endpointDescription.video.streams = [];
        // let streamsMap = new Map();
        // media.ssrcs
        //   ?.filter((ssrc) => ssrc.attribute === 'msid' && ssrc.value)
        //   .forEach((ssrc) => {
        //     let mediaStreamId = ssrc.value?.split(' ')[0];
        //     let smbVideoStream = streamsMap.get(mediaStreamId);
        //     if (!smbVideoStream) {
        //       smbVideoStream = {
        //         sources: [],
        //         id: mediaStreamId,
        //         content: 'video'
        //       };
        //       streamsMap.set(mediaStreamId, smbVideoStream);
        //     }
        //     let feedbackGroup = media.ssrcGroups
        //       ?.filter((element) => element.semantics === 'FID')
        //       .filter((element) => element.ssrcs.indexOf(`${ssrc.id}`) !== -1)
        //       .pop();
        //     if (feedbackGroup) {
        //       let ssrcsSplit = feedbackGroup.ssrcs.split(' ');
        //       if (`${ssrc.id}` === ssrcsSplit[0]) {
        //         smbVideoStream.sources = [
        //           {
        //             main: parseInt(ssrcsSplit[0]),
        //             feedback: parseInt(ssrcsSplit[1])
        //           }
        //         ];
        //       }
        //     } else {
        //       smbVideoStream.sources = [
        //         {
        //           main: parseInt(`${ssrc.id}`)
        //         }
        //       ];
        //     }
        //   });
        // streamsMap.forEach((value) =>
        //   endpointDescription.video.streams.push(value)
        // );
      }
    }

    for (let media of parsedOffer.media) {
      if (media.type === 'audio') {
        endpointDescription.audio['payload-type'].id = media.rtp[0].payload;
        endpointDescription.audio['rtp-hdrexts'] = [];
        media.ext &&
          media.ext.forEach((ext) =>
            endpointDescription.audio['rtp-hdrexts'].push({
              id: ext.value,
              uri: ext.uri
            })
          );
      } else if (media.type === 'video') {
        // endpointDescription.video['payload-types'][0].id =
        //   media.rtp?.[0].payload;
        // endpointDescription.video['payload-types'][1].id =
        //   media.rtp?.[1].payload;
        // endpointDescription.video['payload-types'][1].parameters = {
        //   apt: media.rtp[0].payload.toString()
        // };
        // endpointDescription.video['rtp-hdrexts'] = [];
        // media.ext &&
        //   media.ext.forEach((ext) =>
        //     endpointDescription.video['rtp-hdrexts'].push({
        //       id: ext.value,
        //       uri: ext.uri
        //     })
        //   );
        // endpointDescription.video['payload-types'].forEach((payloadType) => {
        //   const rtcpFbs = media.rtcpFb?.filter(
        //     (element) => element.payload === payloadType.id
        //   );
        //   payloadType['rtcp-fbs'] = rtcpFbs?.map((rtcpFb) => {
        //     return {
        //       type: rtcpFb.type,
        //       subtype: rtcpFb.subtype || '' // Provide empty string as default when subtype is undefined
        //     };
        //   });
        // });
      }
    }

    // Generate the SDP answer
    const sdpAnswer = write(parsedOffer);

    console.log('sdpAnswer', JSON.stringify(parsedOffer));
    console.log(
      'Updated endpointDescription',
      JSON.stringify(endpointDescription)
    );

    // Configure the endpoint to handle incoming media
    // This tells SMB how to route the audio when it starts flowing
    await smb.configureEndpoint(
      smbServerUrl,
      smbConferenceId,
      endpointId,
      endpointDescription,
      smbServerApiKey
    );

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
