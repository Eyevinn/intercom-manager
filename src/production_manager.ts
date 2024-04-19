import { EventEmitter } from 'events';

import { strict as assert } from 'node:assert';

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
    assert(
      !this.getProduction(productionId),
      `Create production failed, Production with id "${productionId}" already exists`
    );
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
    if (production) {
      this.productions.push(production);
      return production;
    }
  }

  getProductions(): Production[] {
    return this.productions;
  }

  getProduction(productionid: string): Production | undefined {
    return this.productions.find(
      (production) => production.productionid === productionid
    );
  }

  requireProduction(productionid: string): Production {
    const production = this.getProduction(productionid);
    assert(production, 'Trying to get a production that does not exist');
    return production;
  }

  deleteProduction(productionId: string): string | undefined {
    const matchedProductionIndex = this.productions.findIndex(
      (production) => production.productionid === productionId
    );
    if (
      matchedProductionIndex !== -1 &&
      this.productions.splice(matchedProductionIndex, 1)
    ) {
      return productionId;
    }
    return undefined;
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
      }
    }
    return undefined;
  }

  getLine(lines: Line[], lineId: string): Line | undefined {
    return lines.find((line) => line.id === lineId);
  }

  requireLine(productionLines: Line[], lineId: string): Line {
    const line = this.getLine(productionLines, lineId);
    assert(line, 'Trying to get a line that does not exist');
    return line;
  }

  addConnectionToLine(
    productionId: string,
    lineId: string,
    endpointDescription: SmbEndpointDescription,
    endpointId: string,
    sessionId: string
  ): void {
    const production = this.getProduction(productionId);
    assert(
      production,
      `Adding connection failed, Production ${productionId} does not exist`
    );
    const matchedLine = production.lines.find((line) => line.id === lineId);
    assert(
      matchedLine,
      `Adding connection failed, Line ${lineId} does not exist`
    );
    matchedLine.connections[sessionId] = {
      sessionDescription: endpointDescription,
      endpointId: endpointId,
      isActive: true
    };
  }

  removeConnectionFromLine(
    productionId: string,
    lineId: string,
    sessionId: string
  ): string | undefined {
    const production = this.getProduction(productionId);
    assert(
      production,
      `Deleting connection failed, Production ${productionId} does not exist`
    );
    const matchedLine = production.lines.find((line) => line.id === lineId);
    assert(
      matchedLine?.connections,
      `Deleting connection failed, Line ${lineId} does not exist`
    );
    const deletedUserSessionId = this.removeUserSession(sessionId);
    assert(
      deletedUserSessionId,
      `Deleting userSession failed, Session ${sessionId} does not exist`
    );
    delete matchedLine.connections[sessionId];
    return sessionId;
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
