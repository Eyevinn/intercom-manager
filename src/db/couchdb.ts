import { Ingest, Line, NewIngest, Production } from '../models';
import { assert } from '../utils';
import { DbManager } from './interface';
import nano from 'nano';

export class DbManagerCouchDb implements DbManager {
  private client;
  private nanoDb;

  constructor(dbConnectionUrl: URL) {
    const server = new URL('/', dbConnectionUrl).toString();
    this.client = nano(server);
    this.nanoDb = this.client.db.use(
      dbConnectionUrl.pathname.replace(/^\//, '')
    );
  }

  async connect(): Promise<void> {
    // CouchDB does not require a connection
  }

  async disconnect(): Promise<void> {
    // CouchDB does not require a disconnection
  }

  private async getNextSequence(collectionName: string): Promise<number> {
    const counterDocId = `counter_${collectionName}`;
    interface CounterDoc {
      _id: string;
      _rev?: string;
      value: string;
    }
    let counterDoc: CounterDoc;

    try {
      counterDoc = (await this.nanoDb.get(counterDocId)) as CounterDoc;
      counterDoc.value = (parseInt(counterDoc.value) + 1).toString();
    } catch (error) {
      counterDoc = { _id: counterDocId, value: '1' };
    }
    await this.nanoDb.insert(counterDoc);
    return parseInt(counterDoc.value, 10);
  }

  /** Get all productions from the database in reverse natural order, limited by the limit parameter */
  async getProductions(): Promise<Production[]> {
    const productions: Production[] = [];
    const response = await this.nanoDb.list({
      include_docs: true
    });
    // eslint-disable-next-line
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
    // eslint-disable-next-line
    return production as any | undefined;
  }

  async updateProduction(
    production: Production
  ): Promise<Production | undefined> {
    const existingProduction = await this.nanoDb.get(production._id.toString());
    const updatedProduction = {
      ...existingProduction,
      ...production,
      _id: production._id.toString()
    };
    const response = await this.nanoDb.insert(updatedProduction);
    return response.ok ? production : undefined;
  }

  async addProduction(name: string, lines: Line[]): Promise<Production> {
    const _id = await this.getNextSequence('productions');
    if (_id === -1) {
      throw new Error('Failed to get next sequence');
    }
    const insertProduction = { name, lines, _id: _id.toString() };
    const response = await this.nanoDb.insert(
      insertProduction as unknown as nano.MaybeDocument
    );
    if (!response.ok) throw new Error('Failed to insert production');
    return { name, lines, _id } as Production;
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

  async addIngest(newIngest: NewIngest): Promise<Ingest> {
    const _id = await this.getNextSequence('ingests');
    if (_id === -1) {
      throw new Error('Failed to get next sequence');
    }
    const insertIngest = {
      ...newIngest,
      _id: _id.toString()
    };
    const response = await this.nanoDb.insert(
      insertIngest as unknown as nano.MaybeDocument
    );
    if (!response.ok) throw new Error('Failed to insert ingest');
    return { ...newIngest, _id } as any;
  }

  /** Get all ingests from the database in reverse natural order, limited by the limit parameter */
  async getIngests(): Promise<Ingest[]> {
    const ingests: Ingest[] = [];
    const response = await this.nanoDb.list({
      include_docs: true
    });
    // eslint-disable-next-line
    response.rows.forEach((row: any) => {
      if (row.doc._id.toLowerCase().indexOf('counter') === -1)
        ingests.push(row.doc);
    });
    return ingests as any as Ingest[];
  }

  async getIngestsLength(): Promise<number> {
    const ingests = await this.nanoDb.list({ include_docs: false });
    return ingests.rows.length;
  }

  async getIngest(id: number): Promise<Ingest | undefined> {
    const ingest = await this.nanoDb.get(id.toString());
    // eslint-disable-next-line
    return ingest as any | undefined;
  }

  async updateIngest(ingest: Ingest): Promise<Ingest | undefined> {
    const existingIngest = await this.nanoDb.get(ingest._id.toString());
    const updatedIngest = {
      ...existingIngest,
      ...ingest,
      _id: ingest._id.toString()
    };
    const response = await this.nanoDb.insert(updatedIngest);
    return response.ok ? ingest : undefined;
  }

  async deleteIngest(ingestId: number): Promise<boolean> {
    const ingest = await this.nanoDb.get(ingestId.toString());
    const response = await this.nanoDb.destroy(ingest._id, ingest._rev);
    return response.ok;
  }
}
