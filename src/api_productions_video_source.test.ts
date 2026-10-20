// Tests for PATCH /session/:sessionId/video-source:
// a source swap must force a fresh keyframe for the newly pinned ssrc so the
// receiver's decoder recovers immediately instead of freezing on the previous
// publisher's last frame.

jest.mock('./log', () => ({
  Log: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));

// Capture every SMB call so we can assert ordering and the forced keyframe.
type SmbCall = {
  kind: 'reconfigure' | 'requestKeyframe';
  endpointId: string;
  ssrcWhitelist: number[] | undefined;
};
const smbCalls: SmbCall[] = [];

// When set, the mocked reconfigureEndpoint rejects with it instead of
// succeeding. Lets a test drive the SMB-rejection paths.
let mockReconfigureError: Error | null = null;

// requireActual keeps the real SmbEndpointActionError — the route checks the
// rejection with `instanceof`, so a factory returning only SmbProtocol would
// leave that check comparing against undefined.
jest.mock('./smb', () => ({
  ...jest.requireActual('./smb'),
  SmbProtocol: jest.fn().mockImplementation(() => ({
    reconfigureEndpoint: jest
      .fn()
      .mockImplementation(
        async (_url: string, _conf: string, endpointId: string, desc: any) => {
          if (mockReconfigureError) {
            throw mockReconfigureError;
          }
          smbCalls.push({
            kind: 'reconfigure',
            endpointId,
            ssrcWhitelist: desc?.video?.['ssrc-whitelist']
          });
        }
      ),
    requestKeyframe: jest
      .fn()
      .mockImplementation(
        async (_url: string, _conf: string, endpointId: string, desc: any) => {
          smbCalls.push({
            kind: 'requestKeyframe',
            endpointId,
            ssrcWhitelist: desc?.video?.['ssrc-whitelist']
          });
        }
      )
  }))
}));

import api from './api';
import { SmbEndpointActionError } from './smb';

const RECEIVER_ENDPOINT = 'receiver-ep-1';
const SOURCE_A_SSRCS = [1111, 2222];
const SOURCE_B_SSRCS = [3333, 4444];

function makeReceiverSession() {
  return {
    _id: 'receiver-1',
    name: 'receiver',
    productionId: '1',
    lineId: '1',
    isActive: true,
    isExpired: false,
    isWhip: false,
    hasVideo: false,
    endpointId: RECEIVER_ENDPOINT,
    pinnedVideoSessionId: undefined as string | undefined,
    sessionDescription: {
      audio: { ssrcs: [9000], 'payload-type': {}, 'rtp-hdrexts': [] },
      video: { ssrcs: [], 'payload-type': {}, 'rtp-hdrexts': [] }
    }
  };
}

function makeSourceSession(id: string, ssrcs: number[]) {
  return {
    _id: id,
    name: id,
    productionId: '1',
    lineId: '1',
    isActive: true,
    isExpired: false,
    isWhip: true,
    hasVideo: true,
    endpointId: `${id}-ep`,
    sessionDescription: {
      audio: { ssrcs: [8000], 'payload-type': {}, 'rtp-hdrexts': [] },
      video: { ssrcs, 'payload-type': {}, 'rtp-hdrexts': [] }
    }
  };
}

let receiverSession: ReturnType<typeof makeReceiverSession>;
const sessions: Record<string, any> = {};

const mockDbManager: any = {
  connect: jest.fn().mockResolvedValue(undefined),
  getSession: jest
    .fn()
    .mockImplementation(async (id: string) => sessions[id] ?? null),
  deleteUserSession: jest.fn().mockResolvedValue(true)
};

const mockProductionManager: any = {
  checkUserStatus: jest.fn().mockResolvedValue(undefined),
  requireProduction: jest
    .fn()
    .mockResolvedValue({ _id: 1, name: 'prod-1', lines: [{ id: '1' }] }),
  requireLine: jest
    .fn()
    .mockReturnValue({ id: '1', smbConferenceId: 'smb-conf-1' }),
  updateSessionVideoPin: jest
    .fn()
    .mockImplementation(
      async (sessionId: string, _desc: any, pinned: string | null) => {
        if (sessions[sessionId]) {
          sessions[sessionId].pinnedVideoSessionId = pinned ?? undefined;
        }
      }
    ),
  // Leave-reconcile dependencies (DELETE /session/:sessionId).
  clearWhepSourceIfPinned: jest.fn().mockResolvedValue(undefined),
  getReceiversPinnedToSession: jest
    .fn()
    .mockImplementation(async (leaverId: string) =>
      Object.values(sessions).filter(
        (s: any) => s._id !== leaverId && s.pinnedVideoSessionId === leaverId
      )
    ),
  getProduction: jest.fn().mockResolvedValue({
    _id: 1,
    name: 'prod-1',
    lines: [{ id: '1', smbConferenceId: 'smb-conf-1' }]
  }),
  removeUserSession: jest.fn(),
  emit: jest.fn()
};

const mockIngestManager: any = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn()
};

