import { Log } from '../log';
import { Ingest, Line, NewIngest, Production, UserSession } from '../models';
import { CallDocument } from '../models/call';
import { ClientDocument } from '../models/client';
import { assert } from '../utils';
import { DbManager } from './interface';
import nano from 'nano';

const SESSION_PRUNE_SECONDS = 7_200;
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
      await this.ensureSessionIndexes();
      this.sessionPruneInterval();
    }
  }

  // This interval is used to track and remove sessions based on 'isExpired' flag, set in production_manager.
  // Deviates from mongoDB, which handles session pruning based on internal TTL index. This isn't supported by CouchDB.
  private sessionPruneInterval() {
    setInterval(async () => {
      try {
        const cutoff = new Date(
          Date.now() - SESSION_PRUNE_SECONDS * 1000
        ).toISOString();
        const sessions = await this.getSessionsByQuery({
          lastSeenAt: { $lt: cutoff } as any
        });
        for (const session of sessions) {
          const sessionId = session._id;
          await this.deleteUserSession(sessionId);
          Log().info(`Terminated session ${sessionId}`);
        }
      } catch (error: any) {
        Log().error(error);
      }
    }, 300_000); // runs every 5th minute
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

  // Helper method, to avoid condlicting _revs on simultaneous update requests
  private async insertWithRetry(doc: any, maxRetries = 3): Promise<any> {
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    // retries 3 times to fetch the latets doc and _rev, if all fail then throw error
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.nanoDb.insert(doc);
      } catch (error: any) {
        if (error.statusCode === 409 && attempt < maxRetries - 1) {
          const latestDoc = await this.nanoDb.get(doc._id);
          doc = { ...latestDoc, ...doc, _rev: latestDoc._rev };
          await new Promise((resolve) =>
            setTimeout(resolve, 100 * Math.pow(2, attempt))
          );
        } else {
          throw error;
        }
      }
    }
  }

  async saveUserSession(
    sessionId: string,
    userSession: UserSession
  ): Promise<void> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    if (!sessionId.startsWith('session')) {
      sessionId = `session_${sessionId}`;
    }

    let existingDoc: any;

    // Check if document exists, if not creates new session
    try {
      existingDoc = await this.nanoDb.get(sessionId);
    } catch (error: any) {
      if (error.statusCode === 404) {
        existingDoc = { _id: sessionId };
      } else {
        throw error;
      }
    }
    const updatedSession = {
      ...existingDoc,
      ...userSession,
      lastSeenAt: new Date(Date.now()).toISOString(),
      _id: sessionId
    };
    await this.insertWithRetry(updatedSession);
  }

  async deleteUserSession(sessionId: string): Promise<boolean> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    if (!sessionId.startsWith('session')) {
      sessionId = `session_${sessionId}`;
    }
    const session = await this.nanoDb.get(sessionId);
    const response = await this.nanoDb.destroy(session._id, session._rev);
    return response.ok;
  }

  async getSession(sessionId: string): Promise<UserSession | null> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    if (!sessionId.startsWith('session')) {
      sessionId = `session_${sessionId}`;
    }
    const session = await this.nanoDb.get(sessionId);
    return session as any as UserSession;
  }

  async updateSession(
    sessionId: string,
    updates: Partial<UserSession>
  ): Promise<boolean> {
    await this.connect();

    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    if (!sessionId.startsWith('session')) {
      sessionId = `session_${sessionId}`;
    }
    const doc = await this.nanoDb.get(sessionId);

    const updateData: any = { ...updates };

    // converts lastSeen to a timestamp
    if ('lastSeen' in updates && typeof updates.lastSeen === 'number') {
      updateData.lastSeenAt = new Date(updates.lastSeen).toISOString();
    }

    // to ensure lastSeenAt is an ISO string Date object.
    if ('lastSeenAt' in updates && updates.lastSeenAt !== 'undefined') {
      const v = updates.lastSeenAt as any;
      updateData.lastSeenAt =
        v instanceof Date ? v.toISOString() : new Date(v).toISOString();
    }
    const updated = { ...doc, ...updateData };
    const res = await this.insertWithRetry(updated);
    return res.ok;
  }

  async getSessionsByQuery(q: Partial<UserSession>): Promise<UserSession[]> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const selector: any = { ...q };
    const response = await this.nanoDb.find({ selector, limit: 10000 }); // limit to 10000 sessions being queried
    return response.docs as unknown as UserSession[]; // could also expand type UserSession to avoid unknown
  }

  async ensureSessionIndexes(): Promise<void> {
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    // index for toInactivate, toReactivate, toExpire
    await (this.nanoDb as any).createIndex({
      index: {
        fields: ['isExpired', 'isActive']
      },
      name: 'idx_isExpired_isActive',
      ddoc: 'idx_isExpired_isActive',
      type: 'json'
    });

    // index for getUsersForLine()
    await (this.nanoDb as any).createIndex({
      index: {
        fields: ['isWhip', 'isExpired']
      },
      name: 'idx_isWhip_isExpired',
      ddoc: 'idx_isWhip_isExpired',
      type: 'json'
    });

    // index for getUsersForLine()
    await (this.nanoDb as any).createIndex({
      index: {
        fields: ['productionId', 'lineId', 'isExpired']
      },
      name: 'idx_prod_line_isExpired',
      ddoc: 'idx_prod_line_isExpired',
      type: 'json'
    });

    // index for getActiveUsers()
    await (this.nanoDb as any).createIndex({
      index: {
        fields: ['productionId', 'isActive']
      },
      name: 'idx_prod_isActive',
      ddoc: 'idx_prod_isActive',
      type: 'json'
    });

    // index for client registry queries
    await (this.nanoDb as any).createIndex({
      index: {
        fields: ['docType', 'isOnline']
      },
      name: 'idx_client_online',
      ddoc: 'idx_client_online',
      type: 'json'
    });

    // index for call queries by caller (M2)
    await (this.nanoDb as any).createIndex({
      index: { fields: ['docType', 'state', 'callerId'] },
      name: 'idx_call_state_caller',
      ddoc: 'idx_call_state_caller',
      type: 'json'
    });

    // index for call queries by callee (M2)
    await (this.nanoDb as any).createIndex({
      index: { fields: ['docType', 'state', 'calleeId'] },
      name: 'idx_call_state_callee',
      ddoc: 'idx_call_state_callee',
      type: 'json'
    });
  }

  // ── Client Registry Methods (M1) ──

  async saveClient(client: ClientDocument): Promise<void> {
    await this.connect();
    if (!this.nanoDb) throw new Error('Database not connected');
    await this.nanoDb.insert(client as any);
    Log().info(`Client saved: ${client._id} (${client.name})`);
  }

  async getClient(clientId: string): Promise<ClientDocument | null> {
    await this.connect();
    if (!this.nanoDb) throw new Error('Database not connected');
    try {
      const doc = await this.nanoDb.get(clientId);
      if ((doc as any).docType !== 'client') return null;
      return doc as unknown as ClientDocument;
    } catch (err: any) {
      if (err.statusCode === 404) return null;
      throw err;
    }
  }

  async updateClient(
    clientId: string,
    updates: Partial<ClientDocument>
  ): Promise<ClientDocument | null> {
    await this.connect();
    if (!this.nanoDb) throw new Error('Database not connected');
    try {
      const existing = await this.nanoDb.get(clientId);
      if ((existing as any).docType !== 'client') return null;
      const updated = {
        ...existing,
        ...updates,
        _id: clientId,
        _rev: existing._rev
      };
      await this.nanoDb.insert(updated as any);
      return updated as unknown as ClientDocument;
    } catch (err: any) {
      if (err.statusCode === 404) return null;
      throw err;
    }
  }

  async getOnlineClients(): Promise<ClientDocument[]> {
    await this.connect();
    if (!this.nanoDb) throw new Error('Database not connected');
    const result = await (this.nanoDb as any).find({
      selector: {
        docType: 'client',
        isOnline: true
      },
      limit: 1000
    });
    return (result.docs || []) as ClientDocument[];
  }

  async getAllClients(): Promise<ClientDocument[]> {
    await this.connect();
    if (!this.nanoDb) throw new Error('Database not connected');
    const result = await (this.nanoDb as any).find({
      selector: {
        docType: 'client'
      },
      limit: 2000
    });
    return (result.docs || []) as ClientDocument[];
  }

  // ── Call Management Methods (M2) ──

  async saveCall(call: CallDocument): Promise<void> {
    await this.connect();
    if (!this.nanoDb) throw new Error('Database not connected');
    await this.nanoDb.insert(call as any);
    Log().info(
      `Call saved: ${call._id} (${call.callerName} -> ${call.calleeName})`
    );
  }

  async getCall(callId: string): Promise<CallDocument | null> {
    await this.connect();
    if (!this.nanoDb) throw new Error('Database not connected');
    try {
      const doc = await this.nanoDb.get(callId);
      if ((doc as any).docType !== 'call') return null;
      return doc as unknown as CallDocument;
    } catch (err: any) {
      if (err.statusCode === 404) return null;
      throw err;
    }
  }

  async updateCall(
    callId: string,
    updates: Partial<CallDocument>
  ): Promise<CallDocument | null> {
    await this.connect();
    if (!this.nanoDb) throw new Error('Database not connected');
    try {
      const existing = await this.nanoDb.get(callId);
      if ((existing as any).docType !== 'call') return null;
      const updated = {
        ...existing,
        ...updates,
        _id: callId,
        _rev: existing._rev
      };
      await this.insertWithRetry(updated);
      return updated as unknown as CallDocument;
    } catch (err: any) {
      if (err.statusCode === 404) return null;
      throw err;
    }
  }

  async getActiveCallsForClient(clientId: string): Promise<CallDocument[]> {
    await this.connect();
    if (!this.nanoDb) throw new Error('Database not connected');
    const result = await (this.nanoDb as any).find({
      selector: {
        docType: 'call',
        state: { $in: ['offering', 'active'] },
        $or: [{ callerId: clientId }, { calleeId: clientId }]
      },
      limit: 1000
    });
    return (result.docs || []) as CallDocument[];
  }

  async getActiveCalls(): Promise<CallDocument[]> {
    await this.connect();
    if (!this.nanoDb) throw new Error('Database not connected');
    const result = await (this.nanoDb as any).find({
      selector: {
        docType: 'call',
        state: { $in: ['offering', 'active'] }
      },
      limit: 5000
    });
    return (result.docs || []) as CallDocument[];
  }
}
