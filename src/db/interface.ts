import {
  Ingest,
  IngestIO,
  Line,
  NewIngest,
  NewIngestIO,
  Production
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
  addIngestIO(newIngestIO: NewIngestIO): Promise<IngestIO>;
  getIngestIO(id: number): Promise<IngestIO | undefined>;
  getIngestIOsLength(): Promise<number>;
  getIngestIOs(limit: number, offset: number): Promise<IngestIO[]>;
  updateIngestIO(ingestIO: IngestIO): Promise<IngestIO | undefined>;
  deleteIngestIO(ingestIOId: number): Promise<boolean>;
}
