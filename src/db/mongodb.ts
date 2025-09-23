import { MongoClient } from 'mongodb';
import { DbManager } from './interface';
import { Ingest, Line, NewIngest, Production, UserSession } from '../models';
import { assert } from '../utils';

export class DbManagerMongoDb implements DbManager {
  private client: MongoClient;

  constructor(dbConnectionUrl: URL) {
    this.client = new MongoClient(dbConnectionUrl.toString());
  }

  async connect(): Promise<void> {
    await this.client.connect();
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
    return ret.value.seq;
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

  // Session management methods
  async saveUserSession(
    sessionId: string,
    userSession: UserSession
  ): Promise<void> {
    const db = this.client.db();
    await db
      .collection('sessions')
      .updateOne(
        { _id: sessionId },
        { $set: { ...userSession, _id: sessionId } },
        { upsert: true }
      );
  }

  async getUserSession(sessionId: string): Promise<UserSession | undefined> {
    const db = this.client.db();
    const session = await db.collection('sessions').findOne({ _id: sessionId });
    if (!session) {
      return undefined;
    }
    // Remove the MongoDB _id field from the returned session
    const { _id, ...userSession } = session;
    return userSession as UserSession;
  }

  async getAllUserSessions(): Promise<Record<string, UserSession>> {
    const db = this.client.db();
    const sessions = await db.collection('sessions').find({}).toArray();
    const result: Record<string, UserSession> = {};

    for (const session of sessions) {
      const { _id, ...userSession } = session;
      result[_id as string] = userSession as UserSession;
    }

    return result;
  }

  async deleteUserSession(sessionId: string): Promise<boolean> {
    const db = this.client.db();
    const result = await db
      .collection('sessions')
      .deleteOne({ _id: sessionId });
    return result.deletedCount === 1;
  }

  async updateUserSession(
    sessionId: string,
    updates: Partial<UserSession>
  ): Promise<boolean> {
    const db = this.client.db();
    const result = await db
      .collection('sessions')
      .updateOne({ _id: sessionId }, { $set: updates });
    return result.modifiedCount === 1;
  }
}
