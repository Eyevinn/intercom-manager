import { parse } from 'sdp-transform';
import { Connection } from './connection';
import { MediaStreamsInfoSsrc } from './media_streams_info';
import { Line, Production, SmbEndpointDescription } from './models';
import { SmbProtocol } from './smb';
import { CoreFunctionsInterface } from './api_productions_core_functions_interface';
import { ConnectionQueue } from './connection_queue';
import { ProductionManager } from './production_manager';

export class CoreFunctions implements CoreFunctionsInterface {
  private productionManager: ProductionManager;
  private connectionQueue: ConnectionQueue;

  constructor(
    productionManager: ProductionManager,
    connectionQueue: ConnectionQueue
  ) {
    this.productionManager = productionManager;
    this.connectionQueue = connectionQueue;
  }

  createConnection(
    endpoint: SmbEndpointDescription,
    productionId: string,
    lineId: string,
    username: string,
    endpointId: string,
    sessionId: string
  ): Connection {
    if (!endpoint.audio) {
      throw new Error('Missing audio when creating offer');
    }

    const ssrcs: MediaStreamsInfoSsrc[] = [];
    endpoint.audio.ssrcs.forEach((ssrcsNr) => {
      ssrcs.push({
        ssrc: ssrcsNr.toString(),
        cname: `${username}_audioCName`,
        mslabel: `${username}_audioMSLabel`,
        label: `${username}_audioLabel`
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

    this.productionManager.addConnectionToLine(
      productionId,
      lineId,
      endpoint,
      endpointId,
      sessionId
    );

    return connection;
  }

  async createEndpoint(
    smb: SmbProtocol,
    smbServerUrl: string,
    lineId: string,
    endpointId: string,
    audio: boolean,
    data: boolean,
    endpointIdleTimeout: number
  ): Promise<SmbEndpointDescription> {
    const endpoint: SmbEndpointDescription = await smb.allocateEndpoint(
      smbServerUrl,
      lineId,
      endpointId,
      audio,
      data,
      endpointIdleTimeout
    );
    return endpoint;
  }

  async handleAnswerRequest(
    smb: SmbProtocol,
    smbServerUrl: string,
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
    transport.ice.ufrag = answerMediaDescription.iceUfrag || '';
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
      endpointDescription
    );
  }

  private async createConference(
    smb: SmbProtocol,
    smbServerUrl: string,
    production: Production,
    lineId: string
  ): Promise<void> {
    const activeLines: string[] = await smb.getConferences(smbServerUrl);

    const line: Line = this.getLine(production.lines, lineId);

    if (!activeLines.includes(line.smbid)) {
      const newConferenceId = await smb.allocateConference(smbServerUrl);
      if (
        !this.productionManager.setLineId(
          production.productionid,
          line.id,
          newConferenceId
        )
      ) {
        throw new Error(
          `Failed to set line smb id for line ${line.id} in production ${production.productionid}`
        );
      }
    }
  }

  async createConferenceForLine(
    smb: SmbProtocol,
    smbServerUrl: string,
    production: Production,
    lineId: string
  ): Promise<void> {
    const createConf = () =>
      this.createConference(smb, smbServerUrl, production, lineId);

    await this.connectionQueue.queueAsync(createConf);
  }

  getProduction(productionId: string): Production {
    const production: Production | undefined =
      this.productionManager.getProduction(productionId);
    if (!production) {
      throw new Error('Trying to get production that does not exist');
    }
    return production;
  }

  getLine(productionLines: Line[], lineId: string): Line {
    const line: Line | undefined = this.productionManager.getLine(
      productionLines,
      lineId
    );
    if (!line) {
      throw new Error('Trying to get line that does not exist');
    }
    return line;
  }

  retrieveLineFromProduction(productionId: string, lineId: string): Line {
    const production: Production = this.getProduction(productionId);
    const line: Line = this.getLine(production.lines, lineId);
    return line;
  }
}
