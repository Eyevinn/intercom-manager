import { Ingest, Line, NewIngest, Production, UserSession } from '../models';
import { ClientDocument } from '../models/client';
import { CallDocument } from '../models/call';

export interface DbManager {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getProduction(id: number): Promise<Production | undefined>;
  getProductions(limit: number, offset: number): Promise<Production[]>;
  getProductionsLength(): Promise<number>;
  updateProduction(production: Production): Promise<Production | undefined>;
  addProduction(name: string, lines: Line[]): Promise<Production>;
  deleteProduction(productionId: number): Promise<boolean>;
  setLineConferenceId(
    productionId: number,
    lineId: string,
    conferenceId: string
  ): Promise<void>;
  addIngest(newIngest: NewIngest): Promise<Ingest>;
  getIngest(id: number): Promise<Ingest | undefined>;
  getIngestsLength(): Promise<number>;
  getIngests(limit: number, offset: number): Promise<Ingest[]>;
  updateIngest(ingest: Ingest): Promise<Ingest | undefined>;
  deleteIngest(ingestId: number): Promise<boolean>;
  saveUserSession(sessionId: string, userSession: UserSession): Promise<void>;
  getSession(sessionId: string): Promise<UserSession | null>;
  deleteUserSession(sessionId: string): Promise<boolean>;
  updateSession(
    sessionId: string,
    updates: Partial<UserSession>
  ): Promise<boolean>;
  getSessionsByQuery(q: Partial<UserSession>): Promise<UserSession[]>;

  // Client registry methods (M1)
  saveClient(client: ClientDocument): Promise<void>;
  getClient(clientId: string): Promise<ClientDocument | null>;
  updateClient(
    clientId: string,
    updates: Partial<ClientDocument>
  ): Promise<ClientDocument | null>;
  getOnlineClients(): Promise<ClientDocument[]>;
  getAllClients(): Promise<ClientDocument[]>;

  // Call management methods (M2)
  saveCall(call: CallDocument): Promise<void>;
  getCall(callId: string): Promise<CallDocument | null>;
  updateCall(
    callId: string,
    updates: Partial<CallDocument>
  ): Promise<CallDocument | null>;
  getActiveCallsForClient(clientId: string): Promise<CallDocument[]>;
  getActiveCalls(): Promise<CallDocument[]>;
}
