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

describe('DbManagerCouchDb.withRetry', () => {
  it('succeeds on first try without retrying', async () => {
    const { manager, nanoDb } = createTestManager();
    nanoDb.get.mockResolvedValueOnce({
      _id: '1',
      name: 'Test',
      lines: []
    });

    const result = await manager.getProduction(1);
    expect(result).toEqual({ _id: '1', name: 'Test', lines: [] });
    expect(nanoDb.get).toHaveBeenCalledTimes(1);
  });

  it('retries on ECONNRESET and succeeds', async () => {
    const { manager, nanoDb } = createTestManager();
    const resetError: any = new Error('Connection reset');
    resetError.code = 'ECONNRESET';

    nanoDb.get
      .mockRejectedValueOnce(resetError)
      .mockResolvedValueOnce({ _id: '1', name: 'Test', lines: [] });

    const result = await manager.getProduction(1);

    expect(result).toEqual({ _id: '1', name: 'Test', lines: [] });
    expect(nanoDb.get).toHaveBeenCalledTimes(2);
  });

  it('retries on ETIMEDOUT and succeeds', async () => {
    const { manager, nanoDb } = createTestManager();
    const timeoutError: any = new Error('Connection timed out');
    timeoutError.code = 'ETIMEDOUT';

    nanoDb.get
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce({ _id: '1', name: 'Test', lines: [] });

    const result = await manager.getProduction(1);

    expect(result).toEqual({ _id: '1', name: 'Test', lines: [] });
    expect(nanoDb.get).toHaveBeenCalledTimes(2);
  });

  it('retries on socket hang up and succeeds', async () => {
    const { manager, nanoDb } = createTestManager();
    const socketError = new Error('socket hang up');

    nanoDb.get
      .mockRejectedValueOnce(socketError)
      .mockResolvedValueOnce({ _id: '1', name: 'Test', lines: [] });

    const result = await manager.getProduction(1);

    expect(result).toEqual({ _id: '1', name: 'Test', lines: [] });
    expect(nanoDb.get).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries on persistent transient errors', async () => {
    const { manager, nanoDb } = createTestManager();
    const resetError: any = new Error('Connection reset');
    resetError.code = 'ECONNRESET';

    nanoDb.get.mockRejectedValue(resetError);

    await expect(manager.getProduction(1)).rejects.toThrow('Connection reset');
    // 3 attempts (default maxRetries)
    expect(nanoDb.get).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 404 errors', async () => {
    const { manager, nanoDb } = createTestManager();
    const notFoundError: any = new Error('not_found');
    notFoundError.statusCode = 404;

    nanoDb.get.mockRejectedValueOnce(notFoundError);

    await expect(manager.getProduction(1)).rejects.toThrow('not_found');
    expect(nanoDb.get).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 500 errors', async () => {
    const { manager, nanoDb } = createTestManager();
    const serverError: any = new Error('internal_server_error');
    serverError.statusCode = 500;

    nanoDb.get.mockRejectedValueOnce(serverError);

    await expect(manager.getProduction(1)).rejects.toThrow(
      'internal_server_error'
    );
    expect(nanoDb.get).toHaveBeenCalledTimes(1);
  });

  it('wraps list calls with retry', async () => {
    const { manager, nanoDb } = createTestManager();
    const resetError: any = new Error('Connection reset');
    resetError.code = 'ECONNRESET';

    nanoDb.list
      .mockRejectedValueOnce(resetError)
      .mockResolvedValueOnce({ rows: [] });

    const result = await manager.getProductions(10, 0);

    expect(result).toEqual([]);
    expect(nanoDb.list).toHaveBeenCalledTimes(2);
  });

  it('wraps find calls with retry', async () => {
    const { manager, nanoDb } = createTestManager();
    const resetError: any = new Error('Connection reset');
    resetError.code = 'ECONNRESET';

    nanoDb.find
      .mockRejectedValueOnce(resetError)
      .mockResolvedValueOnce({ docs: [] });

    const result = await manager.getSessionsByQuery({ isActive: true });

    expect(result).toEqual([]);
    expect(nanoDb.find).toHaveBeenCalledTimes(2);
  });

  it('wraps destroy calls with retry', async () => {
    const { manager, nanoDb } = createTestManager();
    const resetError: any = new Error('Connection reset');
    resetError.code = 'ECONNRESET';

    // First get succeeds, then destroy fails once before succeeding
    nanoDb.get.mockResolvedValueOnce({
      _id: '1',
      _rev: '1-abc'
    });
    nanoDb.destroy
      .mockRejectedValueOnce(resetError)
      .mockResolvedValueOnce({ ok: true });

    const result = await manager.deleteProduction(1);

    expect(result).toBe(true);
    expect(nanoDb.destroy).toHaveBeenCalledTimes(2);
  });
});

