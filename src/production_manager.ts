import { EventEmitter } from 'events';

import {
  NewProduction,
  Production,
  Line,
  SmbEndpointDescription,
  UserSession,
  User
} from './models';

const SESSION_INACTIVE_THRESHOLD = 60_000;
const SESSION_EXPIRED_THRESHOLD = 120_000;
const SESSION_PRUNE_THRESHOLD = 7_200_000;

export class ProductionManager extends EventEmitter {
  private productions: Production[];
  private userSessions: Record<string, UserSession>;

  constructor() {
    super();
    this.productions = [];
    this.userSessions = {};
  }

  checkUserStatus(): void {
    let hasChanged = false;
    for (const [sessionId, userSession] of Object.entries(this.userSessions)) {
      if (userSession.lastSeen < Date.now() - SESSION_PRUNE_THRESHOLD) {
        delete this.userSessions[sessionId];
        hasChanged = true;
      } else {
        const isActive =
          userSession.lastSeen > Date.now() - SESSION_INACTIVE_THRESHOLD;
        const isExpired =
          userSession.lastSeen < Date.now() - SESSION_EXPIRED_THRESHOLD;
        if (
          isActive !== userSession.isActive ||
          isExpired !== userSession.isExpired
        ) {
          Object.assign(userSession, { isActive, isExpired });
          hasChanged = true;
        }
      }
    }
    if (hasChanged) {
      this.emit('users:change');
    }
  }

  createProduction(newProduction: NewProduction): Production | undefined {
    const productionIds = this.productions.map((production) =>
      parseInt(production.productionid, 10)
    );
    const productionId = (Math.max(...productionIds, 0) + 1).toString();
    if (!this.getProduction(productionId)) {
      const newProductionLines: Line[] = [];

      let index = 0;
      for (const line of newProduction.lines) {
        index++;
        const newProductionLine: Line = {
          name: line.name,
          id: index.toString(),
          smbconferenceid: '',
          connections: {}
        };
        newProductionLines.push(newProductionLine);
      }

      const production: Production = {
        name: newProduction.name,
        productionid: productionId,
        lines: newProductionLines
      };
      this.productions.push(production);
      return production;
    } else {
      throw new Error(
        `Create production failed, Production with id "${productionId}" already exists`
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
        line.smbconferenceid = lineSmbId;
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
        if (!this.removeUserSession(sessionId)) {
          throw new Error(
            `Deleting userSession failed, Session ${sessionId} does not exist`
          );
        }
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
      lastSeen: Date.now(),
      isActive: true,
      isExpired: false
    };
    console.log(`Created user session: "${name}": ${sessionId}`);
    this.emit('users:change');
  }

  updateUserLastSeen(sessionId: string): boolean {
    const userSession = this.userSessions[sessionId];
    if (userSession) {
      this.userSessions[sessionId].lastSeen = Date.now();
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
          !userSession.isExpired
        ) {
          return {
            sessionid,
            name: userSession.name,
            isActive: userSession.isActive
          };
        }
        return [];
      }
    );
  }
}
