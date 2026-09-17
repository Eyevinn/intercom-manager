import { v5 as uuidv5 } from 'uuid';
import { Log } from '../log';
import { BridgeStatus, Receiver, Transmitter } from '../models';
import { BridgeDriver, EngineBridgeState } from './driver';

const FLOW_ID_NAMESPACE = '9f2b7c14-6d3e-4a58-9c21-0e7f5a3b8d64';

const TX_PREFIX = 'tx-';
const RX_PREFIX = 'rx-';

const DEFAULT_WHIP_IMPLEMENTATION = 'whipsink';
const DEFAULT_WHEP_IMPLEMENTATION = 'whepclientsrc';
const DEFAULT_SRT_LATENCY_MS = 125;

export interface StromBridgeDriverOptions {
  stromUrl?: string;
  stromApiKey?: string;
  whipImplementation?: string;
  whepImplementation?: string;
  srtLatencyMs?: number;
}

interface StromFlow {
  id: string;
  name: string;
  running?: boolean;
}

type StromProperties = Record<string, string | number | boolean>;

interface StromBlock {
  id: string;
  block_definition_id: string;
  properties: StromProperties;
  position: { x: number; y: number };
}

export class StromBridgeDriver implements BridgeDriver {
  private stromUrl: string;
  private stromApiKey?: string;
  private whipImplementation: string;
  private whepImplementation: string;
  private srtLatencyMs: number;

  constructor(opts: StromBridgeDriverOptions) {
    this.stromUrl = (opts.stromUrl || '').replace(/\/+$/, '');
    this.stromApiKey = opts.stromApiKey;
    this.whipImplementation =
      opts.whipImplementation || DEFAULT_WHIP_IMPLEMENTATION;
    this.whepImplementation =
      opts.whepImplementation || DEFAULT_WHEP_IMPLEMENTATION;
    this.srtLatencyMs = opts.srtLatencyMs ?? DEFAULT_SRT_LATENCY_MS;
  }

  get transmittersEnabled(): boolean {
    return !!this.stromUrl;
  }

  get receiversEnabled(): boolean {
    return !!this.stromUrl;
  }

  get supportsPassThrough(): boolean {
    return false;
  }

  private transmitterSrtUri(transmitter: Transmitter): string {
    if (transmitter.srtUrl) {
      return transmitter.srtUrl;
    }
    if (transmitter.mode === 'listener') {
      return `srt://0.0.0.0:${transmitter.port}?mode=listener`;
    }
    throw new Error(
      `Transmitter ${transmitter._id} is in caller mode without an srtUrl`
    );
  }

  private flowId(prefix: string, bridgeId: string): string {
    return uuidv5(`${prefix}${bridgeId}`, FLOW_ID_NAMESPACE);
  }

  private async call(
    method: string,
    path: string,
    body?: unknown
  ): Promise<any> {
    const url = `${this.stromUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.stromApiKey) {
      headers.Authorization = `Bearer ${this.stromApiKey}`;
    }

    const options: RequestInit = { method, headers };
    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        const errorText = await response.text();
        throw new Error(
          `Strom request failed: ${response.status} ${errorText}`
        );
      }

      if (response.status === 204) {
        return null;
      }

      const text = await response.text();
      if (!text) {
        return null;
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return JSON.parse(text);
      }
      return null;
    } catch (error) {
      Log().error(`Failed to call Strom ${url}:`, error);
      throw error;
    }
  }

  private async listFlows(prefix: string): Promise<EngineBridgeState[]> {
    const response = await this.call('GET', '/api/flows');
    const flows: StromFlow[] = response?.flows || [];
    return flows
      .filter((flow) => flow.name?.startsWith(prefix))
      .map((flow) => ({
        id: flow.name.slice(prefix.length),
        status: flow.running ? BridgeStatus.RUNNING : BridgeStatus.STOPPED
      }));
  }

  private async createFlow(
    prefix: string,
    bridgeId: string,
    blocks: StromBlock[],
    from: string,
    to: string,
    status: BridgeStatus
  ): Promise<void> {
    const id = this.flowId(prefix, bridgeId);
    await this.call('DELETE', `/api/flows/${id}`);
    await this.call('POST', '/api/flows', {
      id,
      name: `${prefix}${bridgeId}`,
      blocks,
      links: [{ from, to }],
      elements: []
    });
    if (status === BridgeStatus.RUNNING) {
      await this.call('POST', `/api/flows/${id}/start`);
    }
  }

  private async setFlowState(
    prefix: string,
    bridgeId: string,
    desired: BridgeStatus
  ): Promise<void> {
    const id = this.flowId(prefix, bridgeId);
    const action = desired === BridgeStatus.RUNNING ? 'start' : 'stop';
    await this.call('POST', `/api/flows/${id}/${action}`);
  }

  private async deleteFlow(prefix: string, bridgeId: string): Promise<void> {
    await this.call('DELETE', `/api/flows/${this.flowId(prefix, bridgeId)}`);
  }

  async listTransmitters(): Promise<EngineBridgeState[]> {
    return this.listFlows(TX_PREFIX);
  }

  async createTransmitter(
    transmitter: Transmitter,
    status: BridgeStatus
  ): Promise<void> {
    const withVideo = transmitter.noVideo === false;
    const source: StromBlock = {
      id: 'srt_in',
      block_definition_id: 'builtin.mpegtssrt_input',
      properties: {
        srt_uri: this.transmitterSrtUri(transmitter),
        latency: this.srtLatencyMs,
        num_audio_tracks: 1,
        num_video_tracks: withVideo ? 1 : 0,
        decode: true
      },
      position: { x: 0, y: 0 }
    };
    const sink: StromBlock = {
      id: 'whip_out',
      block_definition_id: 'builtin.whip_output',
      properties: {
        whip_endpoint: transmitter.whipUrl,
        implementation: this.whipImplementation
      },
      position: { x: 400, y: 0 }
    };
    await this.createFlow(
      TX_PREFIX,
      transmitter._id,
      [source, sink],
      'srt_in:audio_out_0',
      'whip_out:audio_in',
      status
    );
  }

  async setTransmitterState(id: string, desired: BridgeStatus): Promise<void> {
    await this.setFlowState(TX_PREFIX, id, desired);
  }

  async deleteTransmitter(id: string): Promise<void> {
    await this.deleteFlow(TX_PREFIX, id);
  }

  async listReceivers(): Promise<EngineBridgeState[]> {
    return this.listFlows(RX_PREFIX);
  }

  async createReceiver(
    receiver: Receiver,
    status: BridgeStatus
  ): Promise<void> {
    const source: StromBlock = {
      id: 'whep_in',
      block_definition_id: 'builtin.whep_input',
      properties: {
        whep_endpoint: receiver.whepUrl,
        implementation: this.whepImplementation
      },
      position: { x: 0, y: 0 }
    };
    const sink: StromBlock = {
      id: 'srt_out',
      block_definition_id: 'builtin.mpegtssrt_output',
      properties: {
        srt_uri: receiver.srtUrl,
        latency: this.srtLatencyMs,
        num_audio_tracks: 1,
        num_video_tracks: 0
      },
      position: { x: 400, y: 0 }
    };
    await this.createFlow(
      RX_PREFIX,
      receiver._id,
      [source, sink],
      'whep_in:audio_out',
      'srt_out:audio_in_0',
      status
    );
  }

  async setReceiverState(id: string, desired: BridgeStatus): Promise<void> {
    await this.setFlowState(RX_PREFIX, id, desired);
  }

  async deleteReceiver(id: string): Promise<void> {
    await this.deleteFlow(RX_PREFIX, id);
  }
}
