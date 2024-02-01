import { Type, Static } from '@sinclair/typebox';

export type NewProduction = Static<typeof NewProduction>;
export type Production = Static<typeof Production>;
export type Line = Static<typeof Line>;
export type SmbEndpointDescription = Static<typeof SmbEndpointDescription>;
export type DetailedConference = Static<typeof DetailedConference>;

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

const MediaPayloadType = Type.Object({
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

const SfuVideoSource = Type.Object({
  main: Type.Number(),
  feedback: Type.Optional(Type.Number())
});

const SfuVideoStream = Type.Object({
  sources: Type.Array(SfuVideoSource),
  id: Type.String(),
  content: Type.String()
});

export const SmbEndpointDescription = Type.Object({
  'bundle-transport': Type.Optional(SmbTransport),
  audio: Type.Object({
    ssrcs: Type.Array(Type.Number()),
    'payload-type': MediaPayloadType,
    'rtp-hdrexts': Type.Array(SmbRtpHeaderExtension)
  }),
  video: Type.Optional(
    Type.Object({
      streams: Type.Array(SfuVideoStream),
      'payload-types': Type.Array(MediaPayloadType),
      'rtp-hdrexts': Type.Array(SmbRtpHeaderExtension)
    })
  ),
  data: Type.Optional(Type.Object({ port: Type.Number() })),
  idleTimeout: Type.Optional(Type.Number())
});

export const Endpoint = Type.Object({
  endpointId: Type.String(),
  sessionDescription: SmbEndpointDescription
});

export const Connections = Type.Record(Type.String(), Endpoint);

export const Production = Type.Object({
  name: Type.String(),
  lines: Type.Array(
    Type.Object({
      name: Type.String(),
      id: Type.String(),
      connections: Connections
    })
  )
});

export const Line = Type.Object({
  name: Type.String(),
  id: Type.String(),
  connections: Connections
});
