jest.mock('./log', () => ({
  Log: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));

import { MockSmbProtocol } from './mock-smb-protocol';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { Production } from './models';

// Mock ProductionManager with minimal functionality needed by CoreFunctions
const mockProduction: Production = {
  _id: 1,
  name: 'integration-test-prod',
  lines: [
    { name: 'Line A', id: 'line-a', smbConferenceId: '' },
    { name: 'Line B', id: 'line-b', smbConferenceId: 'existing-conf' }
  ]
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const userSessions: Record<string, any> = {};

const mockProductionManager = {
  requireProduction: jest.fn().mockImplementation(async (id: number) => {
    if (id === mockProduction._id) return mockProduction;
    throw new Error(`Production ${id} not found`);
  }),
  requireLine: jest.fn().mockImplementation((lines: any[], lineId: string) => {
    const line = lines.find((l: any) => l.id === lineId);
    if (!line) throw new Error(`Line ${lineId} not found`);
    return line;
  }),
  getLine: jest
    .fn()
    .mockImplementation((lines: any[], lineId: string) =>
      lines.find((l: any) => l.id === lineId)
    ),
  getProduction: jest.fn().mockImplementation(async (id: number) => {
    if (id === mockProduction._id) return mockProduction;
    return undefined;
  }),
  setLineId: jest
    .fn()
    .mockImplementation(
      async (_prodId: number, lineId: string, smbId: string) => {
        const line = mockProduction.lines.find((l) => l.id === lineId);
        if (line) {
          line.smbConferenceId = smbId;
          return line;
        }
        return undefined;
      }
    ),
  createUserSession: jest
    .fn()
    .mockImplementation(
      async (
        smbConferenceId: string,
        productionId: string,
        lineId: string,
        sessionId: string,
        name: string,
        _isWhip: boolean
      ) => {
        userSessions[sessionId] = {
          _id: sessionId,
          name,
          smbConferenceId,
          productionId,
          lineId,
          lastSeen: Date.now(),
          isActive: true,
          isExpired: false,
          isWhip: _isWhip,
          endpointId: undefined,
          sessionDescription: undefined
        };
      }
    ),
  updateUserEndpoint: jest
    .fn()
    .mockImplementation(
      async (sessionId: string, endpointId: string, endpoint: any) => {
        if (userSessions[sessionId]) {
          userSessions[sessionId].endpointId = endpointId;
          userSessions[sessionId].sessionDescription = endpoint;
        }
      }
    ),
  getUsersForLine: jest.fn().mockReturnValue([]),
  userSessions
} as any;

describe('MockSmbProtocol Integration with CoreFunctions', () => {
  let mockSmb: MockSmbProtocol;
  let coreFunctions: CoreFunctions;
  const smbUrl = 'http://mock-smb-server/conferences/';
  const smbKey = 'mock-api-key';

  beforeEach(() => {
    mockSmb = new MockSmbProtocol();
    const connectionQueue = new ConnectionQueue();
    coreFunctions = new CoreFunctions(mockProductionManager, connectionQueue);

    // Reset production line conference IDs
    mockProduction.lines[0].smbConferenceId = '';
    mockProduction.lines[1].smbConferenceId = 'existing-conf';

    // Clear user sessions
    Object.keys(userSessions).forEach((k) => delete userSessions[k]);

    jest.clearAllMocks();
  });

  describe('createConferenceForLine', () => {
    test('allocates new conference for line with empty smbConferenceId', async () => {
      const conferenceId = await coreFunctions.createConferenceForLine(
        mockSmb,
        smbUrl,
        smbKey,
        '1',
        'line-a'
      );

      expect(conferenceId).toMatch(/^mock-conf-/);
      expect(mockSmb.hasConference(conferenceId)).toBe(true);
      expect(mockProductionManager.setLineId).toHaveBeenCalledWith(
        1,
        'line-a',
        conferenceId
      );
    });

    test('reuses existing conference when already active in SMB', async () => {
      // Pre-allocate a conference to simulate existing active conference
      const existingId = await mockSmb.allocateConference(smbUrl, smbKey);
      mockProduction.lines[1].smbConferenceId = existingId;

      const conferenceId = await coreFunctions.createConferenceForLine(
        mockSmb,
        smbUrl,
        smbKey,
        '1',
        'line-b'
      );

      expect(conferenceId).toBe(existingId);
      // setLineId should NOT be called when reusing
      expect(mockProductionManager.setLineId).not.toHaveBeenCalled();
    });

    test('allocates new conference when line conference not in active list', async () => {
      // Line B has smbConferenceId 'existing-conf' but that conference
      // doesn't exist in the mock SMB server
      const conferenceId = await coreFunctions.createConferenceForLine(
        mockSmb,
        smbUrl,
        smbKey,
        '1',
        'line-b'
      );

      expect(conferenceId).toMatch(/^mock-conf-/);
      expect(conferenceId).not.toBe('existing-conf');
      expect(mockProductionManager.setLineId).toHaveBeenCalledWith(
        1,
        'line-b',
        conferenceId
      );
    });
  });

  describe('createEndpoint', () => {
    test('allocates endpoint with audio in mock SMB', async () => {
      const conferenceId = await mockSmb.allocateConference(smbUrl, smbKey);

      const endpoint = await coreFunctions.createEndpoint(
        mockSmb,
        smbUrl,
        smbKey,
        conferenceId,
        'ep-001',
        true, // audio
        false, // data
        true, // iceControlling
        'ssrc-rewrite',
        60
      );

      expect(endpoint).toBeDefined();
      expect(endpoint['bundle-transport']).toBeDefined();
      expect(endpoint['bundle-transport']?.ice?.ufrag).toContain('ufrag-');
      expect(endpoint.audio.ssrcs.length).toBeGreaterThan(0);
      expect(endpoint.audio['payload-type'].name).toBe('opus');

      // Endpoint is stored in mock
      const stored = mockSmb.getEndpoint(conferenceId, 'ep-001');
      expect(stored).toEqual(endpoint);
    });

    test('allocates endpoint without audio SSRCs when audio=false', async () => {
      const conferenceId = await mockSmb.allocateConference(smbUrl, smbKey);

      const endpoint = await coreFunctions.createEndpoint(
        mockSmb,
        smbUrl,
        smbKey,
        conferenceId,
        'ep-002',
        false, // audio
        true, // data
        false,
        'forwarder',
        30
      );

      expect(endpoint.audio.ssrcs).toEqual([]);
      expect(endpoint.data).toEqual({ port: 5000 });
    });

    test('throws when conference does not exist', async () => {
      await expect(
        coreFunctions.createEndpoint(
          mockSmb,
          smbUrl,
          smbKey,
          'nonexistent-conf',
          'ep-003',
          true,
          false,
          true,
          'ssrc-rewrite',
          60
        )
      ).rejects.toThrow('not found');
    });
  });

  describe('Full session lifecycle', () => {
    test('conference allocation → endpoint creation → createConnection', async () => {
      // Step 1: Create conference for line
      const conferenceId = await coreFunctions.createConferenceForLine(
        mockSmb,
        smbUrl,
        smbKey,
        '1',
        'line-a'
      );
      expect(conferenceId).toMatch(/^mock-conf-/);

      // Step 2: Create endpoint
      const endpointId = 'test-ep-001';
      const endpoint = await coreFunctions.createEndpoint(
        mockSmb,
        smbUrl,
        smbKey,
        conferenceId,
        endpointId,
        true,
        true,
        true,
        'ssrc-rewrite',
        60
      );
      expect(endpoint.audio.ssrcs.length).toBeGreaterThan(0);
      expect(endpoint['bundle-transport']?.dtls?.hash).toBeTruthy();

      // Step 3: Create connection (generates SDP offer)
      const sdpOffer = await coreFunctions.createConnection(
        conferenceId,
        '1',
        'line-a',
        endpoint,
        'test-user',
        endpointId,
        'session-001'
      );
      expect(sdpOffer).toBeDefined();
      expect(typeof sdpOffer).toBe('string');
      expect(sdpOffer).toContain('v=0');
      expect(sdpOffer).toContain('m=audio');

      // Verify user session was created
      expect(mockProductionManager.createUserSession).toHaveBeenCalledWith(
        conferenceId,
        '1',
        'line-a',
        'session-001',
        'test-user',
        false
      );

      // Verify endpoint was updated
      expect(mockProductionManager.updateUserEndpoint).toHaveBeenCalledWith(
        'session-001',
        endpointId,
        endpoint
      );
    });

    test('multiple endpoints in same conference', async () => {
      const conferenceId = await mockSmb.allocateConference(smbUrl, smbKey);

      const ep1 = await coreFunctions.createEndpoint(
        mockSmb,
        smbUrl,
        smbKey,
        conferenceId,
        'ep-a',
        true,
        false,
        true,
        'ssrc-rewrite',
        60
      );

      const ep2 = await coreFunctions.createEndpoint(
        mockSmb,
        smbUrl,
        smbKey,
        conferenceId,
        'ep-b',
        true,
        false,
        true,
        'ssrc-rewrite',
        60
      );

      // Both endpoints exist in the conference
      expect(mockSmb.getEndpoint(conferenceId, 'ep-a')).toEqual(ep1);
      expect(mockSmb.getEndpoint(conferenceId, 'ep-b')).toEqual(ep2);

      const endpoints = mockSmb.getConferenceEndpoints(conferenceId);
      expect(endpoints?.size).toBe(2);
    });
  });

  describe('MockSmbProtocol helper methods', () => {
    test('reset clears all state', async () => {
      await mockSmb.allocateConference(smbUrl, smbKey);
      await mockSmb.allocateConference(smbUrl, smbKey);

      const before = await mockSmb.getConferences(smbUrl, smbKey);
      expect(before.length).toBe(2);

      mockSmb.reset();

      const after = await mockSmb.getConferences(smbUrl, smbKey);
      expect(after.length).toBe(0);
    });

    test('getConferencesWithUsers returns correct user counts', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      await mockSmb.allocateEndpoint(
        smbUrl,
        confId,
        'ep-1',
        true,
        false,
        true,
        'ssrc-rewrite',
        60,
        smbKey
      );
      await mockSmb.allocateEndpoint(
        smbUrl,
        confId,
        'ep-2',
        true,
        false,
        true,
        'ssrc-rewrite',
        60,
        smbKey
      );

      const conferences = await mockSmb.getConferencesWithUsers(smbUrl, smbKey);
      expect(conferences.length).toBe(1);
      expect(conferences[0].userCount).toBe(2);
      expect(conferences[0].users).toContain('ep-1');
      expect(conferences[0].users).toContain('ep-2');
    });

    test('getConference returns detailed endpoint info', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      await mockSmb.allocateEndpoint(
        smbUrl,
        confId,
        'ep-1',
        true,
        false,
        true,
        'ssrc-rewrite',
        60,
        smbKey
      );

      const details = await mockSmb.getConference(smbUrl, confId, smbKey);
      expect(details.length).toBe(1);
      expect(details[0].id).toBe('ep-1');
      expect(details[0].dtlsState).toBe('connected');
      expect(details[0].iceState).toBe('connected');
    });

    test('configureEndpoint updates stored endpoint', async () => {
      const confId = await mockSmb.allocateConference(smbUrl, smbKey);
      const original = await mockSmb.allocateEndpoint(
        smbUrl,
        confId,
        'ep-1',
        true,
        false,
        true,
        'ssrc-rewrite',
        60,
        smbKey
      );

      const modified = JSON.parse(JSON.stringify(original));
      modified.audio.ssrcs = [99999];

      await mockSmb.configureEndpoint(smbUrl, confId, 'ep-1', modified, smbKey);

      const updated = mockSmb.getEndpoint(confId, 'ep-1');
      expect(updated?.audio.ssrcs).toEqual([99999]);
    });
  });
});
