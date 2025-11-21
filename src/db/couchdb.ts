import { Log } from '../log';
import { Ingest, Line, NewIngest, Production, UserSession } from '../models';
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
  async getProductions(limit: number, offset: number): Promise<Production[]> {
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
      if (
        row.doc._id.toLowerCase().indexOf('counter') === -1 &&
        row.doc._id.toLowerCase().indexOf('session_') === -1
      )
        productions.push(row.doc);
    });

    // Apply offset and limit
    const result = productions.slice(offset, offset + limit);
    return result as any as Production[];
  }

  async getProductionsLength(): Promise<number> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    const productions = await this.nanoDb.list({ include_docs: false });
    // Filter out counter and session documents
    const filteredRows = productions.rows.filter(
      (row: any) =>
        row.id.toLowerCase().indexOf('counter') === -1 &&
        row.id.toLowerCase().indexOf('session_') === -1
    );
    return filteredRows.length;
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
  async getIngests(limit: number, offset: number): Promise<Ingest[]> {
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
      if (
        row.doc._id.toLowerCase().indexOf('counter') === -1 &&
        row.doc._id.toLowerCase().indexOf('session_') === -1
      )
        ingests.push(row.doc);
    });

    // Apply offset and limit
    const result = ingests.slice(offset, offset + limit);
    return result as any as Ingest[];
  }

  async getIngestsLength(): Promise<number> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const ingests = await this.nanoDb.list({ include_docs: false });
    // Filter out counter and session documents
    const filteredRows = ingests.rows.filter(
      (row: any) =>
        row.id.toLowerCase().indexOf('counter') === -1 &&
        row.id.toLowerCase().indexOf('session_') === -1
    );
    return filteredRows.length;
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

  // Session management methods
  async saveUserSession(
    sessionId: string,
    userSession: UserSession
  ): Promise<void> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const sessionDocId = `session_${sessionId}`;

    try {
      let existingDoc: any;

      // Check if document exists, if not set id
      try {
        existingDoc = await this.nanoDb.get(sessionDocId);
      } catch (err: any) {
        if (err.statusCode === 404) {
          existingDoc = { _id: sessionDocId };
        } else {
          throw err;
        }
      }
      const updatedSession = {
        ...existingDoc,
        ...userSession,
        _id: sessionDocId
      };

      await this.nanoDb.insert(updatedSession);
    } catch (error) {
      return;
    }
  }

  async deleteUserSession(sessionId: string): Promise<boolean> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const sessionDocId = `session_${sessionId}`;
    try {
      const session = await this.nanoDb.get(sessionDocId);
      const response = await this.nanoDb.destroy(session._id, session._rev);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async getSession(sessionId: string): Promise<UserSession | null> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    const sessionDocId = `session_${sessionId}`;

    // wrap inside try-block to be consistent with mongodb implementation
    try {
      const session = await this.nanoDb.get(sessionDocId);
      return session as any as UserSession;
    } catch (err: any) {
      if (err.statusCode === 404) {
        return null;
      } else {
        throw err;
      }
    }
  }

  async updateSession(
    sessionId: string,
    updates: Partial<UserSession>
  ): Promise<boolean> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    const id = `session_${sessionId}`;
    try {
      const doc = await this.nanoDb.get(id);

      const updateData: any = { ...updates };

      // converts lastSeen to a timestamp
      if ('lastSeen' in updates && typeof updates.lastSeen === 'number') {
        updateData.lastSeenAt = new Date(updates.lastSeen);
      }

      // to ensure lastSeenAt is a Date object
      if ('lastSeenAt' in updates && typeof updates.lastSeenAt !== undefined) {
        const v = updates.lastSeenAt as any;
        updateData.lastSeenAt = v instanceof Date ? v : new Date(v);
      }

      const updated = { ...doc, ...updates };
      await this.nanoDb.insert(updated);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getSessionsByQuery(q: Partial<UserSession>): Promise<UserSession[]> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    const selector: any = { ...q };
    delete selector.lastSeen;
    const response = await this.nanoDb.find({ selector, limit: 10000 });
    return response.docs as unknown as UserSession[]; // could also expand type UserSession to avoid unknown
  }
}
