import { EventEmitter } from 'events';

import {
  NewProduction,
  Production,
  Line,
  SmbEndpointDescription,
  UserSession,
  User
} from './models';

const USER_STATUS_CHECK_TIMEOUT = 1_000;
const USER_INACTIVE_THRESHOLD = 10_000;
const USER_DISCONNECTED_THRESHOLD = 30_000;

export class ProductionManager extends EventEmitter {
  private productions: Production[];
  private userSessions: Record<string, UserSession>;
  private userStatusMonitorInterval: NodeJS.Timeout;
  private disconnectedUsersCount = 0;

  constructor() {
    super();
    this.productions = [];
    this.userSessions = {};
    this.userStatusMonitorInterval = this.setupUserStatusMonitor();
  }

  private setupUserStatusMonitor(): NodeJS.Timeout {
    clearInterval(this.userStatusMonitorInterval);
    return setInterval(() => {
      let disconnectedUsersCount = 0;
      for (const userSession of Object.values(this.userSessions)) {
        if (
          userSession.lastSeen.getTime() <
          new Date().getTime() - USER_DISCONNECTED_THRESHOLD
        ) {
          disconnectedUsersCount += 1;
        }
      }
      if (disconnectedUsersCount !== this.disconnectedUsersCount) {
        console.log(`${disconnectedUsersCount} users disconnected`);
        this.disconnectedUsersCount = disconnectedUsersCount;
        this.emit('users:change');
      }
    }, USER_STATUS_CHECK_TIMEOUT);
  }

  createProduction(newProduction: NewProduction): Production | undefined {
    const productionId: string = (this.productions.length + 1).toString();
    if (!this.getProduction(productionId)) {
      const newProductionLines: Line[] = [];

      let index = 0;
      for (const line of newProduction.lines) {
        index++;
        const newProductionLine: Line = {
          name: line.name,
          id: index.toString(),
          smbid: '',
          connections: {}
        };
        newProductionLines.push(newProductionLine);
      }

      const production: Production = {
        name: newProduction.name,
        productionid: productionId,
        lines: newProductionLines
      };
      if (production) {
        this.productions.push(production);
        return production;
      } else {
        throw new Error(
          `Create production failed, Production object error ${production}`
        );
      }
    } else {
      throw new Error(
        `Create production failed, Production ${newProduction} already exists`
      );
    }
  }

  getProductions(): Production[] {
    return this.productions;
  }

  getProduction(productionid: string): Production | undefined {
    const matchedProduction = this.productions.find(
      (production) => production.productionid === productionid
    );
    if (matchedProduction) {
      return matchedProduction;
    } else {
      return undefined;
    }
  }

  deleteProduction(productionId: string): string | undefined {
    const matchedProductionIndex: number = this.productions.findIndex(
      (production) => production.productionid === productionId
    );
    if (matchedProductionIndex != -1) {
      if (this.productions.splice(matchedProductionIndex, 1)) {
        return productionId;
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  setLineId(
    productionid: string,
    lineId: string,
    lineSmbId: string
  ): Line | undefined {
    const matchedProduction = this.getProduction(productionid);
    if (matchedProduction) {
      const line = this.getLine(matchedProduction.lines, lineId);
      if (line) {
        line.smbid = lineSmbId;
        return line;
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  getLine(lines: Line[], lineId: string): Line | undefined {
    const matchedLine = lines.find((line) => line.id === lineId);
    if (matchedLine) {
      return matchedLine;
    }
    return undefined;
  }

  addConnectionToLine(
    productionId: string,
    lineId: string,
    endpointDescription: SmbEndpointDescription,
    endpointId: string,
    sessionId: string
  ): void {
    const production = this.getProduction(productionId);
    if (production) {
      const matchedLine = production.lines.find((line) => line.id === lineId);
      if (matchedLine) {
        matchedLine.connections[sessionId] = {
          sessionDescription: endpointDescription,
          endpointId: endpointId,
          isActive: true
        };
      } else {
        throw new Error(
          `Adding connection failed, Line ${lineId} does not exist`
        );
      }
    } else {
      throw new Error(
        `Adding connection failed, Production ${productionId} does not exist`
      );
    }
  }

  removeConnectionFromLine(
    productionId: string,
    lineId: string,
    sessionId: string
  ): string | undefined {
    const production = this.getProduction(productionId);
    if (production) {
      const matchedLine = production.lines.find((line) => line.id === lineId);
      if (matchedLine?.connections) {
        delete matchedLine.connections[sessionId];
        return sessionId;
      } else {
        throw new Error(
          `Deleting connection failed, Line ${lineId} does not exist`
        );
      }
    } else {
      throw new Error(
        `Deleting connection failed, Production ${productionId} does not exist`
      );
    }
  }

  createUserSession(
    productionId: string,
    lineId: string,
    sessionId: string,
    name: string
  ): void {
    this.userSessions[sessionId] = {
      productionId,
      lineId,
      name,
      lastSeen: new Date()
    };
    this.emit('users:change');
  }

  updateUserLastSeen(sessionId: string): boolean {
    const userSession = this.userSessions[sessionId];
    if (userSession) {
      this.userSessions[sessionId].lastSeen = new Date();
      return true;
    }
    return false;
  }

  removeUserSession(sessionId: string): string | undefined {
    if (sessionId in this.userSessions) {
      delete this.userSessions[sessionId];
      this.emit('users:change');
      return sessionId;
    }
    return undefined;
  }

  getUsersForLine(productionId: string, lineId: string): User[] {
    return Object.entries(this.userSessions).flatMap(
      ([sessionid, userSession]) => {
        if (
          productionId === userSession.productionId &&
          lineId === userSession.lineId &&
          userSession.lastSeen.getTime() >=
            new Date().getTime() - USER_DISCONNECTED_THRESHOLD
        ) {
          const isActive =
            userSession.lastSeen.getTime() >=
            new Date().getTime() - USER_INACTIVE_THRESHOLD;

          return {
            sessionid,
            name: userSession.name,
            isActive
          };
        }
        return [];
      }
    );
  }
}
