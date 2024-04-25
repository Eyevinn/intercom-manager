import { EventEmitter } from 'events';

import {
  NewProduction,
  Production,
  Line,
  SmbEndpointDescription,
  UserSession,
  User
} from './models';
import { assert } from './utils';
import dbManager from './db_manager';

const SESSION_INACTIVE_THRESHOLD = 60_000;
const SESSION_EXPIRED_THRESHOLD = 120_000;
const SESSION_PRUNE_THRESHOLD = 7_200_000;

export class ProductionManager extends EventEmitter {
  private userSessions: Record<string, UserSession>;

  constructor() {
    super();
    this.userSessions = {};
  }

  async load(): Promise<void> {
    dbManager.connect();
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

  async createProduction(
    newProduction: NewProduction
  ): Promise<Production | undefined> {
    const newProductionLines: Line[] = [];

    let index = 0;
    for (const line of newProduction.lines) {
      index++;
      const newProductionLine: Line = {
        name: line.name,
        id: index.toString(),
        smbconferenceid: ''
      };
      newProductionLines.push(newProductionLine);
    }

    return dbManager.addProduction(newProduction.name, newProductionLines);
  }

  async getProductions(limit = 0): Promise<Production[]> {
    return dbManager.getProductions(limit);
  }

  async getProduction(id: number): Promise<Production | undefined> {
    return dbManager.getProduction(id);
  }

  async requireProduction(id: number): Promise<Production> {
    const production = await this.getProduction(id);
    assert(production, 'Trying to get a production that does not exist');
    return production;
  }

  /**
   * Delete the production from the db and local cache
   */
  async deleteProduction(productionId: string): Promise<boolean> {
    return dbManager.deleteProduction(productionId);
  }

  async setLineId(
    productionid: number,
    lineId: string,
    lineSmbId: string
  ): Promise<Line | undefined> {
    const matchedProduction = await this.getProduction(productionid);
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

  getUser(sessionId: string): UserSession | undefined {
    const userSession = this.userSessions[sessionId];
    if (userSession) {
      return userSession;
    }
    return undefined;
  }

  updateUserLastSeen(sessionId: string): boolean {
    const userSession = this.userSessions[sessionId];
    if (userSession) {
      this.userSessions[sessionId].lastSeen = Date.now();
      return true;
    }
    return false;
  }

  updateUserEndpoint(
    sessionId: string,
    endpointId: string,
    sessionDescription: SmbEndpointDescription
  ): boolean {
    const userSession = this.userSessions[sessionId];
    if (userSession) {
      this.userSessions[sessionId].endpointId = endpointId;
      this.userSessions[sessionId].sessionDescription = sessionDescription;
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
