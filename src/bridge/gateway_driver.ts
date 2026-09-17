import { Log } from '../log';
import { BridgeStatus, Receiver, Transmitter } from '../models';
import { encodeSrtStreamId } from '../utils';
import { BridgeDriver, EngineBridgeState } from './driver';

export interface GatewayBridgeDriverOptions {
  whipGatewayUrl?: string;
  whipGatewayApiKey?: string;
  whepGatewayUrl?: string;
  whepGatewayApiKey?: string;
}

export class GatewayBridgeDriver implements BridgeDriver {
  private whipGatewayUrl: string;
  private whipGatewayApiKey?: string;
  private whepGatewayUrl: string;
  private whepGatewayApiKey?: string;

  constructor(opts: GatewayBridgeDriverOptions) {
    this.whipGatewayUrl = opts.whipGatewayUrl || '';
    this.whipGatewayApiKey = opts.whipGatewayApiKey;
    this.whepGatewayUrl = opts.whepGatewayUrl || '';
    this.whepGatewayApiKey = opts.whepGatewayApiKey;
  }

  get transmittersEnabled(): boolean {
    return !!this.whipGatewayUrl;
  }

  get receiversEnabled(): boolean {
    return !!this.whepGatewayUrl;
  }

  private async call(
    gatewayUrl: string,
    apiKey: string | undefined,
    method: string,
    path: string,
    body?: unknown
  ): Promise<any> {
    const url = `${gatewayUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
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
          `Gateway request failed: ${response.status} ${errorText}`
        );
      }

      if (response.status === 204 || response.status === 201) {
        return null;
      }

      const contentType = response.headers.get('content-type');
      const text = await response.text();
      if (!text) {
        return null;
      }
      if (contentType && contentType.includes('application/json')) {
        return JSON.parse(text);
      }
      return null;
    } catch (error) {
      Log().error(`Failed to call gateway ${url}:`, error);
      throw error;
    }
  }

  private whip(method: string, path: string, body?: unknown): Promise<any> {
    return this.call(
      this.whipGatewayUrl,
      this.whipGatewayApiKey,
      method,
      path,
      body
    );
  }

  private whep(method: string, path: string, body?: unknown): Promise<any> {
    return this.call(
      this.whepGatewayUrl,
      this.whepGatewayApiKey,
      method,
      path,
      body
    );
  }

  async listTransmitters(): Promise<EngineBridgeState[]> {
    return (await this.whip('GET', '/api/v1/tx')) || [];
  }

  async createTransmitter(
    transmitter: Transmitter,
    status: BridgeStatus
  ): Promise<void> {
    await this.whip('POST', '/api/v1/tx/id', {
      id: transmitter._id,
      label: transmitter.label,
      port: transmitter.port,
      mode: transmitter.mode === 'caller' ? 1 : 2,
      srtUrl: transmitter.srtUrl?.replace(/^srt:\/\//, ''),
      whipUrl: transmitter.whipUrl,
      passThroughUrl: transmitter.passThroughUrl,
      noVideo: transmitter.noVideo ?? true,
      vp8: transmitter.vp8 ?? false,
      bypassVideo: transmitter.bypassVideo ?? false,
      status
    });
  }

  async setTransmitterState(id: string, desired: BridgeStatus): Promise<void> {
    await this.whip('PUT', `/api/v1/tx/id/${id}/state`, { desired });
  }

  async deleteTransmitter(id: string): Promise<void> {
    await this.whip('DELETE', `/api/v1/tx/id/${id}`);
  }

  async listReceivers(): Promise<EngineBridgeState[]> {
    return (await this.whep('GET', '/api/v1/rx')) || [];
  }

  async createReceiver(
    receiver: Receiver,
    status: BridgeStatus
  ): Promise<void> {
    await this.whep('POST', '/api/v1/rx', {
      id: receiver._id,
      whepUrl: receiver.whepUrl,
      srtUrl: encodeSrtStreamId(receiver.srtUrl),
      status
    });
  }

  async setReceiverState(id: string, desired: BridgeStatus): Promise<void> {
    await this.whep('PUT', `/api/v1/rx/${id}/state`, { desired });
  }

  async deleteReceiver(id: string): Promise<void> {
    await this.whep('DELETE', `/api/v1/rx/${id}`);
  }
}
