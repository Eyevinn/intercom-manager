import {
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

  // Transmitter operations
  addTransmitter(transmitter: NewTransmitter): Promise<Transmitter>;
  getTransmitter(id: string): Promise<Transmitter | undefined>;
  getTransmitters(limit: number, offset: number): Promise<Transmitter[]>;
  getTransmittersLength(): Promise<number>;
  updateTransmitter(transmitter: Transmitter): Promise<Transmitter | undefined>;
  deleteTransmitter(id: string): Promise<boolean>;

  // Receiver operations
  addReceiver(receiver: NewReceiver): Promise<Receiver>;
  getReceiver(id: string): Promise<Receiver | undefined>;
  getReceivers(limit: number, offset: number): Promise<Receiver[]>;
  getReceiversLength(): Promise<number>;
  updateReceiver(receiver: Receiver): Promise<Receiver | undefined>;
  deleteReceiver(id: string): Promise<boolean>;
}
