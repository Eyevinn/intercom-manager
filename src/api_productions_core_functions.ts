import { SessionDescription, parse, write } from 'sdp-transform';
import { Connection } from './connection';
import { MediaStreamsInfoSsrc } from './media_streams_info';
import { LineResponse, Production, SmbEndpointDescription } from './models';
import { SmbProtocol } from './smb';
import { ConnectionQueue } from './connection_queue';
import { ProductionManager } from './production_manager';
import { v4 as uuidv4 } from 'uuid';

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
      endpoint,
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
    if (parsedOffer.origin) {
      parsedOffer.origin.sessionVersion++;
    }

    // Remove ICE controlling indicators from client offer to prevent role conflicts
    // This ensures SMB can be ICE controlling without conflicts
    if ((parsedOffer as any).iceOptions) {
      delete (parsedOffer as any).iceOptions;
    }

    parsedOffer.media.forEach((media, index) => {
      if ((media as any).iceOptions) {
        delete (media as any).iceOptions;
      }
    });

    // Set up MSID semantic if not present
    if (!parsedOffer.msidSemantic) {
      parsedOffer.msidSemantic = {
        semantic: 'WMS',
        token: '*'
      };
    } else {
      // Ensure the token is set to '*' for proper MSID handling
      parsedOffer.msidSemantic.token = '*';
    }

    // Remove session-level ICE and DTLS parameters to avoid conflicts
    delete parsedOffer.iceUfrag;
    delete parsedOffer.icePwd;
    delete parsedOffer.fingerprint;
    delete parsedOffer.setup;

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
    const processedMedia = [];

    for (let media of parsedOffer.media) {
      // Add to bundle group
      bundleGroupMids =
        bundleGroupMids === ''
          ? `${media.mid}`
          : `${bundleGroupMids} ${media.mid}`;

      if (media.type === 'audio') {
        // Process audio media with SMB configuration
        const smbAudio = endpointDescription.audio;
        const smbPayloadType = smbAudio['payload-type'];

        // Set ICE and DTLS parameters
        media.iceUfrag = transport.ice!.ufrag;
        media.icePwd = transport.ice!.pwd;
        media.fingerprint = {
          type: transport.dtls!.type,
          hash: transport.dtls!.hash
        };
        media.setup = 'passive';

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
        media.rtcpMux = 'rtcp-mux';

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

        // Set up RTP with SMB-provided payload type
        media.rtp = [
          {
            payload: smbPayloadType.id,
            codec: smbPayloadType.name,
            rate: smbPayloadType.clockrate
          }
        ];

        // Use SMB-provided RTP header extensions
        media.ext = smbAudio['rtp-hdrexts'].map((ext) => ({
          value: ext.id,
          uri: ext.uri
        }));

        // Set up FMTP with SMB-provided parameters
        if (smbPayloadType.parameters) {
          const fmtpParams = Object.entries(smbPayloadType.parameters)
            .map(([key, value]) => `${key}=${value}`)
            .join(';');

          media.fmtp = [
            {
              payload: smbPayloadType.id,
              config: fmtpParams
            }
          ];
        } else {
          media.fmtp = [];
        }

        // Set payloads to SMB-provided payload type
        media.payloads = `${smbPayloadType.id}`;

        // Set up SSRCs from SMB (only use the provided SSRC)
        if (smbAudio.ssrcs && smbAudio.ssrcs.length > 0) {
          media.ssrcs = [
            {
              id: smbAudio.ssrcs[0], // Only use the first SSRC from SMB
              attribute: 'cname',
              value: uuidv4()
            }
          ];
        }

        // For WHIP: Client sends audio to server, server receives it
        media.direction = 'recvonly';

        // Use SMB-provided RTCP feedback if available
        media.rtcpFb =
          smbPayloadType['rtcp-fbs']?.map((fb) => ({
            payload: smbPayloadType.id,
            type: fb.type,
            subtype: fb.subtype
          })) || [];
      } else {
        // For non-audio media (video, etc.), set to inactive
        media.direction = 'inactive';
        media.port = 0;
        media.payloads = '0'; // Use a dummy payload type for inactive media
        media.rtp = [];
        media.fmtp = [];
        media.rtcpFb = [];
        media.ssrcs = [];
        media.ssrcGroups = undefined;
        media.msid = undefined;
        media.candidates = undefined;
        media.iceUfrag = undefined;
        media.icePwd = undefined;
        media.fingerprint = undefined;
        media.setup = undefined;
        media.ext = [];
      }

      processedMedia.push(media);
    }

    // Keep all media sections in original order
    parsedOffer.media = processedMedia;

    // Set up bundle group
    parsedOffer.groups = [
      {
        type: 'BUNDLE',
        mids: bundleGroupMids
      }
    ];

    // await smb.configureEndpoint(
    //   smbServerUrl,
    //   smbConferenceId,
    //   endpointId,
    //   endpointDescription,
    //   smbServerApiKey
    // );

    // Return the answer// Return the answer
    console.log('endpointDescription', JSON.stringify(endpointDescription));
    console.log('answer', JSON.stringify(parsedOffer));
    const sdpAnswer = write(parsedOffer);

    // await this.handleAnswerRequest(
    //   smb,
    //   smbServerUrl,
    //   smbServerApiKey,
    //   lineId,
    //   endpointId,
    //   endpointDescription,
    //   sdpAnswer
    // );

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
