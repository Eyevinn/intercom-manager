import { MongoClient } from 'mongodb';
import { Line, Production } from './models';
import { assert } from './utils';
import Nano from 'nano';

const DB_CONNECTION_STRING: string =
  process.env.DB_CONNECTION_STRING ??
  process.env.MONGODB_CONNECTION_STRING ??
  'mongodb://localhost:27017/intercom-manager';

const dbProtocol = DB_CONNECTION_STRING.split(':')[0];

const mongoClient = dbProtocol === 'mongodb' ? new MongoClient(DB_CONNECTION_STRING) : null;
const mongoDb = dbProtocol === 'mongodb' ? client.db() : null;
const nanoDb = dbProtocol === 'mongodb' ? null : Nano(DB_CONNECTION_STRING);

async function getNextSequence(collectionName: string): Promise<number> {
  if (dbProtocol === 'mongodb') {
    const ret = await mongoDb.command({
      findAndModify: 'counters',
      query: { _id: collectionName },
      update: { $inc: { seq: 1 } },
      new: true,
      upsert: true
    });
    return ret.value.seq;
  } else {
    const counterDocId = `counter_${collectionName}`;
    let counterDoc;

    try {
      counterDoc = await nanoDb.get(counterDocId);
      counterDoc.value = (parseInt(counterDoc.value) + 1).toString();
    } catch (error) {
//      assert.strictEqual(error.statusCode, 404, 'Unexpected error getting counter document');
      counterDoc = { _id: counterDocId, value: '1' };
    }
    await nanoDb.insert(counterDoc);
    return counterDoc.value;
  }
}

const dbManager = {
  async connect(): Promise<void> {
    if (dbProtocol === 'mongodb')
      await mongoClient.connect();
  },

  async disconnect(): Promise<void> {
    if (dbProtocol === 'mongodb')
      await mongoClient.close();
  },

  /** Get all productions from the database in reverse natural order, limited by the limit parameter */
  async getProductions(limit: number, offset: number): Promise<Production[]> {
    let productions: Production[] = [];
    if (dbProtocol === 'mongodb') {
      productions = await mongoDb
        .collection('productions')
        .find()
        .sort({ $natural: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
    } else {
      const response = await nanoDb.list({ 
        limit: limit,
        skip: offset,
        sort: [{ 'name': 'desc' }],
        include_docs: true
      });
      response.rows.forEach(row => {
        if (row.doc._id.toLowerCase().indexOf("counter") === -1)
          productions.push(row.doc);
      });
    }

    return productions as any as Production[];
  },

  async getProductionsLength(): Promise<number> {
    if (dbProtocol === 'mongodb') {
      return await mongoDb.collection('productions').countDocuments();
    } else {
      const productions = await nanoDb.list({ include_docs: false });
      return productions.rows.length;
    }
  },

  async getProduction(id: number): Promise<Production | undefined> {
    if (dbProtocol === 'mongodb') {
      return mongoDb.collection('productions').findOne({ _id: id as any }) as any | undefined;
    } else {
      const production = await nanoDb.get(id.toString());
      return production as any | undefined;
    }
  },

  async updateProduction(
    production: Production
  ): Promise<Production | undefined> {
    if (dbProtocol === 'mongodb') {
      const result = await mongoDb
      .collection('productions')
      .updateOne({ _id: production._id as any }, { $set: production });
      return result.modifiedCount === 1 ? production : undefined;
    } else {
      const existingProduction = await nanoDb.get(production._id.toString());
      const updatedProduction = { ...existingProduction, ...production };
      const response = await nanoDb.insert(updatedProduction);
      return response.ok ? production : undefined;
    }
  },

  async addProduction(name: string, lines: Line[]): Promise<Production> {
    const _id = await getNextSequence('productions');
    if (_id === -1) {
      throw new Error('Failed to get next sequence');
    }
    const production = { name, lines, _id };
      if (dbProtocol === 'mongodb') {
        await mongoDb.collection('productions').insertOne(production as any);
      return production;
    } else {
      const production = { name, lines, _id };
      const response = await nanoDb.insert(production);
      return response.ok ? production : undefined;
    }
  },

  async deleteProduction(productionId: number): Promise<boolean> {
    if (dbProtocol === 'mongodb') {
      const result = await mongoDb
        .collection('productions')
        .deleteOne({ _id: productionId as any });
      return result.deletedCount === 1;
    } else {
      const production = await nanoDb.get(productionId.toString());
      const response = await nanoDb.destroy(production._id, production._rev);
      return response.ok;
    }
  },

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
    if (dbProtocol === 'mongodb') {
      await mongoDb
      .collection('productions')
      .updateOne(
        { _id: productionId as any },
        { $set: { lines: production.lines } }
      );
    } else {
      const existingProduction = await nanoDb.get(productionId.toString());
      const updatedProduction = { ...existingProduction, lines: production.lines };
      const response = await nanoDb.insert(updatedProduction);
      assert(response.ok, `Failed to update production with id "${productionId}"`);
    }
  }
};

export default dbManager;
