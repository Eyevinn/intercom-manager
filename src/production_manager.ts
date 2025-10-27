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
const SESSION_EXPIRED_THRESHOLD = 100_000;

// Sessions are changed from active to inactive after a minute, and are marked as expired after ~100 s.
// Long-term pruning now happens via the Mongo TTL index configured with SESSION_PRUNE_SECONDS in mongodb.ts.
const WHIP_START_MS = parseInt(process.env.WHIP_WARMUP_MS ?? '15000', 10);
const WHIP_INACTIVE_ALLOW_MS = parseInt(
  process.env.WHIP_INACTIVE_ALLOW_MS ?? '10000',
  10
);
const WHIP_ABSENCE_ALLOW_MS = parseInt(
  process.env.WHIP_ABSENCE_ALLOW_MS ?? '30000',
  10
);
const WHIP_EXPIRE_RETRIES = parseInt(
  process.env.WHIP_EXPIRE_RETRIES ?? '3',
  10
);

export class ProductionManager extends EventEmitter {
  private userSessions: Record<string, UserSession>;
  private dbManager: DbManager;
  private whipRetries: Record<string, number> = {};
  private static readonly WHIP_EXPIRE_CONSECUTIVE_MISSES = parseInt(
    process.env.WHIP_EXPIRE_CONSECUTIVE_MISSES ?? '3',
    10
  );

  constructor(dbManager: DbManager) {
    super();
    this.dbManager = dbManager;
    this.userSessions = {};
  }

  async load(): Promise<void> {
    // empty for now
  }

