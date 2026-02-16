import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { verifyToken, JwtPayload } from '../auth/jwt';
import { ClientRegistry } from '../client_registry';
import { TalkManager } from '../talk_manager';
import { Log } from '../log';

interface ConnectedClient {
  ws: WebSocket;
  clientId: string;
  name: string;
  role: string;
  location: string;
  connectedAt: string;
}

export interface StatusEvent {
  type:
    | 'client_connected'
    | 'client_disconnected'
    | 'client_list'
    // M2 call events
    | 'call_incoming'
    | 'call_started'
    | 'call_ended'
    // M3 talk events
    | 'talk_started'
    | 'talk_stopped'
    | 'active_talks';
  client?: {
    clientId: string;
    name: string;
    role: string;
    location: string;
  };
  clients?: Array<{
    clientId: string;
    name: string;
    role: string;
    location: string;
  }>;
  timestamp: string;
  // Allow additional fields for call events (callId, callerId, etc.)
  [key: string]: any;
}

export class StatusManager {
  private connections: Map<string, ConnectedClient> = new Map();
  private clientRegistry: ClientRegistry;
  private talkManager: TalkManager | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private onDisconnectCallback?: (clientId: string) => void;

  constructor(clientRegistry: ClientRegistry) {
    this.clientRegistry = clientRegistry;
  }

  /**
   * Set the TalkManager instance (M3).
   * Called after construction since TalkManager depends on CallManager
   * which is created after StatusManager.
   */
  setTalkManager(talkManager: TalkManager): void {
    this.talkManager = talkManager;
  }

  /**
   * Register a callback that fires when a client disconnects.
   * Used by server.ts to wire call cleanup on disconnect (M2).
   */
  setOnDisconnectCallback(callback: (clientId: string) => void): void {
    this.onDisconnectCallback = callback;
  }

