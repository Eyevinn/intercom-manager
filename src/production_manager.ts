import { EventEmitter } from 'events';

import {
  NewProduction,
  Production,
  Line,
  SmbEndpointDescription,
  UserResponse,
  UserSession
} from './models';
import { assert } from './utils';
import dbManager from './db_manager';

const SESSION_INACTIVE_THRESHOLD = 60_000;
const SESSION_EXPIRED_THRESHOLD = 120_000;
const SESSION_PRUNE_THRESHOLD = 7_200_000;

export class ProductionManager extends EventEmitter {
  private activeProductions: Production[];
  private userSessions: Record<string, UserSession>;

  constructor() {
    super();
    this.activeProductions = [];
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

  async getProductionCount(): Promise<number> {
    // TODO: Move to jest mock (dbProductionCount will never actually be undefined, this fallback is just for Jest)
    const dbProductionCount = await dbManager.getProductionCount();
    if (dbProductionCount !== undefined) {
      return dbProductionCount;
    }
    const productionIds = this.activeProductions.map((production) =>
      parseInt(production.productionid, 10)
    );
    return Math.max(...productionIds, 0);
  }

  async createProduction(
    newProduction: NewProduction
  ): Promise<Production | undefined> {
    const productionCount = await this.getProductionCount();
    const productionId = (productionCount + 1).toString();

    assert(
      !(await this.getProduction(productionId)),
      `Create production failed, Production with id "${productionId}" already exists`
    );
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

    const production: Production = {
      name: newProduction.name,
      productionid: productionId,
      lines: newProductionLines
    };
    if (production) {
      this.activeProductions.push(production);
      await dbManager.addProduction(production);
      return production;
    }
  }

  /**
   * Get a list of the productions stored in memory
   */
  getActiveProductions(): Production[] {
    return this.activeProductions;
  }

  async getProduction(productionid: string): Promise<Production | undefined> {
    let production = this.activeProductions.find(
      (production) => production.productionid === productionid
    );

    if (!production) {
      production = await dbManager.getProduction(productionid);

      if (production) {
        this.activeProductions.push(production);
      }
    }

    return production;
  }

  async requireProduction(productionid: string): Promise<Production> {
    const production = await this.getProduction(productionid);
    assert(production, 'Trying to get a production that does not exist');
    return production;
  }

  /**
   * Delete the cached in memory production if it exists
   */
  deleteActiveProduction(productionId: string): boolean {
    const matchedProductionIndex = this.activeProductions.findIndex(
      (production) => production.productionid === productionId
    );
    if (matchedProductionIndex !== -1) {
      this.activeProductions.splice(matchedProductionIndex, 1);
      return true;
    }
    return false;
  }

  /**
   * Delete the production from the db and local cache
   */
  async deleteProduction(productionId: string): Promise<boolean> {
    const dbDeleted = await dbManager.deleteProduction(productionId);
    const localDeleted = this.deleteActiveProduction(productionId);
    // TODO: just returning dbDeleted should be enough, but it is not for the unit tests
    return dbDeleted || localDeleted;
  }

  async setLineId(
    productionid: string,
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

  getUsersForLine(productionId: string, lineId: string): UserResponse[] {
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
