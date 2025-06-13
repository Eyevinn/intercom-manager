import api from './api';

describe('permissions api', () => {
  test('returns participant permissions when no access key is provided', async () => {
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/permissions'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      permissions: ['join_calls'],
      role: 'participant'
    });
  });

  test('returns editor permissions when editor access key is provided', async () => {
    process.env.EDITOR_ACCESS_KEY = 'editorkey';

    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/permissions',
      headers: { 'x-access-key': 'editorkey' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      permissions: ['create_production', 'manage_production', 'join_calls'],
      role: 'editor'
    });
  });

  test('returns admin permissions with correct access key', async () => {
    process.env.ADMIN_ACCESS_KEY = 'adminkey';

    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/permissions',
      headers: { 'x-access-key': 'adminkey' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      permissions: [
        'create_production',
        'manage_production',
        'manage_ingests',
        'join_calls'
      ],
      role: 'admin'
    });
  });

  test('returns 403 for invalid access key', async () => {
    process.env.ADMIN_ACCESS_KEY = 'adminkey';
    process.env.EDITOR_ACCESS_KEY = 'editorkey';

    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/permissions',
      headers: { 'x-access-key': 'invalidkey' }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      message: 'Invalid access key'
    });
  });

  test('returns admin permissions when no access keys are configured in .env', async () => {
    delete process.env.ADMIN_ACCESS_KEY;
    delete process.env.EDITOR_ACCESS_KEY;

    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'https://example.com'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/permissions'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      permissions: [
        'create_production',
        'manage_production',
        'manage_ingests',
        'join_calls'
      ],
      role: 'admin'
    });
  });
});

describe('permissions api', () => {
    test('returns participant permissions  when no access key is provided', async () => {
        const server = await api({
            title: 'my awesome service',
            smbServerBaseUrl: 'http://localhost',
            endpointIdleTimeout: '60',
            publicHost: 'https://example.com'
        });
        
        const response = await server.inject({
            method: 'GET',
            url: '/api/v1/permissions'
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            permissions: ['join_calls'],
            role: 'participant'
        });
    });

    test('returns editor permissions when editor access key is provided', async () => {
        process.env.EDITOR_ACCESS_KEY = 'editorkey';

        const server = await api({
            title: 'my awesome service',
            smbServerBaseUrl: 'http://localhost',
            endpointIdleTimeout: '60',
            publicHost: 'https://example.com'
        });

        const response = await server.inject({
            method: 'GET',
            url: '/api/v1/permissions?accessKey=editorkey'
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            permissions: ['create_production', 'manage_production', 'join_calls'],
            role: 'editor'
        });
    });

    test('returns admin permissions with correct access key', async () => {
        process.env.ADMIN_ACCESS_KEY = 'adminkey';

        const server = await api({
            title: 'my awesome service',
            smbServerBaseUrl: 'http://localhost',
            endpointIdleTimeout: '60',
            publicHost: 'https://example.com'
        });

        const response = await server.inject({
            method: 'GET',
            url: '/api/v1/permissions?accessKey=adminkey'
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            permissions: ['create_production', 'manage_production', 'manage_ingests', 'join_calls'],
            role: 'admin'
        });
    });

    test('returns 403 for invalid access key', async () => {
        process.env.ADMIN_ACCESS_KEY = 'adminkey';
        process.env.EDITOR_ACCESS_KEY = 'editorkey';
      
        const server = await api({
          title: 'my awesome service',
          smbServerBaseUrl: 'http://localhost',
          endpointIdleTimeout: '60',
          publicHost: 'https://example.com'
        });
      
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/permissions?accessKey=invalidkey'
        });
      
        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({
          message: 'Invalid access key'
        });
      });
    
      test('returns admin permissions when no access keys are configured in .env', async () => {
        delete process.env.ADMIN_ACCESS_KEY;
        delete process.env.EDITOR_ACCESS_KEY;
      
        const server = await api({
          title: 'my awesome service',
          smbServerBaseUrl: 'http://localhost',
          endpointIdleTimeout: '60',
          publicHost: 'https://example.com'
        });
      
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/permissions'
        });
      
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          permissions: ['create_production', 'manage_production', 'manage_ingests', 'join_calls'],
          role: 'admin'
        });
      });      
})