describe('DbManagerCouchDb.getNextSequence error handling', () => {
  it('creates counter doc on genuine 404', async () => {
    const { manager, nanoDb } = createTestManager();
    const notFoundError: any = new Error('not_found');
    notFoundError.statusCode = 404;

    // Counter doc not found — should create it with value '1'
    nanoDb.get.mockRejectedValueOnce(notFoundError);
    // First insert: counter doc, second insert: production doc
    nanoDb.insert
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    // Call via addProduction (uses getNextSequence internally)
    const result = await manager.addProduction('Test', []);

    expect(result._id).toBe(1);
    expect(nanoDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'counter_productions',
        value: '1'
      })
    );
  });

  it('propagates transient errors instead of silently resetting', async () => {
    const { manager, nanoDb } = createTestManager();
    const resetError: any = new Error('Connection reset');
    resetError.code = 'ECONNRESET';

    // All 3 retry attempts fail with transient error
    nanoDb.get.mockRejectedValue(resetError);

    await expect(manager.addProduction('Test', [])).rejects.toThrow(
      'Connection reset'
    );
  });

  it('propagates 500 errors instead of silently resetting', async () => {
    const { manager, nanoDb } = createTestManager();
    const serverError: any = new Error('internal_server_error');
    serverError.statusCode = 500;

    nanoDb.get.mockRejectedValueOnce(serverError);

    await expect(manager.addProduction('Test', [])).rejects.toThrow(
      'internal_server_error'
    );
  });

  it('increments existing counter doc', async () => {
    const { manager, nanoDb } = createTestManager();

    // Counter doc exists with value '5'
    nanoDb.get.mockResolvedValueOnce({
      _id: 'counter_productions',
      _rev: '1-abc',
      value: '5'
    });
    // First insert: counter doc, second insert: production doc
    nanoDb.insert
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    const result = await manager.addProduction('Test', []);

    expect(result._id).toBe(6);
    expect(nanoDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'counter_productions',
        value: '6'
      })
    );
  });
});

describe('DbManagerCouchDb.saveUserSession', () => {
  it('sets createdAt on first insert', async () => {
    const { manager, nanoDb } = createTestManager();
    const notFoundError: any = new Error('not_found');
    notFoundError.statusCode = 404;

    // Session does not exist yet
    nanoDb.get.mockRejectedValueOnce(notFoundError);
    nanoDb.insert.mockResolvedValueOnce({ ok: true });

    await manager.saveUserSession('session_new', {
      name: 'OBS',
      productionId: '1',
      lineId: '1',
      isWhip: true
    } as any);

    expect(nanoDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'session_new',
        createdAt: expect.any(String)
      })
    );
    // Verify createdAt is a valid ISO string
    const insertedDoc = nanoDb.insert.mock.calls[0][0];
    expect(new Date(insertedDoc.createdAt).toISOString()).toBe(
      insertedDoc.createdAt
    );
  });

  it('preserves existing createdAt on update', async () => {
    const { manager, nanoDb } = createTestManager();
    const originalCreatedAt = '2025-01-01T00:00:00.000Z';

    // Session already exists with createdAt
    nanoDb.get.mockResolvedValueOnce({
      _id: 'session_existing',
      _rev: '1-abc',
      createdAt: originalCreatedAt,
      name: 'Old Name'
    });
    nanoDb.insert.mockResolvedValueOnce({ ok: true });

    await manager.saveUserSession('session_existing', {
      name: 'New Name',
      productionId: '1',
      lineId: '1',
      isWhip: true
    } as any);

    const insertedDoc = nanoDb.insert.mock.calls[0][0];
    expect(insertedDoc.createdAt).toBe(originalCreatedAt);
  });
});

describe('DbManagerCouchDb.connect', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries on transient startup failure and succeeds', async () => {
    const dbUrl = new URL('http://localhost:5984/testdb');
    const manager = new DbManagerCouchDb(dbUrl);
    const client = (manager as any).client;

    const resetError: any = new Error('Connection reset');
    resetError.code = 'ECONNRESET';

    // Stub client.db methods
    const mockList = jest.fn();
    const mockCreate = jest.fn();
    const mockUse = jest.fn();
    const mockCreateIndex = jest.fn().mockResolvedValue(undefined);

    client.db = {
      list: mockList,
      create: mockCreate,
      use: mockUse
    };

    // First call fails, second succeeds
    mockList
      .mockRejectedValueOnce(resetError)
      .mockResolvedValueOnce(['testdb']);
    mockUse.mockReturnValue({ createIndex: mockCreateIndex });

    const promise = manager.connect();
    // Advance past the 1s retry delay (not runAllTimersAsync to avoid prune interval)
    await jest.advanceTimersByTimeAsync(2000);
    await promise;

    expect(mockList).toHaveBeenCalledTimes(2);
    expect((manager as any).nanoDb).toBeDefined();
    await manager.disconnect();
  });

  it('throws non-transient errors without retrying', async () => {
    const dbUrl = new URL('http://localhost:5984/testdb');
    const manager = new DbManagerCouchDb(dbUrl);
    const client = (manager as any).client;

    const authError: any = new Error('unauthorized');
    authError.statusCode = 401;

    client.db = {
      list: jest.fn().mockRejectedValueOnce(authError),
      create: jest.fn(),
      use: jest.fn()
    };

    await expect(manager.connect()).rejects.toThrow('unauthorized');
    expect(client.db.list).toHaveBeenCalledTimes(1);
  });

  it('creates database if it does not exist', async () => {
    const dbUrl = new URL('http://localhost:5984/testdb');
    const manager = new DbManagerCouchDb(dbUrl);
    const client = (manager as any).client;

    const mockCreateIndex = jest.fn().mockResolvedValue(undefined);

    client.db = {
      list: jest.fn().mockResolvedValueOnce([]),
      create: jest.fn().mockResolvedValueOnce(undefined),
      use: jest.fn().mockReturnValue({ createIndex: mockCreateIndex })
    };

    await manager.connect();

    expect(client.db.create).toHaveBeenCalledWith('testdb');
    expect(client.db.use).toHaveBeenCalledWith('testdb');
    await manager.disconnect();
  });
});
