import '../config/load-env';
import { MongoClient } from 'mongodb';
import { Ingest, Line, NewIngest, Production, UserSession } from '../models';
import { assert } from '../utils';
import { DbManager } from './interface';
import { Log } from '../log';

const SESSION_PRUNE_SECONDS = 7_200;

export class DbManagerMongoDb implements DbManager {
  private client: MongoClient;

  constructor(dbConnectionUrl: URL) {
    this.client = new MongoClient(dbConnectionUrl.toString());
  }

  async connect(): Promise<void> {
    await this.client.connect();
    const db = this.client.db();
    const sessions = db.collection('sessions');

    // Ensure a expire-after-index on lastSeenAt so old sessions are automatically removed by MongoDB after SESSION_PRUNE_SECONDS
    const expireIndexName = 'lastSeenAt_1';
    let expireIndexExists = false;
    try {
      expireIndexExists = await sessions.indexExists(expireIndexName);
    } catch (error: any) {
      const code = error?.code;
      const message = error?.message.toString() || '';
      const namespaceMissing =
        code === 26 ||
        /NamespaceNotFound/i.test(message) ||
        /ns does not exist/i.test(message);
      if (!namespaceMissing) {
        throw error;
      }
    }
    if (!expireIndexExists) {
      await sessions.createIndex(
        { lastSeenAt: 1 },
        { expireAfterSeconds: SESSION_PRUNE_SECONDS }
      );
    } else {
      // Update expireAfterSeconds on existing index if it already exists
      try {
        await db.command({
          collMod: sessions.collectionName,
          index: {
            name: expireIndexName,
            expireAfterSeconds: SESSION_PRUNE_SECONDS
          }
        });
      } catch (e) {
        Log().error(e);
      }
    }

    // Helper to create indexes safely (ignore "already exists" errors)
    const safeCreate = async (keys: Record<string, 1 | -1>, opts: any = {}) => {
      try {
        await sessions.createIndex(keys, opts);
      } catch (err: any) {
        const msg = String(err?.message || '');
        if (!/already exists/i.test(msg)) throw err;
      }
    };

    await safeCreate({
      productionId: 1,
      lineId: 1,
      isExpired: 1,
      lastSeenAt: -1
    });

    await safeCreate({ isExpired: 1, isActive: 1, lastSeenAt: 1 });
    await safeCreate({ productionId: 1 });
    await safeCreate({ endpointId: 1 });
    await safeCreate({ productionId: 1, endpointId: 1 });
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  private async getNextSequence(collectionName: string): Promise<number> {
    const db = this.client.db();
    const ret = await db.command({
      findAndModify: 'counters',
      query: { _id: collectionName },
      update: { $inc: { seq: 1 } },
      new: true,
      upsert: true
    });
    return ret.value?.seq || 1;
  }

  /** Get all productions from the database in reverse natural order, limited by the limit parameter */
  async getProductions(limit: number, offset: number): Promise<Production[]> {
    const db = this.client.db();
    const productions = await db
      .collection('productions')
      .find()
      .sort({ $natural: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return productions as unknown as Production[];
  }

  async getProductionsLength(): Promise<number> {
    const db = this.client.db();
    return await db.collection('productions').countDocuments();
  }

  async getProduction(id: number): Promise<Production | undefined> {
    const db = this.client.db();
    // eslint-disable-next-line
    return db.collection('productions').findOne({ _id: id as any }) as
      | any
      | undefined;
  }

  async updateProduction(
    production: Production
  ): Promise<Production | undefined> {
    const db = this.client.db();
    const result = await db
      .collection('productions')
      .updateOne({ _id: production._id as any }, { $set: production });
    return result.modifiedCount === 1 ? production : undefined;
  }

  async addProduction(name: string, lines: Line[]): Promise<Production> {
    const db = this.client.db();
    const _id = await this.getNextSequence('productions');
    const production = { name, lines, _id };
    await db.collection('productions').insertOne(production as any);
    return production;
  }

  async deleteProduction(productionId: number): Promise<boolean> {
    const db = this.client.db();
    const result = await db
      .collection('productions')
      .deleteOne({ _id: productionId as any });
    return result.deletedCount === 1;
  }

  async setLineConferenceId(
    productionId: number,
    lineId: string,
    conferenceId: string
  ): Promise<void> {
    const production = await this.getProduction(productionId);
    assert(production, `Production with id "${productionId}" does not exist`);
    const line = production.lines.find((line) => line.id === lineId);
    assert(
      line,
      `Line with id "${lineId}" does not exist for production with id "${productionId}"`
    );
    line.smbConferenceId = conferenceId;
    const db = this.client.db();
    await db
      .collection('productions')
      .updateOne(
        { _id: productionId as any },
        { $set: { lines: production.lines } }
      );
  }

  async addIngest(newIngest: NewIngest): Promise<Ingest> {
    const db = this.client.db();
    const _id = await this.getNextSequence('ingests');
    const ingest = { ...newIngest, _id };
    await db.collection<Ingest>('ingests').insertOne(ingest as any);
    return ingest as Ingest;
  }

  /** Get all ingests from the database in reverse natural order, limited by the limit parameter */
  async getIngests(limit: number, offset: number): Promise<Ingest[]> {
    const db = this.client.db();
    const ingests = await db
      .collection<Ingest>('ingests')
      .find()
      .sort({ $natural: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return ingests as Ingest[];
  }

  async getIngest(id: number): Promise<Ingest | undefined> {
    const db = this.client.db();
    // eslint-disable-next-line
    return db.collection<Ingest>('ingests').findOne({ _id: id as any }) as
      | any
      | undefined;
  }

  async getIngestsLength(): Promise<number> {
    const db = this.client.db();
    return await db.collection<Ingest>('ingests').countDocuments();
  }

  async updateIngest(ingest: Ingest): Promise<Ingest | undefined> {
    const db = this.client.db();
    const result = await db
      .collection<Ingest>('ingests')
      .updateOne({ _id: ingest._id as any }, { $set: ingest });
    return result.modifiedCount === 1 ? ingest : undefined;
  }

  async deleteIngest(ingestId: number): Promise<boolean> {
    const db = this.client.db();
    const result = await db
      .collection<Ingest>('ingests')
      .deleteOne({ _id: ingestId as any });
    return result.deletedCount === 1;
  }

  async saveUserSession(
    sessionId: string,
    userSession: Omit<UserSession, '_id' | 'createdAt' | 'lastSeenAt'>
  ): Promise<void> {
    const db = this.client.db();
    const sessions = db.collection('sessions');
    const now = new Date();
    await sessions.updateOne(
      { _id: sessionId as any },
      {
        $setOnInsert: { createdAt: now },
        $set: {
          ...userSession,
          lastSeenAt: new Date(userSession.lastSeen ?? Date.now())
        }
      },
      { upsert: true }
    );
  }

  // Retreive session from db based on sessionId
  async getSession(sessionId: string): Promise<UserSession | null> {
    const db = this.client.db();
    return db.collection('sessions').findOne({ _id: sessionId as any }) as any;
  }

  // Delete session in db
  async deleteUserSession(sessionId: string): Promise<boolean> {
    const db = this.client.db();
    const result = await db
      .collection('sessions')
      .deleteOne({ _id: sessionId as any });
    return result.deletedCount === 1;
  }

  // Update db session
  async updateSession(
    sessionId: string,
    updates: Partial<UserSession>
  ): Promise<boolean> {
    const db = this.client.db();
    const $set: Record<string, unknown> = { ...updates };

    if ('lastSeen' in updates && typeof updates.lastSeen === 'number') {
      $set.lastSeenAt = new Date(updates.lastSeen);
    }

    if ('lastSeenAt' in updates && updates.lastSeenAt !== undefined) {
      const v = updates.lastSeenAt as any;
      $set.lastSeenAt = v instanceof Date ? v : new Date(v);
    }

    const res = await db
      .collection('sessions')
      .updateOne({ _id: sessionId } as any, { $set });

    return res.matchedCount === 1;
  }

  // Get database sessions matching query
  async getSessionsByQuery(q: Partial<UserSession>): Promise<UserSession[]> {
    const db = this.client.db();
    const sessions = db.collection<UserSession>('sessions');
    const mongoQuery: Record<string, unknown> = { ...q };

    delete (mongoQuery as any).lastSeen;

    return sessions.find(mongoQuery).toArray();
  }
}
