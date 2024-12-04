import { MongoClient } from 'mongodb';
import { DbManager } from './interface';
import { Line, Production } from '../models';
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

    return productions as any as Production[];
  }

  async getProductionsLength(): Promise<number> {
    const db = this.client.db();
    return await db.collection('productions').countDocuments();
  }

  async getProduction(id: number): Promise<Production | undefined> {
    const db = this.client.db();
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
}
