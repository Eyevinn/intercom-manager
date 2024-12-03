import { Line, Production } from '../models';
import { assert } from '../utils';
import { DbManager } from './interface';
import nano from 'nano';

export class DbManagerCouchDb implements DbManager {
  private client;
  private nanoDb;

  constructor(dbConnectionUrl: URL) {
    this.client = nano(dbConnectionUrl.toString());
    this.nanoDb = this.client.db.use(dbConnectionUrl.pathname);
  }

  async connect(): Promise<void> {
    // CouchDB does not require a connection
  }

  async disconnect(): Promise<void> {
    // CouchDB does not require a disconnection
  }

  private async getNextSequence(collectionName: string): Promise<number> {
    const counterDocId = `counter_${collectionName}`;
    let counterDoc;

    try {
      counterDoc = await this.nanoDb.get(counterDocId);
      counterDoc.value = (parseInt(counterDoc.value) + 1).toString();
    } catch (error) {
      //      assert.strictEqual(error.statusCode, 404, 'Unexpected error getting counter document');
      counterDoc = { _id: counterDocId, value: '1' };
    }
    await this.nanoDb.insert(counterDoc);
    return counterDoc.value;
  }

  /** Get all productions from the database in reverse natural order, limited by the limit parameter */
  async getProductions(limit: number, offset: number): Promise<Production[]> {
    const productions: Production[] = [];
    const response = await this.nanoDb.list({
      limit: limit,
      skip: offset,
      sort: [{ name: 'desc' }],
      include_docs: true
    });
    response.rows.forEach((row: any) => {
      if (row.doc._id.toLowerCase().indexOf('counter') === -1)
        productions.push(row.doc);
    });
    return productions as any as Production[];
  }

  async getProductionsLength(): Promise<number> {
    const productions = await this.nanoDb.list({ include_docs: false });
    return productions.rows.length;
  }

  async getProduction(id: number): Promise<Production | undefined> {
    const production = await this.nanoDb.get(id.toString());
    return production as any | undefined;
  }

  async updateProduction(
    production: Production
  ): Promise<Production | undefined> {
    const existingProduction = await this.nanoDb.get(production._id.toString());
    const updatedProduction = { ...existingProduction, ...production };
    const response = await this.nanoDb.insert(updatedProduction);
    return response.ok ? production : undefined;
  }

  async addProduction(name: string, lines: Line[]): Promise<Production> {
    const _id = await this.getNextSequence('productions');
    if (_id === -1) {
      throw new Error('Failed to get next sequence');
    }
    const production = { name, lines, _id };
    const response = await this.nanoDb.insert(production);
    if (!response.ok) throw new Error('Failed to insert production');
  }

  async deleteProduction(productionId: number): Promise<boolean> {
    const production = await this.nanoDb.get(productionId.toString());
    const response = await this.nanoDb.destroy(production._id, production._rev);
    return response.ok;

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
    const existingProduction = await this.nanoDb.get(productionId.toString());
    const updatedProduction = {
      ...existingProduction,
      lines: production.lines
    };
    const response = await this.nanoDb.insert(updatedProduction);
    assert(
      response.ok,
      `Failed to update production with id "${productionId}"`
    );
  }
}
