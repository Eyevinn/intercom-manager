jest.mock('../log', () => ({
  Log: () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  })
}));

import { DbManagerCouchDb } from './couchdb';

// Create a minimal nanoDb stub for testing
function createNanoDbStub() {
  return {
    get: jest.fn(),
    insert: jest.fn(),
    list: jest.fn(),
    find: jest.fn(),
    destroy: jest.fn(),
    createIndex: jest.fn().mockResolvedValue(undefined)
  };
}

// Helper to create a DbManagerCouchDb with a stubbed nanoDb
function createTestManager() {
  const dbUrl = new URL('http://localhost:5984/testdb');
  const manager = new DbManagerCouchDb(dbUrl);
  const nanoDb = createNanoDbStub();
  // Inject the stub nanoDb to skip real connection
  (manager as any).nanoDb = nanoDb;
  return { manager, nanoDb };
}

describe('DbManagerCouchDb.updateSession', () => {
  it('returns false when session doc does not exist (404)', async () => {
    const { manager, nanoDb } = createTestManager();
    const notFoundError: any = new Error('not_found');
    notFoundError.statusCode = 404;
    nanoDb.get.mockRejectedValueOnce(notFoundError);

    const result = await manager.updateSession('session_xyz', {
      isActive: false
    });
    expect(result).toBe(false);
    expect(nanoDb.insert).not.toHaveBeenCalled();
  });

  it('re-throws non-404 errors from get', async () => {
    const { manager, nanoDb } = createTestManager();
    const serverError: any = new Error('internal_server_error');
    serverError.statusCode = 500;
    nanoDb.get.mockRejectedValueOnce(serverError);

    await expect(
      manager.updateSession('session_xyz', { isActive: false })
    ).rejects.toThrow('internal_server_error');
  });

  it('updates session successfully', async () => {
    const { manager, nanoDb } = createTestManager();
    nanoDb.get.mockResolvedValueOnce({
      _id: 'session_abc',
      _rev: '1-xxx',
      isActive: true
    });
    nanoDb.insert.mockResolvedValueOnce({ ok: true });

    const result = await manager.updateSession('session_abc', {
      isActive: false
    });
    expect(result).toBe(true);
    expect(nanoDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'session_abc',
        isActive: false
      })
    );
  });
});

describe('DbManagerCouchDb.insertWithRetry', () => {
  it('retries on socket hang up and succeeds on second attempt', async () => {
    const { manager, nanoDb } = createTestManager();
    const socketError = new Error(
      'error happened in your connection. Reason: socket hang up'
    );
    nanoDb.insert
      .mockRejectedValueOnce(socketError)
      .mockResolvedValueOnce({ ok: true });

    // Call insertWithRetry indirectly via saveUserSession
    // (which calls insertWithRetry internally)
    nanoDb.get.mockRejectedValueOnce(
      Object.assign(new Error('not_found'), { statusCode: 404 })
    );
    await manager.saveUserSession('session_retry', {
      name: 'test',
      productionId: '1',
      lineId: '1'
    } as any);

    expect(nanoDb.insert).toHaveBeenCalledTimes(2);
  });

  it('retries on ECONNRESET and succeeds', async () => {
    const { manager, nanoDb } = createTestManager();
    const resetError: any = new Error('Connection reset');
    resetError.code = 'ECONNRESET';
    nanoDb.insert
      .mockRejectedValueOnce(resetError)
      .mockResolvedValueOnce({ ok: true });

    nanoDb.get.mockRejectedValueOnce(
      Object.assign(new Error('not_found'), { statusCode: 404 })
    );
    await manager.saveUserSession('session_retry2', {
      name: 'test',
      productionId: '1',
      lineId: '1'
    } as any);

    expect(nanoDb.insert).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries on persistent transient errors', async () => {
    const { manager, nanoDb } = createTestManager();
    const socketError = new Error(
      'error happened in your connection. Reason: socket hang up'
    );
    nanoDb.insert.mockRejectedValue(socketError);

    nanoDb.get.mockRejectedValueOnce(
      Object.assign(new Error('not_found'), { statusCode: 404 })
    );
    await expect(
      manager.saveUserSession('session_fail', {
        name: 'test',
        productionId: '1',
        lineId: '1'
      } as any)
    ).rejects.toThrow('socket hang up');

    // 3 attempts (default maxRetries)
    expect(nanoDb.insert).toHaveBeenCalledTimes(3);
  });

  it('retries on 409 conflict with rev refresh', async () => {
    const { manager, nanoDb } = createTestManager();
    const conflictError: any = new Error('conflict');
    conflictError.statusCode = 409;

    nanoDb.insert
      .mockRejectedValueOnce(conflictError)
      .mockResolvedValueOnce({ ok: true });

    // On 409, insertWithRetry fetches the latest doc to get the new _rev
    nanoDb.get.mockResolvedValueOnce({
      _id: 'session_conflict',
      _rev: '2-new',
      name: 'old'
    });

    // Call via saveUserSession — first get is 404 (new doc), then conflict retry fetches latest
    nanoDb.get
      .mockReset()
      .mockRejectedValueOnce(
        Object.assign(new Error('not_found'), { statusCode: 404 })
      )
      .mockResolvedValueOnce({
        _id: 'session_conflict',
        _rev: '2-new'
      });

    await manager.saveUserSession('session_conflict', {
      name: 'test',
      productionId: '1',
      lineId: '1'
    } as any);

    expect(nanoDb.insert).toHaveBeenCalledTimes(2);
  });
});