  /**
   * Send an event to a specific client by their clientId.
   * Used for directed notifications (e.g., call_incoming to callee only).
   */
  sendToClient(clientId: string, event: StatusEvent): void {
    const client = this.connections.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(event));
    } else {
      Log().warn(`Cannot send to client ${clientId}: not connected`);
    }
  }

  /**
   * Register the WebSocket endpoint on the Fastify server.
   * Must be called after @fastify/websocket is registered.
   */
  registerRoutes(fastify: FastifyInstance): void {
    fastify.get(
      '/api/v1/ws',
      { websocket: true },
      (socket: WebSocket, request) => {
        this.handleConnection(socket, request);
      }
    );

    // Start ping/pong health check
    this.startPingInterval();

    Log().info('WebSocket status endpoint registered at /api/v1/ws');
  }

  private handleConnection(ws: WebSocket, request: any): void {
    // Authenticate via query parameter token
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      Log().warn('WebSocket connection rejected: no token provided');
      ws.close(4001, 'Authentication required');
      return;
    }

    let payload: JwtPayload;
    try {
      payload = verifyToken(token);
    } catch (err: any) {
      Log().warn(`WebSocket connection rejected: invalid token — ${err.message}`);
      ws.close(4001, 'Invalid or expired token');
      return;
    }

    const { clientId, name, role, location } = payload;

    // Close any existing connection for this client (reconnect scenario)
    const existing = this.connections.get(clientId);
    if (existing) {
      Log().info(`Client ${clientId} reconnecting, closing old connection`);
      existing.ws.close(4000, 'Replaced by new connection');
      this.connections.delete(clientId);
    }

    // Register the connection
    const connectedClient: ConnectedClient = {
      ws,
      clientId,
      name,
      role,
      location,
      connectedAt: new Date().toISOString()
    };
    this.connections.set(clientId, connectedClient);

    // Mark client online in registry
    this.clientRegistry.setOnline(clientId).catch((err) => {
      Log().error(`Failed to set client ${clientId} online: ${err.message}`);
    });

    Log().info(
      `WebSocket connected: ${clientId} (${name}) — ${this.connections.size} total connections`
    );

    // Send the current client list to the newly connected client
    this.sendClientList(ws);

    // Send active talks snapshot (M3)
    this.sendActiveTalks(ws);

    // Broadcast connection event to all other clients
    this.broadcast(
      {
        type: 'client_connected',
        client: { clientId, name, role, location },
        timestamp: new Date().toISOString()
      },
      clientId
    );

    // Handle messages from client
    ws.on('message', (data: import('ws').RawData) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(clientId, message).catch((err) => {
          Log().error(`Error handling message from ${clientId}: ${err.message}`);
        });
      } catch {
        // Ignore malformed messages
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      this.handleDisconnect(clientId);
    });

    ws.on('error', (err: Error) => {
      Log().error(`WebSocket error for ${clientId}: ${err.message}`);
      this.handleDisconnect(clientId);
    });
  }

  private async handleMessage(clientId: string, message: any): Promise<void> {
    if (message.type === 'pong') {
      // Client responded to our ping — connection is alive
      return;
    }

    // M3: Handle talk_start (PTT pressed)
    if (message.type === 'talk_start' && this.talkManager) {
      if (!Array.isArray(message.callIds) || message.callIds.length === 0) {
        Log().debug(`Invalid talk_start from ${clientId}: missing callIds`);
        return;
      }
      const client = this.connections.get(clientId);
      if (!client) return;

      const talkState = await this.talkManager.handleTalkStart(
        clientId,
        client.name,
        message.callIds
      );
      if (talkState) {
        this.broadcastToAll({
          type: 'talk_started',
          clientId: talkState.clientId,
          clientName: talkState.clientName,
          targets: talkState.targets,
          timestamp: talkState.startedAt
        });
      }
      return;
    }

    // M3: Handle talk_stop (PTT released)
    if (message.type === 'talk_stop' && this.talkManager) {
      const stopped = this.talkManager.handleTalkStop(clientId);
      if (stopped) {
        this.broadcastToAll({
          type: 'talk_stopped',
          clientId: stopped.clientId,
          clientName: stopped.clientName,
          timestamp: new Date().toISOString()
        });
      }
      return;
    }

    Log().debug(`WebSocket message from ${clientId}: ${JSON.stringify(message)}`);
  }

  private handleDisconnect(clientId: string): void {
    const client = this.connections.get(clientId);
    if (!client) return;

    this.connections.delete(clientId);

    // Mark client offline in registry
    this.clientRegistry.setOffline(clientId).catch((err) => {
      Log().error(`Failed to set client ${clientId} offline: ${err.message}`);
    });

    Log().info(
      `WebSocket disconnected: ${clientId} (${client.name}) — ${this.connections.size} total connections`
    );

    // Clean up talk state (M3) — must happen before call cleanup
    // Order per contract 8a: talk_stopped -> call_ended -> client_disconnected
    if (this.talkManager) {
      const stoppedTalk = this.talkManager.removeTalksForClient(clientId);
      if (stoppedTalk) {
        this.broadcast(
          {
            type: 'talk_stopped',
            clientId: stoppedTalk.clientId,
            clientName: stoppedTalk.clientName,
            timestamp: new Date().toISOString()
          },
          clientId
        );
      }
    }

    // Notify disconnect callback (for call cleanup, etc.) — M2
    // This broadcasts call_ended events
    if (this.onDisconnectCallback) {
      this.onDisconnectCallback(clientId);
    }

    // Broadcast disconnect event (last in the sequence)
    this.broadcast(
      {
        type: 'client_disconnected',
        client: {
          clientId: client.clientId,
          name: client.name,
          role: client.role,
          location: client.location
        },
        timestamp: new Date().toISOString()
      },
      clientId
    );
  }

  /**
   * Send the full list of currently connected clients to a specific WebSocket.
   */
  private sendClientList(ws: WebSocket): void {
    const clients = Array.from(this.connections.values()).map((c) => ({
      clientId: c.clientId,
      name: c.name,
      role: c.role,
      location: c.location
    }));

    const event: StatusEvent = {
      type: 'client_list',
      clients,
      timestamp: new Date().toISOString()
    };

    this.safeSend(ws, event);
  }

  /**
   * Send a snapshot of all active talks to a specific WebSocket (M3).
   * Sent alongside client_list on connect/reconnect.
   */
  private sendActiveTalks(ws: WebSocket): void {
    if (!this.talkManager) return;
    const talks = this.talkManager.getActiveTalks();
    const event: StatusEvent = {
      type: 'active_talks',
      talks,
      timestamp: new Date().toISOString()
    };
    this.safeSend(ws, event);
  }

  /**
   * Broadcast an event to all connected clients, optionally excluding one.
   */
  private broadcast(event: StatusEvent, excludeClientId?: string): void {
    const data = JSON.stringify(event);
    for (const [id, client] of this.connections) {
      if (id === excludeClientId) continue;
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  /**
   * Broadcast an event to ALL connected clients (no exclusion).
   */
  broadcastToAll(event: StatusEvent): void {
    this.broadcast(event);
  }

  /**
   * Get the number of currently connected WebSocket clients.
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  private safeSend(ws: WebSocket, event: StatusEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  /**
   * Ping all connections every 30s. Close any that don't respond within 10s.
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      for (const [clientId, client] of this.connections) {
        if (client.ws.readyState !== WebSocket.OPEN) {
          this.handleDisconnect(clientId);
          continue;
        }
        // Use WebSocket protocol-level ping
        try {
          client.ws.ping();
        } catch {
          this.handleDisconnect(clientId);
        }
      }
    }, 30000);
  }

  /**
   * Clean up all connections and intervals.
   */
  destroy(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    for (const [, client] of this.connections) {
      client.ws.close(1001, 'Server shutting down');
    }
    this.connections.clear();
  }
}
