import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { SessionDescription } from 'sdp-transform';

import { SfuEndpointDescription } from './sfu/interface';
import { MediaStreamsInfo } from './mediaStreamsInfo';

export class Participant extends EventEmitter {
  private resourceId: string;
  private participantId: string;
  private nextMid: number = 0;
  private usedMids: string[] = [];

  protected mediaStreams?: MediaStreamsInfo;
  protected endpointDescription?: SfuEndpointDescription;

  constructor(
    resourceId: string,
    mediaStreams: MediaStreamsInfo | any,
    endpointDescription: SfuEndpointDescription
  ) {
    super();
    this.resourceId = resourceId;
    this.participantId = uuidv4();
    this.mediaStreams = mediaStreams;
    this.endpointDescription = endpointDescription;
    this.log(`Create, sfuResourceId ${resourceId}`);
  }

  getId(): string {
    return this.participantId;
  }

  getResourceId(): string {
    return this.resourceId;
  }

  protected log(...args: any[]) {
    console.log(`[participant ${this.participantId}]`, ...args);
  }

  protected error(...args: any[]) {
    console.error(`[participant ${this.participantId}]`, ...args);
  }

  createOffer(): SessionDescription {
    let offer: SessionDescription = {
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
        msidSemanticToken = `${this.mediaStreams.audio.ssrcs[0].mslabel}`;
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

  protected makeMediaDescription(type: string): any {
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
      rtcpMux: 'rtcp-mux',
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

    for (let element of this.mediaStreams.audio.ssrcs) {
      let audioDescription = this.makeMediaDescription('audio');
      audioDescription.payloads = audioPayloadType.id.toString();
      audioDescription.rtp = [
        {
          payload: audioPayloadType.id,
          codec: audioPayloadType.name,
          rate: audioPayloadType.clockrate,
          encoding: audioPayloadType.channels
        }
      ];

      const parameters = Object.keys(audioPayloadType.parameters);
      if (parameters.length !== 0) {
        audioDescription.fmtp = [
          {
            payload: audioPayloadType.id,
            config: parameters
              .map(
                (element) =>
                  `${element}=${audioPayloadType.parameters[element]}`
              )
              .join(';')
          }
        ];
      }

      audioDescription.ext = audio['rtp-hdrexts'].flatMap((element) => {
        return { value: element.id, uri: element.uri };
      });

      audioDescription.ssrcs.push({
        id: element.ssrc,
        attribute: 'cname',
        value: element.cname
      });
      audioDescription.ssrcs.push({
        id: element.ssrc,
        attribute: 'label',
        value: element.label
      });
      audioDescription.ssrcs.push({
        id: element.ssrc,
        attribute: 'mslabel',
        value: element.mslabel
      });
      audioDescription.ssrcs.push({
        id: element.ssrc,
        attribute: 'msid',
        value: `${element.mslabel} ${element.label}`
      });

      offer.media.push(audioDescription);
    }

    // let videoMsLabels = new Set(this.mediaStreams.video.ssrcs.flatMap(element => element.mslabel));

    // for (let msLabel of videoMsLabels) {
    //   const video = this.endpointDescription.video;
    //   let videoDescription = this.makeMediaDescription('video');
    //   videoDescription.payloads = video["payload-types"]
    //     .flatMap(element => element.id)
    //     .join(' ');
    //   videoDescription.rtp = video["payload-types"].flatMap(element => {
    //     return {
    //       payload: element.id,
    //       codec: element.name,
    //       rate: element.clockrate,
    //       encoding: element.channels
    //     }
    //   });
    //   videoDescription.ext = video["rtp-hdrexts"].flatMap(element => {
    //     return { value: element.id, uri: element.uri }
    //   });

    //   video["payload-types"].forEach(payloadType => {
    //     const parameters = Object.keys(payloadType.parameters);
    //     if (parameters.length !== 0) {
    //       videoDescription.fmtp.push({
    //         payload: payloadType.id,
    //         config: parameters
    //           .map(element => `${element}=${payloadType.parameters[element]}`)
    //           .join(';')
    //       });
    //     }

    //     payloadType["rtcp-fbs"].forEach(rtcpFb => {
    //       videoDescription.rtcpFb.push({
    //         payload: payloadType.id,
    //         type: rtcpFb.type,
    //         subtype: rtcpFb.subtype
    //       });
    //     });
    //   });

    //   for (let ssrc of this.mediaStreams.video.ssrcs.filter(element => element.mslabel === msLabel)) {
    //     videoDescription.ssrcs.push({ id: ssrc.ssrc, attribute: 'cname', value: ssrc.cname });
    //     videoDescription.ssrcs.push({ id: ssrc.ssrc, attribute: 'label', value: ssrc.label });
    //     videoDescription.ssrcs.push({ id: ssrc.ssrc, attribute: 'mslabel', value: ssrc.mslabel });
    //     videoDescription.ssrcs.push({ id: ssrc.ssrc, attribute: 'msid', value: `${ssrc.mslabel} ${ssrc.label}` });
    //   }

    //   videoDescription.ssrcGroups = this.mediaStreams.video.ssrcGroups.flatMap(element => {
    //     return {
    //       semantics: element.semantics,
    //       ssrcs: element.ssrcs.join(' ')
    //     }
    //   });
    //   offer.media.push(videoDescription);
    // }
  }

  protected addSFUMids(offer: SessionDescription) {
    // const video = this.endpointDescription.video;
    // const videoSsrc = video.streams[0].sources[0].main;

    // let videoDescription = this.makeMediaDescription('video');
    // videoDescription.payloads = video["payload-types"]
    //   .flatMap(element => element.id)
    //   .join(' ');
    // videoDescription.rtp = video["payload-types"].flatMap(element => {
    //   return {
    //     payload: element.id,
    //     codec: element.name,
    //     rate: element.clockrate,
    //     encoding: element.channels
    //   }
    // });

    // video["payload-types"].forEach(payloadType => {
    //   const parameters = Object.keys(payloadType.parameters);
    //   if (parameters.length !== 0) {
    //     videoDescription.fmtp.push({
    //       payload: payloadType.id,
    //       config: parameters
    //         .map(element => `${element}=${payloadType.parameters[element]}`)
    //         .join(';')
    //     });
    //   }
    // });

    // videoDescription.ext = video["rtp-hdrexts"].flatMap(element => {
    //   return { value: element.id, uri: element.uri }
    // });
    // videoDescription.ssrcs = [
    //   { id: videoSsrc, attribute: 'cname', value: 'feedbackvideocname' },
    //   { id: videoSsrc, attribute: 'label', value: 'feedbackvideolabel' },
    //   { id: videoSsrc, attribute: 'mslabel', value: 'feedbackvideomslabel' },
    //   { id: videoSsrc, attribute: 'msid', value: 'feedbackvideomslabel feedbackvideolabel' }
    // ];
    // offer.media.push(videoDescription);

    let dataDescription = this.makeMediaDescription('application');
    dataDescription.protocol = 'UDP/DTLS/SCTP';
    dataDescription.payloads = 'webrtc-datachannel';
    dataDescription.sctpmap = {
      sctpmapNumber: 5000,
      app: 'webrtc-datachannel',
      maxMessageSize: 262144
    };
    offer.media.push(dataDescription);
  }
}
