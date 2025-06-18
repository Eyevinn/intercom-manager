import { MongoClient } from 'mongodb';
import { DbManager } from './interface';
import {
  Ingest,
  IngestIO,
  Line,
  NewIngest,
  NewIngestIO,
  Production
} from '../models';
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

  /**
   * Add a new ingest to the database
   * @param newIngest - The new ingest to add
   * @returns The added ingest
   */

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

  /**
   * Add a new ingest IO to the database
   * @param newIngestIO - The new ingest IO to add
   * @returns The added ingest IO
   */

  async addIngestIO(newIngestIO: NewIngestIO): Promise<IngestIO> {
    const db = this.client.db();
    const _id = await this.getNextSequence('ingest_ios');
    const ingestIO = { ...newIngestIO, _id };
    await db.collection<IngestIO>('ingest_ios').insertOne(ingestIO as any);
    return ingestIO as IngestIO;
  }

  /** Get all ingests from the database in reverse natural order, limited by the limit parameter */
  async getIngestIOs(limit: number, offset: number): Promise<IngestIO[]> {
    const db = this.client.db();
    const ingestIOs = await db
      .collection<IngestIO>('ingest_ios')
      .find()
      .sort({ $natural: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return ingestIOs as IngestIO[];
  }

  async getIngestIO(id: number): Promise<IngestIO | undefined> {
    const db = this.client.db();
    // eslint-disable-next-line
    return db.collection<IngestIO>('ingest_ios').findOne({ _id: id as any }) as
      | any
      | undefined;
  }

  async getIngestIOsLength(): Promise<number> {
    const db = this.client.db();
    return await db.collection<IngestIO>('ingest_ios').countDocuments();
  }

  async updateIngestIO(ingestIO: IngestIO): Promise<IngestIO | undefined> {
    const db = this.client.db();
    const result = await db
      .collection<IngestIO>('ingest_ios')
      .updateOne({ _id: ingestIO._id as any }, { $set: ingestIO });
    return result.modifiedCount === 1 ? ingestIO : undefined;
  }

  async deleteIngestIO(ingestIOId: number): Promise<boolean> {
    const db = this.client.db();
    const result = await db
      .collection<IngestIO>('ingest_ios')
      .deleteOne({ _id: ingestIOId as any });
    return result.deletedCount === 1;
  }
}
