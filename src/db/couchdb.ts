import { Log } from '../log';
import {
  BridgeStatus,
  Ingest,
  Line,
  NewIngest,
  NewReceiver,
  NewTransmitter,
  Production,
  Receiver,
  Transmitter,
  UserSession
} from '../models';
import { assert } from '../utils';
import { DbManager } from './interface';
import nano from 'nano';

export class DbManagerCouchDb implements DbManager {
  private client;
  private nanoDb: nano.DocumentScope<unknown> | undefined;
  private dbConnectionUrl: URL;

  constructor(dbConnectionUrl: URL) {
    this.dbConnectionUrl = dbConnectionUrl;
    const server = new URL('/', this.dbConnectionUrl).toString();
    this.client = nano(server);
  }
  async addTransmitter(newTransmitter: NewTransmitter): Promise<Transmitter> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const now = new Date().toISOString();
    const transmitter: Transmitter = {
      _id: String(newTransmitter.port),
      ...newTransmitter,
      status: BridgeStatus.IDLE,
      createdAt: now,
      updatedAt: now
    };
    const response = await this.nanoDb.insert(
      transmitter as unknown as nano.MaybeDocument
    );
    if (!response.ok) throw new Error('Failed to insert transmitter');
    return transmitter;
  }

  async getTransmitter(port: number): Promise<Transmitter | undefined> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    try {
      const transmitter = await this.nanoDb.get(String(port));
      return transmitter as any | undefined;
    } catch (error) {
      return undefined;
    }
  }

  async getTransmitters(limit: number, offset: number): Promise<Transmitter[]> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const transmitters: Transmitter[] = [];
    const response = await this.nanoDb.list({
      include_docs: true
    });
    response.rows.forEach((row: any) => {
      if (
        row.doc._id.toLowerCase().indexOf('counter') === -1 &&
        row.doc._id.toLowerCase().indexOf('session_') === -1 &&
        row.doc._id.toLowerCase().indexOf('rx-') === -1 &&
        !isNaN(Number(row.doc._id))
      ) {
        transmitters.push(row.doc);
      }
    });

    const result = transmitters.slice(offset, offset + limit);
    return result as any as Transmitter[];
  }

  async getTransmittersLength(): Promise<number> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const response = await this.nanoDb.list({ include_docs: false });
    const filteredRows = response.rows.filter(
      (row: any) =>
        row.id.toLowerCase().indexOf('counter') === -1 &&
        row.id.toLowerCase().indexOf('session_') === -1 &&
        row.id.toLowerCase().indexOf('rx-') === -1 &&
        !isNaN(Number(row.id))
    );
    return filteredRows.length;
  }

  async updateTransmitter(
    transmitter: Transmitter
  ): Promise<Transmitter | undefined> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const now = new Date().toISOString();
    try {
      const existingTransmitter = await this.nanoDb.get(
        String(transmitter.port)
      );
      const updatedTransmitter = {
        ...existingTransmitter,
        ...transmitter,
        _id: String(transmitter.port),
        updatedAt: now
      };
      const response = await this.nanoDb.insert(updatedTransmitter);
      return response.ok ? transmitter : undefined;
    } catch (error) {
      return undefined;
    }
  }

  async deleteTransmitter(port: number): Promise<boolean> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    try {
      const transmitter = await this.nanoDb.get(String(port));
      const response = await this.nanoDb.destroy(
        transmitter._id,
        transmitter._rev
      );
      return response.ok;
    } catch (error) {
      return false;
    }
  }
  async addReceiver(newReceiver: NewReceiver): Promise<Receiver> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const now = new Date().toISOString();
    const index = await this.getNextSequence('receivers');
    const id = `rx-${index}`;
    const receiver: Receiver = {
      _id: id,
      ...newReceiver,
      status: BridgeStatus.IDLE,
      createdAt: now,
      updatedAt: now
    };
    const response = await this.nanoDb.insert(
      receiver as unknown as nano.MaybeDocument
    );
    if (!response.ok) throw new Error('Failed to insert receiver');
    return receiver;
  }

  async getReceiver(id: string): Promise<Receiver | undefined> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    try {
      const receiver = await this.nanoDb.get(id);
      return receiver as any | undefined;
    } catch (error) {
      return undefined;
    }
  }

  async getReceivers(limit: number, offset: number): Promise<Receiver[]> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const receivers: Receiver[] = [];
    const response = await this.nanoDb.list({
      include_docs: true
    });
    response.rows.forEach((row: any) => {
      if (
        row.doc._id.toLowerCase().indexOf('counter') === -1 &&
        row.doc._id.toLowerCase().indexOf('session_') === -1 &&
        row.doc._id.toLowerCase().startsWith('rx-')
      ) {
        receivers.push(row.doc);
      }
    });

    const result = receivers.slice(offset, offset + limit);
    return result as any as Receiver[];
  }

  async getReceiversLength(): Promise<number> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const response = await this.nanoDb.list({ include_docs: false });
    const filteredRows = response.rows.filter(
      (row: any) =>
        row.id.toLowerCase().indexOf('counter') === -1 &&
        row.id.toLowerCase().indexOf('session_') === -1 &&
        row.id.toLowerCase().startsWith('rx-')
    );
    return filteredRows.length;
  }

  async updateReceiver(receiver: Receiver): Promise<Receiver | undefined> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const now = new Date().toISOString();
    try {
      const existingReceiver = await this.nanoDb.get(receiver._id);
      const updatedReceiver = {
        ...existingReceiver,
        ...receiver,
        _id: receiver._id,
        updatedAt: now
      };
      const response = await this.nanoDb.insert(updatedReceiver);
      return response.ok ? receiver : undefined;
    } catch (error) {
      return undefined;
    }
  }

  async deleteReceiver(id: string): Promise<boolean> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    try {
      const receiver = await this.nanoDb.get(id);
      const response = await this.nanoDb.destroy(receiver._id, receiver._rev);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async connect(): Promise<void> {
    if (!this.nanoDb) {
      const dbList = await this.client.db.list();
      Log().debug('List of databases', dbList);
      const dbName = this.dbConnectionUrl.pathname.replace(/^\//, '');
      if (!dbList.includes(dbName)) {
        Log().info('Creating database', dbName);
        await this.client.db.create(dbName);
      }
      Log().info('Using database', dbName);
      this.nanoDb = this.client.db.use(
        this.dbConnectionUrl.pathname.replace(/^\//, '')
      );
    }
  }

  async disconnect(): Promise<void> {
    // CouchDB does not require a disconnection
  }

  private async getNextSequence(collectionName: string): Promise<number> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
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
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
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
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    const productions = await this.nanoDb.list({ include_docs: false });
    return productions.rows.length;
  }

  async getProduction(id: number): Promise<Production | undefined> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const production = await this.nanoDb.get(id.toString());
    // eslint-disable-next-line
    return production as any | undefined;
  }

  async updateProduction(
    production: Production
  ): Promise<Production | undefined> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

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
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

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
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const production = await this.nanoDb.get(productionId.toString());
    const response = await this.nanoDb.destroy(production._id, production._rev);
    return response.ok;
  }

  async setLineConferenceId(
    productionId: number,
    lineId: string,
    conferenceId: string
  ): Promise<void> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

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
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

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
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

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
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const ingests = await this.nanoDb.list({ include_docs: false });
    return ingests.rows.length;
  }

  async getIngest(id: number): Promise<Ingest | undefined> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const ingest = await this.nanoDb.get(id.toString());
    // eslint-disable-next-line
    return ingest as any | undefined;
  }

  async updateIngest(ingest: Ingest): Promise<Ingest | undefined> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

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
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const ingest = await this.nanoDb.get(ingestId.toString());
    const response = await this.nanoDb.destroy(ingest._id, ingest._rev);
    return response.ok;
  }
}
