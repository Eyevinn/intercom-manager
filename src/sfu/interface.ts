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

export interface AudioSmbPayloadParameters {
  minptime: string;
  useinbandfec: string;
}

interface AudioSmbPayloadType {
  id: number;
  name: string;
  clockrate: number;
  channels?: number;
  parameters: AudioSmbPayloadParameters;
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
  audio: {
    ssrcs: number[];
    'payload-type': AudioSmbPayloadType;
    'rtp-hdrexts': SfuRtpHeaderExtension[];
  };

  video?: {
    streams: SfuVideoStream[];
    'payload-types': SfuPayloadType[];
    'rtp-hdrexts'?: SfuRtpHeaderExtension[];
  };
}

interface Rtp {
  payload: number;
  codec: string;
  rate: number;
  encoding?: number;
}

interface Fmtp {
  payload: number;
  config: string;
}

interface Ext {
  value: number;
  uri: string;
}

interface Ssrc {
  id: string;
  attribute: string;
  value?: string;
}

interface RtcpFb {
  payload: number;
  type: string;
  subtype?: string | undefined;
}

interface sctpmap {
  sctpmapNumber: number;
  app: string;
  maxMessageSize: number;
}

interface SsrcGroup {
  semantics: string;
  ssrcs: string;
}

export interface MediaDescriptionBase {
  mid: string;
  type: string;
  port: number;
  protocol: string;
  payloads: string;
  rtp: Rtp[];
  fmtp: Fmtp[];
  rtcpFb: RtcpFb[];
  rtcp: {
    port: number;
    netType: string;
    ipVer: number;
    address: string;
  };
  ext: Ext[];
  sctpmap?: sctpmap;
  ssrcs: Ssrc[];
  ssrcGroups?: SsrcGroup[];
  iceUfrag: string;
  icePwd: string;
  fingerprint: {
    type: string;
    hash: string;
  };
  setup: string;
  direction: 'sendrecv' | 'recvonly' | 'sendonly' | 'inactive' | undefined;
  rtcpMux: string;
  connection: {
    version: number;
    ip: string;
  };
  candidates: {
    foundation: string;
    component: number;
    transport: string;
    priority: number;
    ip: string;
    port: number;
    type: string;
    raddr?: string;
    rport?: number;
    generation: number;
    'network-id'?: number;
  }[];
}
