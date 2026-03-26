jest.mock('./log', () => ({
  Log: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));

import api from './api';
import { Preset } from './models';

const mockPreset: Preset = {
  _id: 'preset-uuid-1',
  name: 'My Preset',
  calls: [
    { productionId: '1', lineId: 'line-1' },
    { productionId: '2', lineId: 'line-2' }
  ],
  createdAt: '2026-03-23T00:00:00.000Z'
};

const mockDbManager = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  getProduction: jest.fn().mockResolvedValue(undefined),
  getProductions: jest.fn().mockResolvedValue([]),
  getProductionsLength: jest.fn().mockResolvedValue(0),
  updateProduction: jest.fn().mockResolvedValue(undefined),
  addProduction: jest.fn().mockResolvedValue({}),
  deleteProduction: jest.fn().mockResolvedValue(true),
  setLineConferenceId: jest.fn().mockResolvedValue(undefined),
  addIngest: jest.fn().mockResolvedValue({}),
  getIngest: jest.fn().mockResolvedValue(undefined),
  getIngestsLength: jest.fn().mockResolvedValue(0),
  getIngests: jest.fn().mockResolvedValue([]),
  updateIngest: jest.fn().mockResolvedValue(undefined),
  deleteIngest: jest.fn().mockResolvedValue(true),
  saveUserSession: jest.fn().mockResolvedValue(undefined),
  getSession: jest.fn().mockResolvedValue(null),
  deleteUserSession: jest.fn().mockResolvedValue(true),
  updateSession: jest.fn().mockResolvedValue(true),
  getSessionsByQuery: jest.fn().mockResolvedValue([]),
  addPreset: jest.fn().mockResolvedValue(mockPreset),
  getPreset: jest.fn().mockResolvedValue(mockPreset),
  getPresets: jest.fn().mockResolvedValue([]),
  deletePreset: jest.fn().mockResolvedValue(true),
  updatePreset: jest.fn().mockResolvedValue(mockPreset)
};

const mockIngestManager = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn()
} as any;

const mockCoreFunctions = {
  getAllLinesResponse: jest.fn().mockResolvedValue([]),
  createConferenceForLine: jest.fn().mockResolvedValue('mock-conference-id'),
  createEndpoint: jest.fn().mockResolvedValue({
    audio: { ssrcs: [12345], 'payload-type': {}, 'rtp-hdrexts': [] }
  }),
  createConnection: jest.fn().mockResolvedValue('sdp-offer-mock')
} as any;

