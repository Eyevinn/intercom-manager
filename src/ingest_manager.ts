import { EventEmitter } from 'events';

import { DbManager } from './db/interface';
import { Ingest, NewIngest } from './models';
import { Log } from './log';

interface IngestUpdate {
  label?: string;
  deviceInput?: {
    name: string;
    label: string;
  };
  deviceOutput?: {
    name: string;
    label: string;
  };
}

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
    // TODO: uncomment this when we have an ingest that needs to be polled
    // const ingests = await this.dbManager.getIngests(0, 0);
    // ingests.forEach((ingest) => this.startPolling(ingest));
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
  // TODO: uncomment this when we have an ingest that needs to be polled
  // startPolling(ingest: Ingest, intervalMs = 10000) {
  //   // TODO: make sure the interval is correct
  //   const poll = async () => {
  //     await this.pollDeviceData(ingest);
  //     setTimeout(poll, intervalMs);
  //   };
  //   poll();
  // }

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
    updates: IngestUpdate
  ): Promise<Ingest | undefined> {
    if (updates.label !== undefined) {
      ingest.label = updates.label;
    }

    if (updates.deviceOutput) {
      const { name, label } = updates.deviceOutput;
      const deviceOutput = ingest.deviceOutput.find(
        (device) => device.name === name
      );
      if (deviceOutput) {
        deviceOutput.label = label;
      } else {
        return undefined;
      }
    }

    if (updates.deviceInput) {
      const { name, label } = updates.deviceInput;
      const deviceInput = ingest.deviceInput.find(
        (device) => device.name === name
      );
      if (deviceInput) {
        deviceInput.label = label;
      } else {
        return undefined;
      }
    }

    return this.dbManager.updateIngest(ingest);
  }

  /**
   * Delete the Ingest from the db and local cache
   */
  async deleteIngest(ingestId: number): Promise<boolean> {
    return this.dbManager.deleteIngest(ingestId);
  }
}
