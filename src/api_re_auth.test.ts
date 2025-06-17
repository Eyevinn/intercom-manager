import api from './api';

jest.mock('./db/interface', () => ({
  getIngests: jest.fn().mockResolvedValue([]),
  connect: jest.fn()
}));

jest.mock('./ingest_manager', () => {
  return {
    IngestManager: jest.fn().mockImplementation(() => ({
      load: jest.fn().mockResolvedValue(undefined),
      startPolling: jest.fn()
    }))
  };
});

jest.mock('./db/mongodb');

describe('reAuth api', () => {
  test('can generate a new SAT Token for the OSC Intercom instance', async () => {
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com'
    });
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reauth'
    });
    expect(response.statusCode).toBe(500);
  });
});
