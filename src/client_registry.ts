import { v4 as uuidv4 } from 'uuid';
import { DbManager } from './db/interface';
import { Log } from './log';
import { ClientDocument } from './models/client';
import { generateToken } from './auth/jwt';

export class ClientRegistry {
  private dbManager: DbManager;

  constructor(dbManager: DbManager) {
    this.dbManager = dbManager;
  }

  /**
   * Register a new client or re-register an existing one.
   * If existingClientId is provided and found in DB, reuses that identity.
   * Returns the client document and a fresh JWT token.
   */
  async register(
    name: string,
    role: string,
    location: string,
    existingClientId?: string
  ): Promise<{ client: ClientDocument; token: string }> {
    const now = new Date().toISOString();

    // Try to re-register with existing ID
    if (existingClientId) {
      const existing = await this.dbManager.getClient(existingClientId);
      if (existing) {
        // Update metadata in case it changed
        const updated = await this.dbManager.updateClient(existingClientId, {
          name,
          role,
          location,
          isOnline: true,
          lastSeenAt: now
        });
        if (updated) {
          const token = generateToken(
            updated._id,
            updated.name,
            updated.role,
            updated.location
          );
          Log().info(
            `Client re-registered: ${updated._id} (${updated.name})`
          );
          return { client: updated, token };
        }
      }
      Log().warn(
        `Existing client ID ${existingClientId} not found, creating new registration`
      );
    }

    // Create new client
    const clientId = uuidv4();
    const client: ClientDocument = {
      _id: clientId,
      docType: 'client',
      name,
      role,
      location,
      isOnline: true,
      lastSeenAt: now,
      createdAt: now
    };

    await this.dbManager.saveClient(client);
    const token = generateToken(clientId, name, role, location);
    Log().info(`New client registered: ${clientId} (${name})`);
    return { client, token };
  }

  /**
   * Get a single client by ID.
   */
  async getClient(clientId: string): Promise<ClientDocument | null> {
    return this.dbManager.getClient(clientId);
  }

  /**
   * Update a client's metadata.
   */
  async updateClient(
    clientId: string,
    updates: { name?: string; role?: string; location?: string }
  ): Promise<ClientDocument | null> {
    return this.dbManager.updateClient(clientId, {
      ...updates,
      lastSeenAt: new Date().toISOString()
    });
  }

  /**
   * Get all currently online clients.
   */
  async listOnlineClients(): Promise<ClientDocument[]> {
    return this.dbManager.getOnlineClients();
  }

  /**
   * Mark a client as online.
   */
  async setOnline(clientId: string): Promise<void> {
    await this.dbManager.updateClient(clientId, {
      isOnline: true,
      lastSeenAt: new Date().toISOString()
    });
  }

  /**
   * Mark a client as offline.
   */
  async setOffline(clientId: string): Promise<void> {
    await this.dbManager.updateClient(clientId, {
      isOnline: false,
      lastSeenAt: new Date().toISOString()
    });
  }
}
