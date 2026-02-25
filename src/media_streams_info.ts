export interface MediaStreamsInfoSsrc {
  ssrc: string;
  cname?: string;
  mslabel?: string;
  label?: string;
}

export interface MediaStreamsInfoSsrcGroup {
  semantics: string;
  ssrcs: string[];
}

export interface MediaStreamsInfo {
  audio: {
    ssrcs: MediaStreamsInfoSsrc[];
  };
}

export type RtpCodec = {
  payload: number;
  codec: string;
  rate?: number;
  encoding?: number;
};

export type Fmtp = {
  payload: number;
  config: string;
};

export type RtpHeaderExt = {
  value: number;
  uri: string;
};

export type RtcpFb = {
  payload: number | string;
  type: string;
  subtype?: string;
};

const MediaStreamsInfoSsrcSchema = {
  ssrc: { type: 'string' },
  cname: { type: 'string' },
  mslabel: { type: 'string' },
  label: { type: 'string' }
};

const MediaStreamsInfoSsrcGroupSchema = {
  semantics: { type: 'string' },
  ssrcs: { type: 'array', items: { type: 'string' } }
};

export const MediaStreamsSchema = {
  $id: 'mediastream',
  type: 'object',
  properties: {
    audio: {
      type: 'object',
      properties: {
        ssrcs: {
          type: 'array',
          items: { type: 'object', properties: MediaStreamsInfoSsrcSchema }
        }
      }
    },
    video: {
      type: 'object',
      properties: {
        ssrcs: {
          type: 'array',
          items: { type: 'object', properties: MediaStreamsInfoSsrcSchema }
        },
        ssrcsGroups: {
          type: 'array',
          items: { type: 'object', properties: MediaStreamsInfoSsrcGroupSchema }
        }
      }
    }
  }
};
