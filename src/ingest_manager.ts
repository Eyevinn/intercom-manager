import { EventEmitter } from 'events';

import { DbManager } from './db/interface';
import { Log } from './log';
import { AudioDevice, Ingest, NewAudioDevice, NewIngest } from './models';

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
  ): Promise<
    { deviceOutput: AudioDevice[]; deviceInput: AudioDevice[] } | undefined
  > {
    try {
      // Normalize and ensure URL structure
      const hasProtocol = /^https?:\/\//.test(ipAddress);
      const withProtocol = hasProtocol ? ipAddress : `http://${ipAddress}`;

      const url = new URL(withProtocol);
      if (!url.port) {
        url.port = '8080'; // default port if none provided
      }
      url.pathname = '/devices';

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`Received non-OK response: ${response.status}`);
      }

      const devices = (await response.json()) as NewAudioDevice[];

      const deviceInput = devices.filter((d) => d.isInput);
      const deviceOutput = devices.filter((d) => d.isOutput);

      return { deviceInput, deviceOutput };
    } catch (err) {
      Log().error('Failed to fetch device data from ingest', err);
      return undefined;
    }
  }

  private async pollDeviceData(ingest: Ingest) {
    try {
      const [freshIngest, deviceData] = await Promise.all([
        this.dbManager.getIngest(ingest._id),
        this.fetchDeviceData(ingest.ipAddress)
      ]);

      if (!deviceData || !freshIngest) return;

      const normalize = (s: string) => s.trim().toLowerCase();

      const mergeDevices = (
        oldDevices: AudioDevice[],
        newDevices: AudioDevice[]
      ): AudioDevice[] => {
        return newDevices.map((newDevice) => {
          const old = oldDevices.find(
            (d) => normalize(d.name) === normalize(newDevice.name)
          );
          return {
            ...newDevice,
            label: old?.label ?? newDevice.name
          };
        });
      };

      const mergedInput = mergeDevices(
        freshIngest.deviceInput,
        deviceData.deviceInput
      );
      const mergedOutput = mergeDevices(
        freshIngest.deviceOutput,
        deviceData.deviceOutput
      );

      const sortDevices = (devices: AudioDevice[]) =>
        [...devices].sort((a, b) => a.name.localeCompare(b.name));

      const hasChanges =
        JSON.stringify(sortDevices(freshIngest.deviceInput)) !==
          JSON.stringify(sortDevices(mergedInput)) ||
        JSON.stringify(sortDevices(freshIngest.deviceOutput)) !==
          JSON.stringify(sortDevices(mergedOutput));

      if (hasChanges) {
        freshIngest.deviceInput = mergedInput;
        freshIngest.deviceOutput = mergedOutput;
        await this.dbManager.updateIngest(freshIngest);
        this.emit('deviceDataChanged', freshIngest);
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
