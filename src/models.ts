import { Static, Type } from '@sinclair/typebox';

export type NewProduction = Static<typeof NewProduction>;
export type NewProductionLine = Static<typeof NewProductionLine>;
export type Production = Static<typeof Production>;
export type ProductionResponse = Static<typeof ProductionResponse>;
export type ProductionListResponse = Static<typeof ProductionListResponse>;
export type DetailedProductionResponse = Static<
  typeof DetailedProductionResponse
>;
export type Line = Static<typeof Line>;
export type LineResponse = Static<typeof LineResponse>;
export type PatchLine = Static<typeof PatchLine>;
export type PatchLineResponse = Static<typeof PatchLineResponse>;
export type PatchProduction = Static<typeof PatchProduction>;
export type PatchProductionResponse = Static<typeof PatchProductionResponse>;
export type SmbEndpointDescription = Static<typeof SmbEndpointDescription>;
export type SmbAudioEndpointDescription = Static<
  typeof SmbAudioEndpointDescription
>;
export type DetailedConference = Static<typeof DetailedConference>;
export type Endpoint = Static<typeof Endpoint>;
export type UserResponse = Static<typeof UserResponse>;
export type UserSession = Static<typeof UserSession>;
export type Conference = Static<typeof Conference>;
export type NewSession = Static<typeof NewSession>;
export type SessionResponse = Static<typeof SessionResponse>;
export type SdpAnswer = Static<typeof SdpAnswer>;
export type ErrorResponse = Static<typeof ErrorResponse>;
export type IceCandidate = Static<typeof IceCandidate>;

export type NewIngest = Static<typeof NewIngest>;
export type Ingest = Static<typeof Ingest>;
export type IngestListResponse = Static<typeof IngestListResponse>;
export type PatchIngest = Static<typeof PatchIngest>;
export type PatchIngestResponse = Static<typeof PatchIngestResponse>;

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
      name: Type.String(),
      programOutputLine: Type.Optional(Type.Boolean())
    })
  )
});

export const NewProductionLine = Type.Object({
  name: Type.String(),
  programOutputLine: Type.Optional(Type.Boolean())
});

const SmbCandidate = Type.Object({
  generation: Type.Any(),
  component: Type.Any(),
  protocol: Type.Any(),
  port: Type.Number(),
  ip: Type.String(),
  'rel-port': Type.Optional(Type.Number()),
  'rel-addr': Type.Optional(Type.String()),
  foundation: Type.Optional(Type.String()),
  priority: Type.Any(),
  type: Type.Optional(Type.String()),
  network: Type.Optional(Type.Number())
});

