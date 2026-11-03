import {
  Preset,
  Ingest,
  IngestIo,
  NewIngestIo,
  Line,
  NewIngest,
  Production,
  ShareLink,
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
  addIngestIo(ingestId: number, newIo: NewIngestIo): Promise<IngestIo>;
  getIngestIo(ingestId: number, ioId: string): Promise<IngestIo | undefined>;
  getIngestIos(ingestId: number): Promise<IngestIo[]>;
  updateIngestIo(io: IngestIo): Promise<IngestIo | undefined>;
  deleteIngestIo(ingestId: number, ioId: string): Promise<boolean>;
  deleteIngestIos(ingestId: number): Promise<void>;
  saveUserSession(sessionId: string, userSession: UserSession): Promise<void>;
  getSession(sessionId: string): Promise<UserSession | null>;
  deleteUserSession(sessionId: string): Promise<boolean>;
  updateSession(
    sessionId: string,
    updates: Partial<UserSession>
  ): Promise<boolean>;
  getSessionsByQuery(q: Partial<UserSession>): Promise<UserSession[]>;
  addPreset(preset: Omit<Preset, '_id'>): Promise<Preset>;
  getPreset(id: string): Promise<Preset | undefined>;
  getPresets(): Promise<Preset[]>;
  deletePreset(id: string): Promise<boolean>;
  updatePreset(
    id: string,
    update: {
      name?: string;
      calls?: { productionId: string; lineId: string }[];
      companionUrl?: string | null;
    }
  ): Promise<Preset | undefined>;
  addShareLink(shareLink: Omit<ShareLink, '_id'>): Promise<ShareLink>;
  getShareLink(id: string): Promise<ShareLink | undefined>;
  deleteShareLink(id: string): Promise<boolean>;
}
