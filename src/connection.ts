import { SessionDescription } from 'sdp-transform';

import {
  AudioSmbPayloadParameters,
  MediaDescriptionBase,
  SfuEndpointDescription
} from './sfu/interface';
import { MediaStreamsInfo } from './media_streams_info';

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
    console.log(`[connection ${this.connectionId}]`, ...args);
  }

  protected error(...args: string[] | Connection[]) {
    console.error(`[connection ${this.connectionId}]`, ...args);
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
    if (!this.mediaStreams.audio.ssrcs) {
      throw new Error('Missing mediaStreams.audio.ssrcs');
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

    if (!this.mediaStreams.video) {
      return;
    }

    if (!this.endpointDescription.video) {
      return;
    }
    //If there is no video, none of the below processing is necessary

    let videoMsLabels = new Set(
      this.mediaStreams.video.ssrcs.flatMap((element) => element.mslabel)
    );

    console.log(videoMsLabels);

    for (let msLabel of videoMsLabels) {
      const video = this.endpointDescription.video;
      let videoDescription = this.makeMediaDescription('video');
      videoDescription.payloads = video['payload-types']
        .flatMap((element) => element.id)
        .join(' ');
      videoDescription.rtp = video['payload-types'].flatMap((element) => {
        return {
          payload: element.id,
          codec: element.name,
          rate: element.clockrate,
          encoding: element.channels
        };
      });
      if (video['rtp-hdrexts']) {
        videoDescription.ext = video['rtp-hdrexts'].flatMap((element) => {
          return { value: element.id, uri: element.uri };
        });
      }

      video['payload-types'].forEach((payloadType) => {
        const parameters = Object.keys(payloadType.parameters);
        if (parameters.length !== 0) {
          videoDescription.fmtp.push({
            payload: payloadType.id,
            config: parameters
              .map((element) => `${element}=${payloadType.parameters[element]}`)
              .join(';')
          });
        }

        if (payloadType['rtcp-fbs']) {
          payloadType['rtcp-fbs'].forEach((rtcpFb) => {
            videoDescription.rtcpFb.push({
              payload: payloadType.id,
              type: rtcpFb.type,
              subtype: rtcpFb.subtype
            });
          });
        }
      });

      for (let ssrc of this.mediaStreams.video.ssrcs.filter(
        (element) => element.mslabel === msLabel
      )) {
        videoDescription.ssrcs.push({
          id: ssrc.ssrc,
          attribute: 'cname',
          value: ssrc.cname
        });
        videoDescription.ssrcs.push({
          id: ssrc.ssrc,
          attribute: 'label',
          value: ssrc.label
        });
        videoDescription.ssrcs.push({
          id: ssrc.ssrc,
          attribute: 'mslabel',
          value: ssrc.mslabel
        });
        videoDescription.ssrcs.push({
          id: ssrc.ssrc,
          attribute: 'msid',
          value: `${ssrc.mslabel} ${ssrc.label}`
        });
      }

      videoDescription.ssrcGroups = this.mediaStreams.video.ssrcGroups.flatMap(
        (element) => {
          return {
            semantics: element.semantics,
            ssrcs: element.ssrcs.join(' ')
          };
        }
      );
      offer.media.push(videoDescription);
    }
  }

  protected addSFUMids(offer: SessionDescription) {
    if (!this.endpointDescription) {
      throw new Error(
        `Failed to add SFU Mids: endpointDescription does not exist`
      );
    }

    const dataDescription = this.makeMediaDescription('application');
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