  async checkUserStatus(
    smb: SmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string
  ) {
    let hasChanged = false;
    const now = Date.now();
    const inactiveCutoff = new Date(now - SESSION_INACTIVE_THRESHOLD);
    const expiredCutoff = new Date(now - SESSION_EXPIRED_THRESHOLD);

    {
      // Get sessions that should be inactive
      const toInactivate = await this.dbManager.getSessionsByQuery({
        isWhip: { $ne: true } as any,
        isExpired: false,
        isActive: true,
        lastSeenAt: { $gte: expiredCutoff, $lt: inactiveCutoff } as any
      });

      if (toInactivate.length) {
        const results = await Promise.all(
          (toInactivate as any[]).map((s) =>
            this.dbManager.updateSession(String(s._id), { isActive: false })
          )
        );
        if (results.some(Boolean)) hasChanged = true;
      }

      // Get sessions that should be active
      const toReactivate = await this.dbManager.getSessionsByQuery({
        isWhip: { $ne: true } as any,
        isExpired: false,
        isActive: false,
        lastSeenAt: { $gte: inactiveCutoff } as any
      });

      if (toReactivate.length) {
        const results = await Promise.all(
          (toReactivate as any[]).map((s) =>
            this.dbManager.updateSession(String(s._id), { isActive: true })
          )
        );
        if (results.some(Boolean)) hasChanged = true;
      }

      // Get sessions that should be expired
      const toExpire = await this.dbManager.getSessionsByQuery({
        isWhip: { $ne: true } as any,
        isExpired: false,
        lastSeenAt: { $lt: expiredCutoff } as any
      });

      if (toExpire.length) {
        const results = await Promise.all(
          (toExpire as any[]).map((s) =>
            this.dbManager.updateSession(String(s._id), {
              isExpired: true,
              isActive: false
            })
          )
        );
        if (results.some(Boolean)) hasChanged = true;
      }
    }

    try {
      const conferences = await smb.getConferencesWithUsers(
        smbServerUrl,
        smbServerApiKey
      );

      const conferenceUsers = new Map<string, Set<string>>();
      for (const conference of conferences as any[]) {
        const set = new Set<string>();
        const users = (conference.users ?? []) as any[];
        const endpoints = (conference.endpoints ?? []) as any[];
        for (const user of users) set.add(user.toString().toLowerCase());
        for (const endpoint of endpoints)
          set.add(endpoint.toString().toLowerCase());
        conferenceUsers.set(conference.id.toString(), set);
      }

      // Handling of WHIP sessions
      const whipSessions = await this.dbManager.getSessionsByQuery({
        isWhip: true,
        isExpired: false
      });

      for (const whipSession of whipSessions as any[]) {
        const wid = whipSession._id.toString();
        const createdMs = whipSession.createdAt
          ? new Date(whipSession.createdAt).getTime()
          : now;
        const lastSeenMs = whipSession.lastSeenAt
          ? new Date(whipSession.lastSeenAt).getTime()
          : typeof whipSession.lastSeen === 'number'
          ? whipSession.lastSeen
          : createdMs;

        if (now - createdMs < WHIP_START_MS) {
          const ok = await this.dbManager.updateSession(wid, {
            lastSeen: now + 10_000,
            isActive: true,
            isExpired: false
          });
          if (ok) {
            hasChanged = true;
            if (this.userSessions[wid]) {
              this.userSessions[wid].lastSeen = now + 10_000;
              this.userSessions[wid].isActive = true;
              this.userSessions[wid].isExpired = false;
            }
            this.whipRetries[wid] = 0;
          }
          continue;
        }

        // Pull the latest presence list for this conference and look up the WHIP endpoint's key
        const set = conferenceUsers.get(whipSession.smbConferenceId.toString());
        const key = (
          (whipSession as any).smbPresenceKey ||
          whipSession.endpointId ||
          ''
        )
          .toString()
          .toLowerCase();

        const present = !!(set && key && set.has(key));

        if (present) {
          this.whipRetries[wid] = 0;
          const ok = await this.dbManager.updateSession(wid, {
            lastSeen: now + 10_000,
            isActive: true,
            isExpired: false
          });
          if (ok) {
            hasChanged = true;
            if (this.userSessions[wid]) {
              this.userSessions[wid].lastSeen = now + 10_000;
              this.userSessions[wid].isActive = true;
              this.userSessions[wid].isExpired = false;
            }
          }
        } else {
          const retries = (this.whipRetries[wid] ?? 0) + 1;
          this.whipRetries[wid] = retries;

          if (
            whipSession.isActive &&
            now - lastSeenMs > WHIP_INACTIVE_ALLOW_MS
          ) {
            const ok = await this.dbManager.updateSession(wid, {
              isActive: false
            });
            if (ok) {
              hasChanged = true;
            }
          }

          // If max retry attempts have failed, remove the WHIP session
          if (
            now - lastSeenMs > WHIP_ABSENCE_ALLOW_MS &&
            retries >= WHIP_EXPIRE_RETRIES
          ) {
            const ok = await this.dbManager.updateSession(wid, {
              isExpired: true
            });
            if (ok) hasChanged = true;
          }
        }
      }
    } catch (e) {
      Log().warn('checkUserStatus (WHIP) failed', e);
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

  async createUserSession(
    smbConferenceId: string,
    productionId: string,
    lineId: string,
    sessionId: string,
    name: string,
    isWhip = false
  ): Promise<void> {
    const userSession: UserSession = {
      _id: sessionId,
      smbConferenceId,
      productionId,
      lineId,
      name,
      lastSeen: isWhip ? Date.now() + 20000 : Date.now(),
      isActive: true,
      isExpired: false,
      isWhip
    };

    this.userSessions[sessionId] = userSession;

    await this.dbManager.saveUserSession(sessionId, userSession);

    Log().info(`Created user session: "${name}": ${sessionId}`);
    this.emit('users:change');
  }

  async getActiveUsers(productionId: string) {
    return this.dbManager.getSessionsByQuery({ productionId, isActive: true });
  }

  getUser(sessionId: string): UserSession | undefined {
    const userSession = this.userSessions[sessionId];
    if (userSession) {
      return userSession;
    }
    return undefined;
  }

  async updateUserLastSeen(
    sessionId: string,
    includeBuffer = false
  ): Promise<boolean> {
    const lastSeen = includeBuffer ? Date.now() + 10_000 : Date.now();
    const ok = await this.dbManager.updateSession(sessionId, {
      lastSeen,
      isActive: true,
      isExpired: false
    });
    if (ok) {
      if (this.userSessions[sessionId]) {
        this.userSessions[sessionId].lastSeen = lastSeen;
        this.userSessions[sessionId].isActive = true;
        this.userSessions[sessionId].isExpired = false;
      }
      this.emit('users:change');
    }
    return ok;
  }

  // Update user session in database
  async updateUserEndpoint(
    sessionId: string,
    endpointId: string,
    sessionDescription: SmbEndpointDescription
  ): Promise<boolean> {
    const userSession = this.userSessions[sessionId];
    if (userSession) {
      userSession.endpointId = endpointId;
      userSession.sessionDescription = sessionDescription;
      const smbPresenceKey = endpointId.toLowerCase();

      (userSession as any).smbPresenceKey = smbPresenceKey;

      const ok = await this.dbManager.updateSession(sessionId, {
        endpointId,
        sessionDescription,
        isActive: true,
        isExpired: false,
        lastSeen: Date.now(),
        ...({ smbPresenceKey } as any)
      });

      if (ok) this.emit('users:change');
      return ok;
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

  async getUsersForLine(
    productionId: string,
    lineId: string
  ): Promise<UserResponse[]> {
    const inactiveCutoff = new Date(Date.now() - SESSION_INACTIVE_THRESHOLD);

    const dbSessions = await this.dbManager.getSessionsByQuery({
      productionId,
      lineId,
      isExpired: false,
      $or: [{ isWhip: true }, { lastSeenAt: { $gte: inactiveCutoff } as any }]
    } as any);

    const participants = (dbSessions as any[]).map((s) => {
      const u: any = {
        sessionId: s._id?.toString?.() ?? '',
        name: s.name ?? '',
        isActive: s.isWhip ? true : !!s.isActive,
        isWhip: !!s.isWhip
      };
      if (typeof s.endpointId === 'string' && s.endpointId.length > 0)
        u.endpointId = s.endpointId;
      return u as UserResponse;
    });

    participants.sort((a, b) => {
      const nameA = a.name?.toLocaleLowerCase?.() ?? '';
      const nameB = b.name?.toLocaleLowerCase?.() ?? '';
      if (nameA || nameB) {
        const cmp =
          nameA.localeCompare(nameB, undefined, { sensitivity: 'base' }) || 0;
        if (cmp !== 0) return cmp;
      }
      return (a.sessionId ?? '').localeCompare(b.sessionId ?? '');
    });

    return participants;
  }
}
