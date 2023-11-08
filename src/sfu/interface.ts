export enum SfuType {
  smb = 'SMB'
}

interface SfuCandidate {
  generation: number;
  component: number;
  protocol: string;
  port: number;
  ip: string;
  'rel-port'?: number;
  'rel-addr'?: string;
  foundation: string;
  priority: number;
  type: string;
  network?: number;
}

export interface SfuTransport {
  'rtcp-mux'?: boolean;

  ice?: {
    ufrag: string;
    pwd: string;
    candidates: SfuCandidate[];
  };
  dtls?: {
    setup: string;
    type: string;
    hash: string;
  };
}

interface RtcpFeedback {
  type: string;
  subtype: string;
}

interface SfuPayloadType {
  id: number;
  name: string;
  clockrate: number;
  channels?: number;
  parameters?: any;
  'rtcp-fbs'?: RtcpFeedback[];
}

interface SfuRtpHeaderExtension {
  id: number;
  uri: string;
}

export interface SfuVideoSource {
  main: number;
  feedback?: number;
}

export interface SfuVideoStream {
  sources: SfuVideoSource[];
  id: string;
  content: string;
}

export interface SfuEndpointDescription {
  'bundle-transport'?: SfuTransport;
  audio?: {
    ssrcs: number[];
    'payload-type': SfuPayloadType;
    'rtp-hdrexts': SfuRtpHeaderExtension[];
  };

  video?: {
    streams: SfuVideoStream[];
    'payload-types': SfuPayloadType[];
    'rtp-hdrexts'?: SfuRtpHeaderExtension[];
  };
}

// export interface SfuProtocol {
//   //log(...args: any[]);
//   allocateEndpoint(conferenceId: string,
//     endpointId: string, audio: boolean, video: boolean, data: boolean): Promise<SfuEndpointDescription>;
//   configureEndpoint(conferenceId: string, endpointId: string,
//     endpointDescription: SfuEndpointDescription): Promise<void>;

// }
