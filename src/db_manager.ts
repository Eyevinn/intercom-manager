import { MongoClient } from 'mongodb';
import { Line, Production } from './models';

const MONGODB_CONNECTION_STRING: string =
  process.env.MONGODB_CONNECTION_STRING ??
  'mongodb://localhost:27017/intercom-manager';

const client = new MongoClient(MONGODB_CONNECTION_STRING);
const db = client.db();

async function getNextSequence(collectionName: string): Promise<number> {
  const ret = await db.command({
    findAndModify: 'counters',
    query: { _id: collectionName },
    update: { $inc: { seq: 1 } },
    new: true,
    upsert: true
  });
  return ret.value.seq;
}

const dbManager = {
  async connect(): Promise<void> {
    await client.connect();
  },

  async disconnect(): Promise<void> {
    await client.close();
  },

  /** Get all productions from the database in reverse natural order, limited by the limit parameter */
  async getProductions(limit: number): Promise<Production[]> {
    const productions = await db
      .collection('productions')
      .find()
      .sort({ $natural: -1 })
      .limit(limit)
      .toArray();
    return Array.from(productions) as any as Production[];
  },

  async getProduction(id: number): Promise<Production | undefined> {
    return db.collection('productions').findOne({ _id: id as any }) as
      | any
      | undefined;
  },

  async addProduction(name: string, lines: Line[]): Promise<Production> {
    const _id = await getNextSequence('productions');
    const production = { name, lines, _id };
    await db.collection('productions').insertOne(production as any);
    return production;
  },

  async deleteProduction(productionId: string): Promise<boolean> {
    const result = await db
      .collection('productions')
      .deleteOne({ productionid: productionId });

    return result.deletedCount === 1;
  }
};

export default dbManager;
