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
import { Log } from './log';
import { DbManager } from './db/interface';
import { SmbProtocol } from './smb';

const SESSION_INACTIVE_THRESHOLD = 60_000;
const SESSION_EXPIRED_THRESHOLD = 120_000;
const SESSION_PRUNE_THRESHOLD = 7_200_000;

export class ProductionManager extends EventEmitter {
  private userSessions: Record<string, UserSession>;
  private dbManager: DbManager;
  private userSessionsInterval: NodeJS.Timeout | undefined;

  constructor(dbManager: DbManager) {
    super();
    this.dbManager = dbManager;
    this.userSessions = {};
    this.userSessionsInterval = undefined;
  }

  async load(): Promise<void> {
    // empty for now
  }

  checkUserStatus(
    smb: SmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string
  ) {
    let hasChanged = false;
    const userSessionsArray = Object.entries(this.userSessions);
    const activeWhipSessions = userSessionsArray.filter(
      ([, userSession]) => userSession.isWhip
    );

    if (activeWhipSessions.length !== 0 && !this.userSessionsInterval) {
      this.userSessionsInterval = setInterval(async () => {
        const conferences = await smb.getConferencesWithUsers(
          smbServerUrl,
          smbServerApiKey
        );
        // Needs to be redefined for scope
        const innerUserSessionsArray = Object.entries(this.userSessions);
        const innerActiveWhipSessions = innerUserSessionsArray.filter(
          ([, userSession]) => userSession.isWhip
        );
        for (const [sessionId, userSession] of innerActiveWhipSessions) {
          const conference = conferences.find(
            (conference) => conference.id === userSession.smbConferenceId
          );
          if (
            conference &&
            userSession.endpointId &&
            conference.users.includes(userSession.endpointId)
          ) {
            this.updateUserLastSeen(sessionId, true);
          }
        }
      }, 60_000);
    } else if (activeWhipSessions.length === 0 && this.userSessionsInterval) {
      clearInterval(this.userSessionsInterval);
      this.userSessionsInterval = undefined;
    }

    for (const [sessionId, userSession] of userSessionsArray) {
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
        if (userSession.isWhip && isExpired) {
          this.removeUserSession(sessionId);
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
        smbConferenceId: '',
        programOutputLine: line.programOutputLine || false
      };
      newProductionLines.push(newProductionLine);
    }

    return this.dbManager.addProduction(newProduction.name, newProductionLines);
  }

  async updateProduction(
    production: Production,
    productionName: string
  ): Promise<Production | undefined> {
    production.name = productionName;
    return this.dbManager.updateProduction(production);
  }

  async addProductionLine(
    production: Production,
    newLineName: string,
    programOutputLine: boolean
  ): Promise<Production | undefined> {
    const nextLineId = production.lines.length
      ? Math.max(...production.lines.map((line) => parseInt(line.id, 10))) + 1
      : 1;

    production.lines.push({
      name: newLineName,
      id: nextLineId.toString(),
      smbConferenceId: '',
      programOutputLine: programOutputLine || false
    });

    return this.dbManager.updateProduction(production);
  }

  async updateProductionLine(
    production: Production,
    lineId: string,
    lineName: string
  ): Promise<Production | undefined> {
    const line = production.lines.find((line) => line.id === lineId);
    if (line) {
      line.name = lineName;
      return this.dbManager.updateProduction(production);
    }
    return undefined;
  }

  async deleteProductionLine(
    production: Production,
    lineId: string
  ): Promise<Production | undefined> {
    const lineIndex = production.lines.findIndex((line) => line.id === lineId);
    if (lineIndex !== -1) {
      production.lines.splice(lineIndex, 1);
      return this.dbManager.updateProduction(production);
    }
    return undefined;
  }

  async getProductions(limit = 0, offset = 0): Promise<Production[]> {
    return this.dbManager.getProductions(limit, offset);
  }

  async getNumberOfProductions(): Promise<number> {
    return this.dbManager.getProductionsLength();
  }

  async getProduction(id: number): Promise<Production | undefined> {
    return this.dbManager.getProduction(id);
  }

  async requireProduction(id: number): Promise<Production> {
    const production = await this.getProduction(id);
    assert(production, 'Trying to get a production that does not exist');
    return production;
  }

  /**
   * Delete the production from the db and local cache
   */
  async deleteProduction(productionId: number): Promise<boolean> {
    return this.dbManager.deleteProduction(productionId);
  }

  async setLineId(
    productionId: number,
    lineId: string,
    lineSmbId: string
  ): Promise<Line | undefined> {
    const matchedProduction = await this.getProduction(productionId);
    if (matchedProduction) {
      const line = this.getLine(matchedProduction.lines, lineId);
      if (line) {
        line.smbConferenceId = lineSmbId;
        await this.dbManager.setLineConferenceId(
          productionId,
          lineId,
          lineSmbId
        );
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
    smbConferenceId: string,
    productionId: string,
    lineId: string,
    sessionId: string,
    name: string,
    isWhip = false
  ): void {
    this.userSessions[sessionId] = {
      smbConferenceId,
      productionId,
      lineId,
      name,
      lastSeen: isWhip ? Date.now() + 20000 : Date.now(),
      isActive: true,
      isExpired: false,
      isWhip
    };
    Log().info(`Created user session: "${name}": ${sessionId}`);
    this.emit('users:change');
  }

  getUser(sessionId: string): UserSession | undefined {
    const userSession = this.userSessions[sessionId];
    if (userSession) {
      return userSession;
    }
    return undefined;
  }

  updateUserLastSeen(sessionId: string, includeBuffer = false): boolean {
    const userSession = this.userSessions[sessionId];
    if (userSession) {
      this.userSessions[sessionId].lastSeen = includeBuffer
        ? Date.now() + 10000
        : Date.now();
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
      ([sessionId, userSession]) => {
        if (
          productionId === userSession.productionId &&
          lineId === userSession.lineId &&
          !userSession.isExpired
        ) {
          return {
            sessionId,
            endpointId: userSession.endpointId,
            name: userSession.name,
            isActive: userSession.isActive,
            isWhip: userSession.isWhip
          };
        }
        return [];
      }
    );
  }
}
