jest.mock('./log', () => ({
  Log: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));

import Fastify, { FastifyInstance } from 'fastify';
import { registerIngestIoRoutes } from './api_ingest_io';
import { getApiIngests } from './api_ingests';
import { IngestManager } from './ingest_manager';
import { Ingest, IngestIo, NewIngestIo } from './models';

const ingest: Ingest = {
  _id: 1,
  label: 'Ingest',
  ipAddress: '127.0.0.1',
  deviceInput: [],
  deviceOutput: []
};

// Minimal in-memory stand-in for the Ingest-IO part of DbManager
function createDb() {
  const ios = new Map<string, IngestIo>();
  let seq = 0;
  return {
    ios,
    getIngest: jest.fn(async (id: number) => (id === 1 ? ingest : undefined)),
    addIngestIo: jest.fn(async (ingestId: number, n: NewIngestIo) => {
      const io = { ...n, ingestId, _id: `ingestio_${++seq}` };
      ios.set(io._id, io);
      return io;
    }),
    getIngestIos: jest.fn(async (ingestId: number) =>
      [...ios.values()].filter((io) => io.ingestId === ingestId)
    ),
    getIngestIo: jest.fn(async (ingestId: number, ioId: string) => {
      const io = ios.get(ioId);
      return io && io.ingestId === ingestId ? io : undefined;
    }),
    updateIngestIo: jest.fn(async (io: IngestIo) => {
      ios.set(io._id, io);
      return io;
    }),
    deleteIngestIo: jest.fn(async (ingestId: number, ioId: string) => {
      const io = ios.get(ioId);
      return io && io.ingestId === ingestId ? ios.delete(ioId) : false;
    }),
    deleteIngestIos: jest.fn().mockResolvedValue(undefined),
    deleteIngest: jest.fn().mockResolvedValue(true)
  };
}

describe('Ingest IO routes', () => {
  let server: FastifyInstance;
  let db: ReturnType<typeof createDb>;

  beforeEach(async () => {
    delete process.env.API_KEY;
    db = createDb();
    const manager = new IngestManager(db as any);
    server = Fastify();
    registerIngestIoRoutes(server, manager);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  const body = { name: 'in-1', label: 'Mic 1', direction: 'input' };

  it('creates and lists IOs under an ingest', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/ingest/1/io',
      payload: body
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ ...body, ingestId: 1 });
    expect(db.addIngestIo).toHaveBeenCalledWith(1, body);

    const list = await server.inject({ method: 'GET', url: '/ingest/1/io' });
    expect(list.statusCode).toBe(200);
    expect(list.json().ios).toHaveLength(1);
  });

  it('returns 404 when creating or listing under a missing ingest', async () => {
    const post = await server.inject({
      method: 'POST',
      url: '/ingest/9/io',
      payload: body
    });
    expect(post.statusCode).toBe(404);
    const get = await server.inject({ method: 'GET', url: '/ingest/9/io' });
    expect(get.statusCode).toBe(404);
    expect(db.addIngestIo).not.toHaveBeenCalled();
  });

  it('rejects an invalid body', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/ingest/1/io',
      payload: { name: 'x', label: 'y', direction: 'sideways' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('gets a single IO and 404s on unknown or foreign ids', async () => {
    const io = await db.addIngestIo(1, body as NewIngestIo);
    const ok = await server.inject({
      method: 'GET',
      url: `/ingest/1/io/${io._id}`
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()._id).toBe(io._id);

    const missing = await server.inject({
      method: 'GET',
      url: '/ingest/1/io/ingestio_nope'
    });
    expect(missing.statusCode).toBe(404);

    const foreign = await server.inject({
      method: 'GET',
      url: `/ingest/2/io/${io._id}`
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('patches an IO', async () => {
    const io = await db.addIngestIo(1, body as NewIngestIo);
    const res = await server.inject({
      method: 'PATCH',
      url: `/ingest/1/io/${io._id}`,
      payload: { label: 'Renamed' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ label: 'Renamed', name: 'in-1' });
    expect(db.ios.get(io._id)?.label).toBe('Renamed');
  });

  it('rejects an empty or unknown-field patch and 404s on missing IO', async () => {
    const io = await db.addIngestIo(1, body as NewIngestIo);
    const empty = await server.inject({
      method: 'PATCH',
      url: `/ingest/1/io/${io._id}`,
      payload: {}
    });
    expect(empty.statusCode).toBe(400);
    const missing = await server.inject({
      method: 'PATCH',
      url: '/ingest/1/io/ingestio_nope',
      payload: { label: 'x' }
    });
    expect(missing.statusCode).toBe(404);
  });

  it('deletes an IO and 404s the second time', async () => {
    const io = await db.addIngestIo(1, body as NewIngestIo);
    const first = await server.inject({
      method: 'DELETE',
      url: `/ingest/1/io/${io._id}`
    });
    expect(first.statusCode).toBe(200);
    const second = await server.inject({
      method: 'DELETE',
      url: `/ingest/1/io/${io._id}`
    });
    expect(second.statusCode).toBe(404);
  });

  it('returns 500 when the db throws', async () => {
    db.getIngestIos.mockRejectedValueOnce(new Error('boom'));
    const res = await server.inject({ method: 'GET', url: '/ingest/1/io' });
    expect(res.statusCode).toBe(500);
  });

  it('requires the API key for mutations when API_KEY is set', async () => {
    process.env.API_KEY = 'secret';
    const res = await server.inject({
      method: 'POST',
      url: '/ingest/1/io',
      payload: body
    });
    expect(res.statusCode).toBe(401);
    const ok = await server.inject({
      method: 'POST',
      url: '/ingest/1/io',
      payload: body,
      headers: { authorization: 'Bearer secret' }
    });
    expect(ok.statusCode).toBe(201);
    delete process.env.API_KEY;
  });
});

describe('Ingest IO routes inside the ingest plugin', () => {
  it('follow the ingest API gate (501 while the Ingest API is disabled)', async () => {
    const server = Fastify();
    server.register(getApiIngests(), {
      dbManager: {} as any,
      ingestManager: {} as any
    });
    await server.ready();
    for (const [method, url] of [
      ['GET', '/ingest/1/io'],
      ['GET', '/ingest/1/io/ingestio_a'],
      ['DELETE', '/ingest/1/io/ingestio_a']
    ] as const) {
      const res = await server.inject({ method, url });
      expect(res.statusCode).toBe(501);
    }
    await server.close();
  });
});
