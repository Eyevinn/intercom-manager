import { BridgeStatus, Receiver, Transmitter } from '../models';

export interface EngineBridgeState {
  id: string;
  status: BridgeStatus;
}

export interface BridgeDriver {
  readonly transmittersEnabled: boolean;
  readonly receiversEnabled: boolean;
  readonly supportsPassThrough: boolean;

  listTransmitters(): Promise<EngineBridgeState[]>;
  createTransmitter(
    transmitter: Transmitter,
    status: BridgeStatus
  ): Promise<void>;
  setTransmitterState(id: string, desired: BridgeStatus): Promise<void>;
  deleteTransmitter(id: string): Promise<void>;

  listReceivers(): Promise<EngineBridgeState[]>;
  createReceiver(receiver: Receiver, status: BridgeStatus): Promise<void>;
  setReceiverState(id: string, desired: BridgeStatus): Promise<void>;
  deleteReceiver(id: string): Promise<void>;
}
