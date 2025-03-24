import api from './api';

jest.mock('./db/mongodb');

describe('share api', () => {
  test('can generate a share link for a given application path', async () => {
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com'
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/share',
      body: {
        path: '/mypath/to/share'
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      url: 'https://example.com/mypath/to/share'
    });
  });
});
