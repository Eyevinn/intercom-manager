import { MongoClient } from 'mongodb';
import { Production, Line } from './models';

const MONGODB_CONNECTION_STRING: string =
  process.env.MONGODB_CONNECTION_STRING ??
  'mongodb://localhost:27017/intercom-manager';

function convertMongoDBProductionToProduction(production: any): Production {
  const lines: Line[] = production.lines.map((line: any) => ({
    ...line,
    smbconferenceid: ''
  }));
  return {
    name: production.name,
    productionid: production.productionid,
    lines
  };
}

const client = new MongoClient(MONGODB_CONNECTION_STRING);
const db = client.db();

const dbManager = {
  async connect(): Promise<void> {
    await client.connect();
  },

  async disconnect(): Promise<void> {
    await client.close();
  },

  // We don't actually use this.
  async getProductions(): Promise<Production[]> {
    return (await db.collection('productions').find().toArray()).map(
      convertMongoDBProductionToProduction
    );
  },

  async getProduction(productionId: string): Promise<Production | undefined> {
    const production = await db
      .collection('productions')
      .findOne({ productionid: productionId });
    if (!production) {
      return undefined;
    }
    return convertMongoDBProductionToProduction(production);
  },

  async addProduction(production: Production): Promise<void> {
    // filter out values we don't want to store, like smbconferenceid and connections
    const { name, productionid, lines } = production;
    const persistedLines = lines.map(({ id, name }) => ({ id, name }));
    // Note that insertOne mutates the object you pass in to it and adds its own ObjectId there
    await client.connect();
    await db
      .collection('productions')
      .insertOne({ name, productionid, lines: persistedLines });
  },

  async deleteProduction(productionId: string): Promise<boolean> {
    const result = await db
      .collection('productions')
      .deleteOne({ productionid: productionId });

    return result.deletedCount === 1;
  },

  async getProductionCount(): Promise<number> {
    return db.collection('productions').countDocuments();
  }
};

export default dbManager;