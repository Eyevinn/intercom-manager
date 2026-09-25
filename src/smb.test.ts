import { SmbEndpointActionError, SmbProtocol } from './smb';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Suppress log output in tests
jest.mock('./log', () => ({
  Log: () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  })
}));

function mockResponse(
  status: number,
  body: unknown,
  contentType = 'application/json'
): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': contentType }),
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : '')
  };
}

describe('SmbProtocol', () => {
  let smb: SmbProtocol;
  const smbUrl = 'http://localhost:8080/conferences/';
  const smbKey = 'test-api-key';

  beforeEach(() => {
    smb = new SmbProtocol();
    mockFetch.mockReset();
  });

  // ── allocateConference ─────────────────────────────────────────────

  describe('allocateConference', () => {
    it('should POST to smbUrl and return conference id', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { id: 'conf-123' }));

      const result = await smb.allocateConference(smbUrl, smbKey);

      expect(result).toBe('conf-123');
      expect(mockFetch).toHaveBeenCalledWith(smbUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-api-key'
        },
        body: '{}'
      });
    });

    it('should not include Authorization header when smbKey is empty', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { id: 'conf-456' }));

      await smb.allocateConference(smbUrl, '');

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers).not.toHaveProperty('Authorization');
    });

    it('should throw on non-OK response', async () => {
      mockFetch.mockResolvedValue(mockResponse(500, null));

      await expect(smb.allocateConference(smbUrl, smbKey)).rejects.toThrow(
        'Failed to allocate conference'
      );
    });
  });

  // ── allocateEndpoint ───────────────────────────────────────────────

  describe('allocateEndpoint', () => {
    const endpointResponse = {
      'bundle-transport': {
        ice: {
          ufrag: 'abc',
          pwd: 'xyz',
          candidates: []
        },
        dtls: {
          type: 'sha-256',
          hash: 'AA:BB:CC',
          setup: 'actpass'
        }
      },
      audio: {
        ssrcs: [],
        'payload-type': {
          id: 111,
          name: 'opus',
          clockrate: 48000,
          channels: 2,
          parameters: {}
        },
        'rtp-hdrexts': []
      }
    };

    it('should POST to smbUrl/conferenceId/endpointId', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, endpointResponse));

      const result = await smb.allocateEndpoint(
        smbUrl,
        'conf-1',
        'ep-1',
        true,
        false,
        true,
        true,
        'ssrc-rewrite',
        60,
        smbKey
      );

      expect(result).toEqual(endpointResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/conferences/conf-1/ep-1',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key'
          })
        })
      );
    });

    it('should include relay-type in audio when audio=true', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, endpointResponse));

      await smb.allocateEndpoint(
        smbUrl,
        'conf-1',
        'ep-1',
        true,
        false,
        false,
        true,
        'mixed',
        60,
        smbKey
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.audio).toEqual({ 'relay-type': 'mixed' });
    });

    it('should include data field when data=true', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, endpointResponse));

      await smb.allocateEndpoint(
        smbUrl,
        'conf-1',
        'ep-1',
        false,
        false,
        true,
        true,
        'ssrc-rewrite',
        60,
        smbKey
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data).toEqual({});
    });

    it('should include idleTimeout when provided', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, endpointResponse));

      await smb.allocateEndpoint(
        smbUrl,
        'conf-1',
        'ep-1',
        true,
        false,
        false,
        true,
        'ssrc-rewrite',
        120,
        smbKey
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.idleTimeout).toBe(120);
    });

    it('should throw on non-OK response', async () => {
      mockFetch.mockResolvedValue(mockResponse(500, null));

      await expect(
        smb.allocateEndpoint(
          smbUrl,
          'conf-1',
          'ep-1',
          true,
          false,
          true,
          true,
          'ssrc-rewrite',
          60,
          smbKey
        )
      ).rejects.toThrow('Failed to allocate endpoint');
    });
  });

  // ── allocateAudioEndpoint ──────────────────────────────────────────

  describe('allocateAudioEndpoint', () => {
    const audioEndpointResponse = {
      audio: {
        ssrcs: [],
        transport: {
          ice: { ufrag: 'abc', pwd: 'xyz', candidates: [] },
          dtls: { type: 'sha-256', hash: 'AA:BB', setup: 'actpass' }
        }
      }
    };

    it('should POST with audio transport allocation request', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, audioEndpointResponse));

      const result = await smb.allocateAudioEndpoint(
        smbUrl,
        'conf-1',
        'ep-1',
        'forwarder',
        60,
        smbKey
      );

      expect(result).toEqual(audioEndpointResponse);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.action).toBe('allocate');
      expect(body.audio['relay-type']).toBe('forwarder');
      expect(body.audio.transport.ice).toBe(true);
      expect(body.audio.transport.dtls).toBe(true);
    });

    it('should throw on non-OK response', async () => {
      mockFetch.mockResolvedValue(mockResponse(500, null));

      await expect(
        smb.allocateAudioEndpoint(
          smbUrl,
          'conf-1',
          'ep-1',
          'ssrc-rewrite',
          60,
          smbKey
        )
      ).rejects.toThrow('Failed to allocate endpoint');
    });
  });

  // ── configureEndpoint ──────────────────────────────────────────────

  describe('configureEndpoint', () => {
    const endpointDescription = {
      'bundle-transport': {
        ice: { ufrag: 'u', pwd: 'p', candidates: [] },
        dtls: { type: 'sha-256', hash: 'AA', setup: 'active' }
      },
      audio: { ssrcs: [{ ssrc: 12345 }] }
    };

    it('should PUT with action=configure', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, null));

      await smb.configureEndpoint(
        smbUrl,
        'conf-1',
        'ep-1',
        endpointDescription as any,
        smbKey
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/conferences/conf-1/ep-1',
        expect.objectContaining({ method: 'PUT' })
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.action).toBe('configure');
    });

    it('should not mutate the original endpointDescription', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, null));
      const original = JSON.parse(JSON.stringify(endpointDescription));

      await smb.configureEndpoint(
        smbUrl,
        'conf-1',
        'ep-1',
        endpointDescription as any,
        smbKey
      );

      expect(endpointDescription).toEqual(original);
    });

    it('should throw with text body on error (text/plain)', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(400, 'Bad configuration', 'text/plain')
      );

      await expect(
        smb.configureEndpoint(
          smbUrl,
          'conf-1',
          'ep-1',
          endpointDescription as any,
          smbKey
        )
      ).rejects.toThrow('Bad configuration');
    });

    it('should throw with JSON body on error (application/json)', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(400, { error: 'invalid ssrc' }, 'application/json')
      );

      await expect(
        smb.configureEndpoint(
          smbUrl,
          'conf-1',
          'ep-1',
          endpointDescription as any,
          smbKey
        )
      ).rejects.toThrow('Failed to configure endpoint');
    });

    // The route turns this specific rejection into a 425 so the client retries.
    // It matches on the typed error, so the client must actually produce one —
    // a plain Error here would silently turn the retry back into a 500.
    it('rejects with a typed error that flags a not-yet-configured endpoint', async () => {
      mockFetch.mockResolvedValue(
        // text() is what the client reads, so the body must be the raw JSON
        // string SMB actually sends.
        mockResponse(
          400,
          JSON.stringify({
            message:
              "Can't reconfigure audio because it was not configured in first place",
            status_code: 400
          }),
          'application/json'
        )
      );

      const err = await smb
        .reconfigureEndpoint(
          smbUrl,
          'conf-1',
          'ep-1',
          endpointDescription as any,
          smbKey
        )
        .catch((e) => e);

      expect(err).toBeInstanceOf(SmbEndpointActionError);
      expect(err.status).toBe(400);
      expect(err.action).toBe('reconfigure');
      expect(err.isEndpointNotConfiguredYet).toBe(true);
    });

    it('does not flag an unrelated 400 as not-yet-configured', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          400,
          JSON.stringify({ message: 'invalid ssrc' }),
          'application/json'
        )
      );

      const err = await smb
        .reconfigureEndpoint(
          smbUrl,
          'conf-1',
          'ep-1',
          endpointDescription as any,
          smbKey
        )
        .catch((e) => e);

      expect(err).toBeInstanceOf(SmbEndpointActionError);
      expect(err.isEndpointNotConfiguredYet).toBe(false);
    });
  });

  // ── requestKeyframe ────────────────────────────────────────────────

  describe('requestKeyframe', () => {
    const pinnedDescription = {
      audio: { ssrcs: [9000] },
      video: { ssrcs: [], 'ssrc-whitelist': [3333, 4444] }
    };

    it('performs a whitelist remove -> re-add reconfigure cycle', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, null));

      await smb.requestKeyframe(
        smbUrl,
        'conf-1',
        'ep-1',
        pinnedDescription as any,
        smbKey
      );

      // Two reconfigure PUTs: clear, then re-apply.
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const first = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(first.action).toBe('reconfigure');
      expect(first.video['ssrc-whitelist']).toBeUndefined();

      const second = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(second.action).toBe('reconfigure');
      expect(second.video['ssrc-whitelist']).toEqual([3333, 4444]);
    });

    it('does not mutate the original endpointDescription', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, null));
      const original = JSON.parse(JSON.stringify(pinnedDescription));

      await smb.requestKeyframe(
        smbUrl,
        'conf-1',
        'ep-1',
        pinnedDescription as any,
        smbKey
      );

      expect(pinnedDescription).toEqual(original);
    });

    it('is a no-op when there is no ssrc-whitelist', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, null));

      await smb.requestKeyframe(
        smbUrl,
        'conf-1',
        'ep-1',
        { audio: { ssrcs: [9000] }, video: { ssrcs: [] } } as any,
        smbKey
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('is a no-op when there is no video block', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, null));

      await smb.requestKeyframe(
        smbUrl,
        'conf-1',
        'ep-1',
        { audio: { ssrcs: [9000] } } as any,
        smbKey
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── getConferences ─────────────────────────────────────────────────

  describe('getConferences', () => {
    it('should return list of conference IDs', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, ['conf-1', 'conf-2']));

      const result = await smb.getConferences(smbUrl, smbKey);

      expect(result).toEqual(['conf-1', 'conf-2']);
      expect(mockFetch).toHaveBeenCalledWith(smbUrl, {
        method: 'GET',
        headers: { Authorization: 'Bearer test-api-key' }
      });
    });

    it('should return empty array on error', async () => {
      mockFetch.mockResolvedValue(mockResponse(500, null));

      const result = await smb.getConferences(smbUrl, smbKey);

      expect(result).toEqual([]);
    });
  });

  // ── getConferencesWithUsers ────────────────────────────────────────

  describe('getConferencesWithUsers', () => {
    it('should GET with ?brief query parameter', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(200, [{ id: 'conf-1', userCount: 3 }])
      );

      const result = await smb.getConferencesWithUsers(smbUrl, smbKey);

      expect(result).toEqual([{ id: 'conf-1', userCount: 3 }]);
      expect(mockFetch).toHaveBeenCalledWith(
        smbUrl + '?brief',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should return empty array on error', async () => {
      mockFetch.mockResolvedValue(mockResponse(500, null));

      const result = await smb.getConferencesWithUsers(smbUrl, smbKey);

      expect(result).toEqual([]);
    });

    it('should include abort signal with timeout', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, []));

      await smb.getConferencesWithUsers(smbUrl, smbKey);

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ── getConference ──────────────────────────────────────────────────

  describe('getConference', () => {
    it('should GET a specific conference by ID', async () => {
      const detail = [{ id: 'conf-1', endpoints: [] }];
      mockFetch.mockResolvedValue(mockResponse(200, detail));

      const result = await smb.getConference(smbUrl, 'conf-1', smbKey);

      expect(result).toEqual(detail);
      expect(mockFetch).toHaveBeenCalledWith(smbUrl + 'conf-1', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-api-key' }
      });
    });

    it('should return empty array on error', async () => {
      mockFetch.mockResolvedValue(mockResponse(404, null));

      const result = await smb.getConference(smbUrl, 'conf-1', smbKey);

      expect(result).toEqual([]);
    });
  });
});
