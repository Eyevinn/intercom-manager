import { Type, Static } from '@sinclair/typebox';

export type NewProduction = Static<typeof NewProduction>;
export type Production = Static<typeof Production>;
export type ProductionResponse = Static<typeof ProductionResponse>;
export type DetailedProductionResponse = Static<
  typeof DetailedProductionResponse
>;
export type Line = Static<typeof Line>;
export type LineResponse = Static<typeof LineResponse>;
export type SmbEndpointDescription = Static<typeof SmbEndpointDescription>;
export type DetailedConference = Static<typeof DetailedConference>;
export type Endpoint = Static<typeof Endpoint>;
export type User = Static<typeof User>;
export type UserSession = Static<typeof UserSession>;

export const Audio = Type.Object({
  'relay-type': Type.Array(
    Type.Union([
      Type.Literal('forwarder'),
      Type.Literal('mixed'),
      Type.Literal('ssrc-rewrite')
    ])
  )
});

export const DetailedConference = Type.Object({
  dtlsState: Type.String(),
  iceState: Type.String(),
  id: Type.String(),
  isActiveTalker: Type.Boolean(),
  isDominantSpeaker: Type.Boolean(),
  ActiveTalker: Type.Optional(
    Type.Object({
      noiseLevel: Type.Number(),
      ptt: Type.Boolean(),
      score: Type.Number()
    })
  )
});

export const AllocateConference = Type.Object({
  'last-n': Type.Integer(),
  'global-port': Type.Boolean()
});

export const AllocateEndpoint = Type.Object({
  action: Type.Literal('allocate'),
  'bundle-transport': Type.Object({
    'ice-controlling': Type.Boolean(),
    ice: Type.Literal(true),
    dtls: Type.Boolean(),
    sdes: Type.Boolean()
  }),
  audio: Audio,
  data: Type.Object({}),
  idleTimeout: Type.Integer()
});

export const NewProduction = Type.Object({
  name: Type.String(),
  lines: Type.Array(
    Type.Object({
      name: Type.String()
    })
  )
});

const SmbCandidate = Type.Object({
  generation: Type.Number(),
  component: Type.Number(),
  protocol: Type.String(),
  port: Type.Number(),
  ip: Type.String(),
  'rel-port': Type.Optional(Type.Number()),
  'rel-addr': Type.Optional(Type.String()),
  foundation: Type.String(),
  priority: Type.Number(),
  type: Type.String(),
  network: Type.Optional(Type.Number())
});

export const SmbTransport = Type.Object({
  'rtcp-mux': Type.Optional(Type.Boolean()),
  ice: Type.Optional(
    Type.Object({
      ufrag: Type.String(),
      pwd: Type.String(),
      candidates: Type.Array(SmbCandidate)
    })
  ),
  dtls: Type.Optional(
    Type.Object({
      setup: Type.String(),
      type: Type.String(),
      hash: Type.String()
    })
  )
});

const RtcpFeedback = Type.Object({
  type: Type.String(),
  subtype: Type.String()
});

const AudioSmbPayloadParameters = Type.Object({
  minptime: Type.String(),
  useinbandfec: Type.String()
});

const AudioSmbPayloadType = Type.Object({
  id: Type.Number(),
  name: Type.String(),
  clockrate: Type.Number(),
  channels: Type.Optional(Type.Number()),
  parameters: AudioSmbPayloadParameters,
  'rtcp-fbs': Type.Optional(Type.Array(RtcpFeedback))
});

const SmbRtpHeaderExtension = Type.Object({
  id: Type.Number(),
  uri: Type.String()
});

export const SmbEndpointDescription = Type.Object({
  'bundle-transport': Type.Optional(SmbTransport),
  audio: Type.Object({
    ssrcs: Type.Array(Type.Number()),
    'payload-type': AudioSmbPayloadType,
    'rtp-hdrexts': Type.Array(SmbRtpHeaderExtension)
  }),
  data: Type.Optional(Type.Object({ port: Type.Number() })),
  idleTimeout: Type.Optional(Type.Number())
});

export const Endpoint = Type.Object({
  endpointId: Type.String(),
  sessionDescription: SmbEndpointDescription
});

export const Connections = Type.Record(Type.String(), Endpoint);

export const User = Type.Object({
  name: Type.String(),
  sessionid: Type.String(),
  isActive: Type.Boolean()
});

export const UserSession = Type.Object({
  name: Type.String(),
  productionId: Type.String(),
  lineId: Type.String(),
  lastSeen: Type.Number(),
  isActive: Type.Boolean(),
  isExpired: Type.Boolean(),
  endpointId: Type.Optional(Type.String()),
  sessionDescription: Type.Optional(SmbEndpointDescription)
});

export const Line = Type.Object({
  name: Type.String(),
  id: Type.String(),
  smbconferenceid: Type.String()
});

export const LineResponse = Type.Object({
  name: Type.String(),
  id: Type.String(),
  smbconferenceid: Type.String(),
  participants: Type.Array(User)
});

export const Production = Type.Object({
  _id: Type.Number(),
  name: Type.String(),
  lines: Type.Array(Line)
});

export const ProductionResponse = Type.Object({
  name: Type.String(),
  productionid: Type.String()
});

export const DetailedProductionResponse = Type.Object({
  name: Type.String(),
  productionid: Type.String(),
  lines: Type.Array(LineResponse)
});
