import { EventEmitter } from 'events';

import { DbManager } from './db/interface';
import { IngestIO, NewIngestIO } from './models';

interface IngestIOUpdate {
  label?: string;
  deviceInput?: {
    name?: string;
    label?: string;
  };
  deviceOutput?: {
    name?: string;
    label?: string;
  };
  productionId?: string;
  lineId?: string;
}

export class IngestIOManager extends EventEmitter {
  private dbManager: DbManager;

  constructor(dbManager: DbManager) {
    super();
    this.dbManager = dbManager;
  }

  async load(): Promise<void> {
    this.dbManager.connect();
  }

  async createIO(newIngestIO: NewIngestIO): Promise<IngestIO | undefined> {
    return this.dbManager.addIngestIO(newIngestIO);
  }

  async getIngestIO(ingestIOId: number): Promise<IngestIO | undefined> {
    return this.dbManager.getIngestIO(ingestIOId);
  }

  async getNumberOfIngestIOs(): Promise<number> {
    return this.dbManager.getIngestIOsLength();
  }

  async getIngestIOs(limit = 0, offset = 0): Promise<IngestIO[]> {
    return this.dbManager.getIngestIOs(limit, offset);
  }

  async updateIngestIO(
    ingestIO: IngestIO,
    updates: IngestIOUpdate
  ): Promise<IngestIO | undefined> {
    if (updates.label !== undefined) {
      ingestIO.label = updates.label;
    }

    if (updates.productionId !== undefined) {
      ingestIO.productionId = updates.productionId;
    }

    if (updates.lineId !== undefined) {
      ingestIO.lineId = updates.lineId;
    }

    if (updates.deviceInput) {
      if (updates.deviceInput.name !== undefined) {
        ingestIO.deviceInput.name = updates.deviceInput.name;
      }
      if (updates.deviceInput.label !== undefined) {
        ingestIO.deviceInput.label = updates.deviceInput.label;
      }
    }

    if (updates.deviceOutput) {
      if (updates.deviceOutput.name !== undefined) {
        ingestIO.deviceOutput.name = updates.deviceOutput.name;
      }
      if (updates.deviceOutput.label !== undefined) {
        ingestIO.deviceOutput.label = updates.deviceOutput.label;
      }
    }

    return this.dbManager.updateIngestIO(ingestIO);
  }

  /**
   * Delete the Ingest from the db and local cache
   */
  async deleteIngestIO(ingestIOId: number): Promise<boolean> {
    return this.dbManager.deleteIngestIO(ingestIOId);
  }
}
