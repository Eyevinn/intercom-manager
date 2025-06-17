import { EventEmitter } from 'events';

import { DbManager } from './db/interface';
import { Ingest, NewIngest } from './models';
import { Log } from './log';

export class IngestManager extends EventEmitter {
  private dbManager: DbManager;

  constructor(dbManager: DbManager) {
    super();
    this.dbManager = dbManager;
  }

  /**
   * Load the ingests from the db and start polling them
   */
  async load(): Promise<void> {
    this.dbManager.connect();
    const ingests = await this.dbManager.getIngests(0, 0);
    ingests.forEach((ingest) => this.startPolling(ingest));
  }

  async createIngest(newIngest: NewIngest): Promise<Ingest | undefined> {
    try {
      const deviceData = await this.fetchDeviceData(newIngest.ipAddress);
      if (!deviceData) {
        return undefined;
      }
      const ingestWithDevices = {
        ...newIngest,
        deviceOutput: deviceData.deviceOutput,
        deviceInput: deviceData.deviceInput
      };
      return this.dbManager.addIngest(ingestWithDevices);
    } catch (err) {
      Log().error(err);
      return undefined;
    }
  }

  private async fetchDeviceData(
    ipAddress: string
  ): Promise<{ deviceOutput: any[]; deviceInput: any[] } | undefined> {
    try {
      // TODO: Implement actual device communication
      // This is a placeholder that will be replaced with actual device communication
      Log().info('fetching device data for ip address', ipAddress);
      return {
        deviceOutput: [],
        deviceInput: []
      };
    } catch (err) {
      Log().error(err);
      return undefined;
    }
  }

  private async pollDeviceData(ingest: Ingest) {
    try {
      const deviceData = await this.fetchDeviceData(ingest.ipAddress);
      if (deviceData) {
        const hasChanges =
          JSON.stringify(deviceData.deviceOutput) !==
            JSON.stringify(ingest.deviceOutput) ||
          JSON.stringify(deviceData.deviceInput) !==
            JSON.stringify(ingest.deviceInput);

        if (hasChanges) {
          ingest.deviceOutput = deviceData.deviceOutput;
          ingest.deviceInput = deviceData.deviceInput;
          await this.dbManager.updateIngest(ingest);
          this.emit('deviceDataChanged', ingest);
        }
      }
    } catch (err) {
      Log().error('Error polling device data:', err);
    }
  }

  /**
   * Start polling the device data for the ingest to keep the ingest up to date
   * @param ingest - The ingest to poll
   * @param intervalMs - The interval in milliseconds to poll the device data
   */
  startPolling(ingest: Ingest, intervalMs = 10000) {
    // TODO: make sure the interval is correct
    const poll = async () => {
      await this.pollDeviceData(ingest);
      setTimeout(poll, intervalMs);
    };
    poll();
  }

  async getIngest(ingestId: number): Promise<Ingest | undefined> {
    return this.dbManager.getIngest(ingestId);
  }

  async getNumberOfIngests(): Promise<number> {
    return this.dbManager.getIngestsLength();
  }

  async getIngests(limit = 0, offset = 0): Promise<Ingest[]> {
    return this.dbManager.getIngests(limit, offset);
  }

  async updateIngest(
    ingest: Ingest,
    ingestName: string
  ): Promise<Ingest | undefined> {
    ingest.name = ingestName;
    return this.dbManager.updateIngest(ingest);
  }

  async updateIngestDeviceOutput(
    ingest: Ingest,
    deviceOutputName: string,
    deviceOutputLabel: string
  ): Promise<Ingest | undefined> {
    const deviceOutput = ingest.deviceOutput.find(
      (deviceOutput) => deviceOutput.name === deviceOutputName
    );
    if (deviceOutput) {
      deviceOutput.label = deviceOutputLabel;
      return this.dbManager.updateIngest(ingest);
    }
    return undefined;
  }

  async updateIngestDeviceInput(
    ingest: Ingest,
    deviceInputName: string,
    deviceInputLabel: string
  ): Promise<Ingest | undefined> {
    const deviceInput = ingest.deviceInput.find(
      (deviceInput) => deviceInput.name === deviceInputName
    );
    if (deviceInput) {
      deviceInput.label = deviceInputLabel;
      return this.dbManager.updateIngest(ingest);
    }
    return undefined;
  }

  /**
   * Delete the Ingest from the db and local cache
   */
  async deleteIngest(ingestId: number): Promise<boolean> {
    return this.dbManager.deleteIngest(ingestId);
  }
}