const mockCoreFunctions: any = {
  getAllLinesResponse: jest.fn().mockReturnValue([])
};

describe('PATCH /session/:sessionId/video-source — forced keyframe', () => {
  let server: any;
  let setIntervalSpy: jest.SpyInstance<any, any>;

  beforeAll(async () => {
    setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(jest.fn() as any);
    server = await api({
      title: 'video-source test',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager,
      coreFunctions: mockCoreFunctions
    });
  });

  afterAll(async () => {
    await server.close();
    setIntervalSpy.mockRestore();
  });

  beforeEach(() => {
    smbCalls.length = 0;
    mockReconfigureError = null;
    receiverSession = makeReceiverSession();
    for (const key of Object.keys(sessions)) delete sessions[key];
    sessions['receiver-1'] = receiverSession;
    sessions['source-a'] = makeSourceSession('source-a', SOURCE_A_SSRCS);
    sessions['source-b'] = makeSourceSession('source-b', SOURCE_B_SSRCS);
  });

  async function pin(pinnedSessionId: string | null) {
    return server.inject({
      method: 'PATCH',
      url: '/api/v1/session/receiver-1/video-source',
      body: { pinnedSessionId }
    });
  }

  test('forces a keyframe for the new ssrc on initial pin', async () => {
    const res = await pin('source-a');
    expect(res.statusCode).toBe(200);

    const keyframeCalls = smbCalls.filter((c) => c.kind === 'requestKeyframe');
    expect(keyframeCalls).toHaveLength(1);
    expect(keyframeCalls[0].endpointId).toBe(RECEIVER_ENDPOINT);
    expect(keyframeCalls[0].ssrcWhitelist).toEqual(SOURCE_A_SSRCS);
  });

  // An endpoint is allocated before it is configured, and a client that pins a
  // publisher the moment it appears can land in between. SMB rejects the
  // reconfigure with a 400; answering 500 would read as a real failure and the
  // client would not retry, leaving the pin silently abandoned.
  test('returns 425 when the session endpoint is not configured on SMB yet', async () => {
    mockReconfigureError = new SmbEndpointActionError(
      'reconfigure',
      400,
      JSON.stringify({
        message:
          "Can't reconfigure audio because it was not configured in first place",
        status_code: 400
      })
    );

    // This suite does not reset mock call history between tests, so compare
    // against the count taken just before the request rather than an absolute.
    const pinWrites = () =>
      (mockProductionManager.updateSessionVideoPin as jest.Mock).mock.calls
        .length;
    const pinWritesBefore = pinWrites();

    const res = await pin('source-a');

    expect(res.statusCode).toBe(425);
    expect(JSON.parse(res.body).message).toMatch(/retry shortly/i);
    // Nothing must be persisted or forced when the pin did not take effect.
    expect(smbCalls.filter((c) => c.kind === 'requestKeyframe')).toHaveLength(
      0
    );
    expect(pinWrites()).toBe(pinWritesBefore);
  });

  test('still fails loudly for an unrelated SMB rejection', async () => {
    mockReconfigureError = new SmbEndpointActionError(
      'reconfigure',
      400,
      JSON.stringify({ message: 'Some other bad request', status_code: 400 })
    );

    const res = await pin('source-a');

    expect(res.statusCode).toBe(500);
  });

  test('forces a keyframe for the NEW source when the pin is swapped', async () => {
    // Receiver already pinned to source-a (e.g. Maj), now swaps to source-b
    // (e.g. Elsa auto-pinned after Maj leaves).
    receiverSession.pinnedVideoSessionId = 'source-a';

    const res = await pin('source-b');
    expect(res.statusCode).toBe(200);

    const keyframeCalls = smbCalls.filter((c) => c.kind === 'requestKeyframe');
    expect(keyframeCalls).toHaveLength(1);
    expect(keyframeCalls[0].ssrcWhitelist).toEqual(SOURCE_B_SSRCS);

    // The keyframe must be requested AFTER the whitelist reconfigure lands.
    const reconfigureIdx = smbCalls.findIndex((c) => c.kind === 'reconfigure');
    const keyframeIdx = smbCalls.findIndex((c) => c.kind === 'requestKeyframe');
    expect(reconfigureIdx).toBeGreaterThanOrEqual(0);
    expect(keyframeIdx).toBeGreaterThan(reconfigureIdx);
  });

  test('does NOT force a keyframe for a no-op re-pin to the same source', async () => {
    receiverSession.pinnedVideoSessionId = 'source-a';

    const res = await pin('source-a');
    expect(res.statusCode).toBe(200);

    expect(smbCalls.filter((c) => c.kind === 'requestKeyframe')).toHaveLength(
      0
    );
  });

  test('does NOT force a keyframe when clearing the pin', async () => {
    receiverSession.pinnedVideoSessionId = 'source-a';

    const res = await pin(null);
    expect(res.statusCode).toBe(200);

    expect(smbCalls.filter((c) => c.kind === 'requestKeyframe')).toHaveLength(
      0
    );
  });
});