export const SmbTransport = Type.Object({
  'rtcp-mux': Type.Optional(Type.Boolean()),
  ice: Type.Optional(
    Type.Object({
      ufrag: Type.String(),
      pwd: Type.String(),
      candidates: Type.Array(SmbCandidate),
      controlling: Type.Optional(Type.Boolean())
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
  minptime: Type.Optional(Type.String()),
  useinbandfec: Type.Optional(Type.String()),
  apt: Type.Optional(Type.String())
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

const VideoSmbPayloadParameters = Type.Object({
  'x-google-start-bitrate': Type.Optional(Type.String()),
  'x-google-max-bitrate': Type.Optional(Type.String()),
  'x-google-min-bitrate': Type.Optional(Type.String())
});

const VideoSmbPayloadType = Type.Object({
  id: Type.Number(),
  name: Type.String(),
  clockrate: Type.Number(),
  parameters: VideoSmbPayloadParameters,
  'rtcp-fbs': Type.Array(
    Type.Object({
      type: Type.String(),
      subtype: Type.Optional(Type.String()),
      payload: Type.Optional(Type.Number())
    })
  )
});

export const SmbVideoEndpointDescription = Type.Object({
  video: Type.Object({
    ssrcs: Type.Array(Type.Number()),
    'payload-type': VideoSmbPayloadType,
    'rtp-hdrexts': Type.Array(SmbRtpHeaderExtension),
    transport: SmbTransport
  }),
  data: Type.Optional(Type.Object({ port: Type.Number() })),
  idleTimeout: Type.Optional(Type.Number())
});

export const SmbEndpointDescription = Type.Object({
  'bundle-transport': Type.Optional(SmbTransport),
  audio: Type.Object({
    ssrcs: Type.Array(Type.Number()),
    'payload-type': AudioSmbPayloadType,
    'rtp-hdrexts': Type.Array(SmbRtpHeaderExtension)
  }),
  video: Type.Object({
    ssrcs: Type.Array(Type.Number()),
    'payload-type': VideoSmbPayloadType,
    'rtp-hdrexts': Type.Array(SmbRtpHeaderExtension)
  }),
  data: Type.Optional(Type.Object({ port: Type.Number() })),
  idleTimeout: Type.Optional(Type.Number())
});

export const SmbAudioEndpointDescription = Type.Object({
  audio: Type.Object({
    ssrcs: Type.Array(Type.Number()),
    'payload-type': AudioSmbPayloadType,
    'rtp-hdrexts': Type.Array(SmbRtpHeaderExtension),
    transport: SmbTransport
  }),
  data: Type.Optional(Type.Object({ port: Type.Number() })),
  idleTimeout: Type.Optional(Type.Number())
});

export const Endpoint = Type.Object({
  endpointId: Type.String(),
  sessionDescription: SmbEndpointDescription
});

export const Connections = Type.Record(Type.String(), Endpoint);

// ICE candidate type for WHIP Trickle ICE
export const IceCandidate = Type.Object({
  candidate: Type.String(),
  timestamp: Type.Number()
});

export const UserResponse = Type.Object({
  name: Type.String(),
  sessionId: Type.String(),
  endpointId: Type.Optional(Type.String()),
  isActive: Type.Boolean(),
  isWhip: Type.Boolean()
});

export const UserSession = Type.Object({
  name: Type.String(),
  smbConferenceId: Type.String(),
  productionId: Type.String(),
  lineId: Type.String(),
  lastSeen: Type.Number(),
  isActive: Type.Boolean(),
  isExpired: Type.Boolean(),
  endpointId: Type.Optional(Type.String()),
  sessionDescription: Type.Optional(SmbEndpointDescription),
  iceCandidates: Type.Optional(Type.Array(IceCandidate)),
  isWhip: Type.Boolean()
});

export const Conference = Type.Object({
  id: Type.String(),
  userCount: Type.Number(),
  users: Type.Array(Type.String())
});

export const Line = Type.Object({
  name: Type.String(),
  id: Type.String(),
  smbConferenceId: Type.String(),
  programOutputLine: Type.Optional(Type.Boolean())
});

export const LineResponse = Type.Object({
  name: Type.String(),
  id: Type.String(),
  smbConferenceId: Type.String(),
  participants: Type.Array(UserResponse),
  programOutputLine: Type.Optional(Type.Boolean())
});

export const PatchLine = Type.Omit(Line, ['id', 'smbConferenceId']);
export const PatchLineResponse = Type.Omit(Line, ['smbConferenceId']);

export const Production = Type.Object({
  _id: Type.Number(),
  name: Type.String(),
  lines: Type.Array(Line)
});

export const ProductionResponse = Type.Object({
  name: Type.String(),
  productionId: Type.String(),
  lines: Type.Optional(Type.Array(LineResponse))
});

export const PatchProduction = Type.Omit(Production, ['_id', 'lines']);
export const PatchProductionResponse = Type.Omit(Production, ['lines']);

export const ProductionListResponse = Type.Object({
  productions: Type.Array(ProductionResponse),
  offset: Type.Number(),
  limit: Type.Number(),
  totalItems: Type.Number()
});

export const DetailedProductionResponse = Type.Object({
  name: Type.String(),
  productionId: Type.String(),
  lines: Type.Array(LineResponse)
});

export const NewSession = Type.Object({
  productionId: Type.String(),
  lineId: Type.String(),
  username: Type.String()
});

export const SessionResponse = Type.Object({
  sdp: Type.String(),
  sessionId: Type.String()
});

export const SdpAnswer = Type.Object({
  sdpAnswer: Type.String()
});

export const ErrorResponse = Type.Object({
  message: Type.String(),
  stackTrace: Type.Optional(Type.String())
});

export const ShareRequest = Type.Object({
  path: Type.String({ description: 'The application path to share' })
});
export type ShareRequest = Static<typeof ShareRequest>;

export const ShareResponse = Type.Object({
  url: Type.String({ description: 'The share URL' })
});
export type ShareResponse = Static<typeof ShareResponse>;

export const ReAuthResponse = Type.Object({
  token: Type.String({ description: 'The new OSC Service Access Token' })
});
export type ReAuthResponse = Static<typeof ReAuthResponse>;

// WHIP endpoint request body schema
export const WhipRequest = Type.String({
  description: 'WebRTC SDP offer'
});

// WHIP endpoint response schema
export const WhipResponse = Type.String({
  description: 'Created'
});

export const NewIngest = Type.Object({
  label: Type.String(),
  ipAddress: Type.String()
});

export const Ingest = Type.Object({
  _id: Type.Number(),
  label: Type.String(),
  ipAddress: Type.String(),
  deviceOutput: Type.Array(
    Type.Object({
      name: Type.String(),
      label: Type.String()
    })
  ),
  deviceInput: Type.Array(
    Type.Object({
      name: Type.String(),
      label: Type.String()
    })
  )
});

export const IngestListResponse = Type.Object({
  ingests: Type.Array(Ingest),
  offset: Type.Number(),
  limit: Type.Number(),
  totalItems: Type.Number()
});

export const PatchIngest = Type.Union([
  Type.Object({ label: Type.String() }),
  Type.Object({
    deviceOutput: Type.Object({
      name: Type.String(),
      label: Type.String()
    })
  }),
  Type.Object({
    deviceInput: Type.Object({
      name: Type.String(),
      label: Type.String()
    })
  })
]);

export const PatchIngestResponse = Type.Omit(Ingest, ['ipAddress']);
