import { Connection } from './connection';
import { Line, Production, SmbEndpointDescription } from './models';
import { SmbProtocol } from './smb';

export interface CoreFunctionsInterface {
  createConnection(
    endpoint: SmbEndpointDescription,
    productionId: string,
    lineId: string,
    username: string,
    endpointId: string,
    sessionId: string
  ): Connection;
  createEndpoint(
    smb: SmbProtocol,
    smbServerUrl: string,
    lineId: string,
    endpointId: string,
    audio: boolean,
    data: boolean,
    endpointIdleTimeout: number
  ): Promise<SmbEndpointDescription>;
  handleAnswerRequest(
    smb: SmbProtocol,
    smbServerUrl: string,
    lineId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    answer: string
  ): Promise<void>;
  getProduction(productionId: string): Production;
  getLine(productionLines: Line[], lineId: string): Line;
  retrieveLineFromProduction(productionId: string, lineId: string): Line;
}