describe('Presets API', () => {
  let server: any;
  let setIntervalSpy: jest.SpyInstance<any, any>;

  beforeAll(() => {
    setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(jest.fn());
  });

  beforeAll(async () => {
    server = await api({
      title: 'presets test service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com',
      dbManager: mockDbManager,
      productionManager: {} as any,
      ingestManager: mockIngestManager,
      coreFunctions: mockCoreFunctions
    });
  });

  afterAll(async () => {
    await server.close();
    setIntervalSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbManager.getPresets.mockResolvedValue([]);
    mockDbManager.getPreset.mockResolvedValue(mockPreset);
    mockDbManager.addPreset.mockResolvedValue(mockPreset);
    mockDbManager.deletePreset.mockResolvedValue(true);
    mockDbManager.updatePreset.mockResolvedValue(mockPreset);
  });

  describe('GET /api/v1/preset', () => {
    test('returns empty presets list when no presets exist', async () => {
      mockDbManager.getPresets.mockResolvedValue([]);
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/preset'
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ presets: [] });
    });

    test('returns presets when they exist', async () => {
      mockDbManager.getPresets.mockResolvedValue([mockPreset]);
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/preset'
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ presets: [mockPreset] });
    });
  });

  describe('POST /api/v1/preset', () => {
    test('returns 201 with created preset on valid body', async () => {
      const body = {
        name: 'My Preset',
        calls: [
          { productionId: '1', lineId: 'line-1' },
          { productionId: '2', lineId: 'line-2' }
        ]
      };
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/preset',
        body
      });
      expect(response.statusCode).toBe(201);
      const json = JSON.parse(response.body);
      expect(json._id).toBe(mockPreset._id);
      expect(json.name).toBe(mockPreset.name);
      expect(json.calls).toEqual(mockPreset.calls);
      expect(mockDbManager.addPreset).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Preset', calls: body.calls })
      );
    });

    test('returns 201 and passes companionUrl to addPreset when provided', async () => {
      const presetWithCompanion = {
        ...mockPreset,
        companionUrl: 'ws://companion.example.com:8080'
      };
      mockDbManager.addPreset.mockResolvedValue(presetWithCompanion);
      const body = {
        name: 'My Preset',
        calls: [{ productionId: '1', lineId: 'line-1' }],
        companionUrl: 'ws://companion.example.com:8080'
      };
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/preset',
        body
      });
      expect(response.statusCode).toBe(201);
      const json = JSON.parse(response.body);
      expect(json.companionUrl).toBe('ws://companion.example.com:8080');
      expect(mockDbManager.addPreset).toHaveBeenCalledWith(
        expect.objectContaining({
          companionUrl: 'ws://companion.example.com:8080'
        })
      );
    });

    test('returns 400 when name is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/preset',
        body: {
          calls: [{ productionId: '1', lineId: 'line-1' }]
        }
      });
      expect(response.statusCode).toBe(400);
    });

    test('returns 400 when calls array is empty', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/preset',
        body: {
          name: 'My Preset',
          calls: []
        }
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/v1/preset/:id', () => {
    test('returns 200 with updated calls when only calls are provided', async () => {
      const newCalls = [{ productionId: '3', lineId: 'line-3' }];
      const updatedPreset = { ...mockPreset, calls: newCalls };
      mockDbManager.updatePreset.mockResolvedValue(updatedPreset);
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/preset/preset-uuid-1',
        body: { calls: newCalls }
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(updatedPreset);
      expect(mockDbManager.updatePreset).toHaveBeenCalledWith('preset-uuid-1', {
        calls: newCalls
      });
    });

    test('returns 200 with updated name when only name is provided', async () => {
      const updatedPreset = { ...mockPreset, name: 'Renamed Preset' };
      mockDbManager.updatePreset.mockResolvedValue(updatedPreset);
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/preset/preset-uuid-1',
        body: { name: 'Renamed Preset' }
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(updatedPreset);
      expect(mockDbManager.updatePreset).toHaveBeenCalledWith('preset-uuid-1', {
        name: 'Renamed Preset'
      });
    });

    test('returns 200 when both name and calls are provided', async () => {
      const newCalls = [{ productionId: '5', lineId: 'line-5' }];
      const updatedPreset = {
        ...mockPreset,
        name: 'Renamed And Updated',
        calls: newCalls
      };
      mockDbManager.updatePreset.mockResolvedValue(updatedPreset);
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/preset/preset-uuid-1',
        body: { name: 'Renamed And Updated', calls: newCalls }
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(updatedPreset);
      expect(mockDbManager.updatePreset).toHaveBeenCalledWith('preset-uuid-1', {
        name: 'Renamed And Updated',
        calls: newCalls
      });
    });

    test('returns 400 when name is an empty string', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/preset/preset-uuid-1',
        body: { name: '' }
      });
      expect(response.statusCode).toBe(400);
    });

    test('returns 200 with updated companionUrl when provided', async () => {
      const updatedPreset = {
        ...mockPreset,
        companionUrl: 'ws://companion.example.com:8080'
      };
      mockDbManager.updatePreset.mockResolvedValue(updatedPreset);
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/preset/preset-uuid-1',
        body: { companionUrl: 'ws://companion.example.com:8080' }
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(updatedPreset);
      expect(mockDbManager.updatePreset).toHaveBeenCalledWith('preset-uuid-1', {
        companionUrl: 'ws://companion.example.com:8080'
      });
    });

    test('returns 200 and passes null companionUrl to remove it', async () => {
      const updatedPreset = { ...mockPreset };
      delete (updatedPreset as any).companionUrl;
      mockDbManager.updatePreset.mockResolvedValue(updatedPreset);
      // Sending null — AJV coerces it to "" for string|null unions; the handler
      // normalises "" back to null before calling updatePreset.
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/preset/preset-uuid-1',
        body: { companionUrl: null }
      });
      expect(response.statusCode).toBe(200);
      expect(mockDbManager.updatePreset).toHaveBeenCalledWith('preset-uuid-1', {
        companionUrl: null
      });
    });

    test('returns 404 when preset not found', async () => {
      mockDbManager.updatePreset.mockResolvedValue(undefined);
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/preset/nonexistent-id',
        body: { calls: [] }
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Preset not found'
      });
    });
  });

  describe('DELETE /api/v1/preset/:id', () => {
    test('returns 204 on successful delete', async () => {
      mockDbManager.deletePreset.mockResolvedValue(true);
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/preset/preset-uuid-1'
      });
      expect(response.statusCode).toBe(204);
      expect(mockDbManager.deletePreset).toHaveBeenCalledWith('preset-uuid-1');
    });

    test('returns 404 when preset not found', async () => {
      mockDbManager.deletePreset.mockResolvedValue(false);
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/preset/nonexistent-id'
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Preset not found'
      });
    });
  });
});