describe('DELETE /session/:sessionId — reconcile dangling video pins (leave fix)', () => {
  let server: any;
  let setIntervalSpy: jest.SpyInstance<any, any>;

  beforeAll(async () => {
    setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(jest.fn() as any);
    server = await api({
      title: 'video-source leave test',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager,
      coreFunctions: mockCoreFunctions
    });
  });

  afterAll(async () => {
    await server.close();
    setIntervalSpy.mockRestore();
  });

  beforeEach(() => {
    smbCalls.length = 0;
    mockReconfigureError = null;
    receiverSession = makeReceiverSession();
    for (const key of Object.keys(sessions)) delete sessions[key];
    sessions['receiver-1'] = receiverSession;
    sessions['source-a'] = makeSourceSession('source-a', SOURCE_A_SSRCS);
    sessions['source-b'] = makeSourceSession('source-b', SOURCE_B_SSRCS);
  });

  async function leave(sessionId: string) {
    return server.inject({
      method: 'DELETE',
      url: `/api/v1/session/${sessionId}`
    });
  }

  test('clears a receiver whitelist when the pinned source leaves', async () => {
    // receiver-1 is pinned to source-a, and its endpoint description still
    // carries source-a's SSRCs as the ssrc-whitelist (set by an earlier pin).
    receiverSession.pinnedVideoSessionId = 'source-a';
    (receiverSession.sessionDescription.video as any)['ssrc-whitelist'] =
      SOURCE_A_SSRCS;

    const res = await leave('source-a');
    expect(res.statusCode).toBe(200);

    // The receiver must be reconfigured with the whitelist REMOVED (key
    // deleted -> last-N fallback), never an empty-but-enabled whitelist.
    const reconfigures = smbCalls.filter((c) => c.kind === 'reconfigure');
    expect(reconfigures).toHaveLength(1);
    expect(reconfigures[0].endpointId).toBe(RECEIVER_ENDPOINT);
    expect(reconfigures[0].ssrcWhitelist).toBeUndefined();

    // The stored pin is cleared so the client's auto-pin effect re-pins fresh.
    expect(receiverSession.pinnedVideoSessionId).toBeUndefined();
  });

  test('does NOT touch receivers that pinned someone else', async () => {
    // receiver-1 is pinned to source-b; source-a (which nobody pinned) leaves.
    receiverSession.pinnedVideoSessionId = 'source-b';
    (receiverSession.sessionDescription.video as any)['ssrc-whitelist'] =
      SOURCE_B_SSRCS;

    const res = await leave('source-a');
    expect(res.statusCode).toBe(200);

    expect(smbCalls.filter((c) => c.kind === 'reconfigure')).toHaveLength(0);
    expect(receiverSession.pinnedVideoSessionId).toBe('source-b');
  });
});
