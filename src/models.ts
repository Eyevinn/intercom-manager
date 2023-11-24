import { Type } from '@sinclair/typebox';

export const Audio = Type.Object({
  'relay-type': Type.Array(
    Type.Union([
      Type.Literal('forwarder'),
      Type.Literal('mixed'),
      Type.Literal('ssrc-rewrite')
    ])
  )
});
export const Video = Type.Object({
  'relay-type': Type.Union([
    Type.Literal('forwarder'),
    Type.Literal('ssrc-rewrite')
  ])
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
  video: Video,
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

export const Production = Type.Object({
  name: Type.String(),
  lines: Type.Array(
    Type.Object({
      name: Type.String(),
      id: Type.String(),
      connections: Type.Any()
    })
  )
});

export const Line = Type.Object({
  name: Type.String(),
  id: Type.String(),
  connections: Type.Any()
});

export const ConferenceId = Type.Object({
  id: Type.Integer()
});
