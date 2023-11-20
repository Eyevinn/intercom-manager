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

//Allocation Models
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

//Production
export const NewProduction = Type.Object({
  name: Type.String(),
  lines: Type.Array(
    Type.Object({
      name: Type.String()
    })
  )
});

export const Production = Type.Object({
  id: Type.String(),
  name: Type.String(),
  lines: Type.Array(
    Type.Object({
      name: Type.String(),
      id: Type.String()
    })
  )
});

//Line
export const Line = Type.Object({
  name: Type.String(),
  id: Type.String()
});

//Conference
export const ConferenceId = Type.Object({
  id: Type.Integer()
});

//Endpoint
const SOURCES = Type.Array(
  Type.Object({
    main: Type.Integer(),
    feedback: Type.Integer()
  })
);

const DTLS = Type.Object({
  setup: Type.String(),
  type: Type.String(),
  hash: Type.String()
});

const SDES = Type.Array(
  Type.Object({
    profile: Type.String(),
    key: Type.String()
  })
);

const CANDIDATES = Type.Array(
  Type.Object({
    foundation: Type.String(),
    component: Type.Integer(),
    protocol: Type.String(),
    priority: Type.Integer(),
    ip: Type.String(),
    port: Type.Integer(),
    type: Type.String(),
    generation: Type.Integer(),
    network: Type.Integer()
  })
);

const AUDIO_PAYLOAD_TYPE = Type.Object({
  id: Type.Integer(),
  parameters: Type.Object({
    minptime: Type.String(),
    useinbandfec: Type.String()
  }),
  'rtcp-fbs': Type.Array(Type.Any()),
  name: Type.String(),
  clockrate: Type.Integer(),
  channels: Type.Integer()
});

const RTP_HDREXT = Type.Array(
  Type.Object({
    id: Type.Integer(),
    uri: Type.String()
  })
);

const PARAMS = Type.Object({
  apt: Type.String()
});

const VIDEO_STREAM = Type.Array(
  Type.Object({
    content: Type.String(),
    sources: SOURCES
  })
);

const VIDEO_STREAMS = Type.Array(VIDEO_STREAM);

const VIDEO_PAYLOAD_TYPES = Type.Array(
  Type.Object({
    id: Type.Number(),
    parameters: Type.Object({}),
    rtcp_fbs: Type.Array(
      Type.Object({
        type: Type.String(),
        subtype: Type.Optional(Type.String())
      })
    ),
    name: Type.String(),
    clockrate: Type.Number()
  })
);

const RTP_HDR_EXTS = Type.Array(
  Type.Object({
    id: Type.Number(),
    uri: Type.String()
  })
);

const RECONFIGURED_STREAMS = Type.Array(
  Type.Object({
    sources: SOURCES,
    id: Type.String(),
    content: Type.String()
  })
);

export const Endpoint = Type.Object({
  bundleTransport: Type.Object({
    dtls: DTLS,
    sdes: SDES,
    ice: Type.Object({
      ufrag: Type.String(),
      pwd: Type.String(),
      candidates: CANDIDATES
    })
  }),
  audio: Type.Object({
    'payload-type': AUDIO_PAYLOAD_TYPE,
    ssrcs: Type.Array(Type.Integer()),
    'rtp-hdrexts': RTP_HDREXT
  }),
  video: Type.Object({
    'payload-types': Type.Array(
      Type.Object({
        id: Type.Integer(),
        parameters: PARAMS,
        'rtcp-fbs': Type.Array(
          Type.Object({
            type: Type.String(),
            subtype: Type.String()
          })
        ),
        name: Type.String(),
        clockrate: Type.Integer()
      })
    ),
    streams: VIDEO_STREAM,
    'rtp-hdrexts': RTP_HDREXT
  }),
  data: Type.Object({
    port: Type.Integer()
  })
});

//Configuration Models
export const ConfigureEndpoint = Type.Object({
  action: Type.String({ enum: ['configure'] }),
  bundle_transport: Type.Object({
    dtls: DTLS,
    sdes: SDES,
    ice: Type.Object({
      ufrag: Type.String(),
      pwd: Type.String(),
      candidates: CANDIDATES
    })
  }),
  audio: Type.Object({
    payload_type: AUDIO_PAYLOAD_TYPE,
    ssrcs: Type.Array(Type.Integer()),
    rtp_hdr_exts: RTP_HDR_EXTS
  }),
  video: Type.Object({
    payload_types: VIDEO_PAYLOAD_TYPES,
    streams: VIDEO_STREAMS,
    rtp_hdr_exts: RTP_HDR_EXTS
  }),
  data: Type.Object({
    port: Type.Integer()
  }),
  neighbours: Type.Object({
    groups: Type.Array(Type.String())
  })
});

//Reconfiguration Models
const RECONFIGURED_AUDIO = Type.Object({
  ssrcs: Type.Array(Type.Integer())
});

const RECONFIGURED_VIDEO = Type.Object({
  streams: RECONFIGURED_STREAMS
});

export const ReconfigureEndpoint = Type.Object({
  action: Type.Literal('reconfigure'),
  audio: RECONFIGURED_AUDIO,
  video: RECONFIGURED_VIDEO
});
