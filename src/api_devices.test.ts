jest.mock('./log', () => ({
  Log: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));

import api from './api';
import { Ingest } from './models';

const ingestOne: Ingest = {
  _id: 1,
  label: 'Stage Left',
  ipAddress: '127.0.0.1',
  deviceInput: [
    { name: 'in-1', label: 'Mic 1' },
    { name: 'in-2', label: 'Mic 2' }
  ],
  deviceOutput: [{ name: 'out-1', label: 'Speaker 1' }]
};

const ingestTwo: Ingest = {
  _id: 2,
  label: 'Stage Right',
  ipAddress: '127.0.0.2',
  deviceInput: [],
  deviceOutput: [{ name: 'out-9', label: 'Speaker 9' }]
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
  addPreset: jest.fn().mockResolvedValue({}),
  getPreset: jest.fn().mockResolvedValue(undefined),
  getPresets: jest.fn().mockResolvedValue([]),
  deletePreset: jest.fn().mockResolvedValue(true),
  updatePreset: jest.fn().mockResolvedValue(undefined),
  addShareLink: jest.fn().mockResolvedValue({}),
  getShareLink: jest.fn().mockResolvedValue(undefined),
  deleteShareLink: jest.fn().mockResolvedValue(true)
};

const mockIngestManager = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn(),
  getNumberOfIngests: jest.fn().mockResolvedValue(0),
  getIngests: jest.fn().mockResolvedValue([])
} as any;

const mockCoreFunctions = {
  getAllLinesResponse: jest.fn().mockResolvedValue([]),
  createConferenceForLine: jest.fn().mockResolvedValue('mock-conference-id'),
  createEndpoint: jest.fn().mockResolvedValue({
    audio: { ssrcs: [12345], 'payload-type': {}, 'rtp-hdrexts': [] }
  }),
  createConnection: jest.fn().mockResolvedValue('sdp-offer-mock')
} as any;

describe('Devices API', () => {
  let server: any;
  let setIntervalSpy: jest.SpyInstance<any, any>;

  beforeAll(() => {
    setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(jest.fn());
  });

  beforeAll(async () => {
    server = await api({
      title: 'devices test service',
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
    mockIngestManager.getNumberOfIngests.mockResolvedValue(0);
    mockIngestManager.getIngests.mockResolvedValue([]);
  });

  describe('GET /api/v1/devices', () => {
    test('returns an empty list when there are no ingests', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/devices'
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ devices: [] });
      // No ingests, so the ingest list is never fetched.
      expect(mockIngestManager.getIngests).not.toHaveBeenCalled();
    });

    test('aggregates inputs and outputs across all ingests', async () => {
      mockIngestManager.getNumberOfIngests.mockResolvedValue(2);
      mockIngestManager.getIngests.mockResolvedValue([ingestOne, ingestTwo]);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/devices'
      });

      expect(response.statusCode).toBe(200);
      // The total count is used as the limit so every ingest is pulled.
      expect(mockIngestManager.getIngests).toHaveBeenCalledWith(2, 0);
      expect(JSON.parse(response.body)).toEqual({
        devices: [
          {
            ingestId: 1,
            ingestLabel: 'Stage Left',
            type: 'input',
            name: 'in-1',
            label: 'Mic 1'
          },
          {
            ingestId: 1,
            ingestLabel: 'Stage Left',
            type: 'input',
            name: 'in-2',
            label: 'Mic 2'
          },
          {
            ingestId: 1,
            ingestLabel: 'Stage Left',
            type: 'output',
            name: 'out-1',
            label: 'Speaker 1'
          },
          {
            ingestId: 2,
            ingestLabel: 'Stage Right',
            type: 'output',
            name: 'out-9',
            label: 'Speaker 9'
          }
        ]
      });
    });

    test('returns 500 when the ingest manager throws', async () => {
      mockIngestManager.getNumberOfIngests.mockRejectedValue(
        new Error('db down')
      );

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/devices'
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
