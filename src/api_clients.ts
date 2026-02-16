import { FastifyPluginCallback } from 'fastify';
import { ClientRegistry } from './client_registry';
import { requireAuth } from './auth/middleware';
import { Log } from './log';
import {
  ClientRegistrationRequest,
  ClientRegistrationResponse,
  ClientProfileResponse,
  ClientUpdateRequest,
  ClientListResponse
} from './models/client';

export interface ApiClientsOptions {
  clientRegistry: ClientRegistry;
}

export const getApiClients = (): FastifyPluginCallback<ApiClientsOptions> => {
  return (fastify, opts, next) => {
    const { clientRegistry } = opts;

    /**
     * POST /api/v1/client/register
     * Register a new client or re-register an existing one.
     * No authentication required (this is how you GET a token).
     */
    fastify.post<{
      Body: typeof ClientRegistrationRequest.static;
      Reply: typeof ClientRegistrationResponse.static;
    }>(
      '/client/register',
      {
        config: {
          rateLimit: {
            max: 10,
            timeWindow: '1 minute'
          }
        },
        schema: {
          description: 'Register a new client or re-register an existing one',
          body: ClientRegistrationRequest,
          response: {
            200: ClientRegistrationResponse
          }
        }
      },
      async (request, reply) => {
        const { name, role, location, existingClientId } = request.body;

        try {
          const { client, token } = await clientRegistry.register(
            name.trim(),
            role.trim(),
            location.trim(),
            existingClientId
          );

          reply.send({
            clientId: client._id,
            token,
            name: client.name,
            role: client.role,
            location: client.location
          });
        } catch (err: any) {
          Log().error(`Registration failed: ${err.message}`);
          reply.code(500).send({ message: 'Registration failed' } as any);
        }
      }
    );

    /**
     * GET /api/v1/client/me
     * Get own profile. Requires authentication.
     */
    fastify.get<{
      Reply: typeof ClientProfileResponse.static;
    }>(
      '/client/me',
      {
        preHandler: requireAuth,
        schema: {
          description: 'Get own client profile',
          response: {
            200: ClientProfileResponse
          }
        }
      },
      async (request, reply) => {
        const clientId = request.client!.clientId;
        const client = await clientRegistry.getClient(clientId);

        if (!client) {
          reply.code(404).send({ message: 'Client not found' } as any);
          return;
        }

        reply.send({
          clientId: client._id,
          name: client.name,
          role: client.role,
          location: client.location,
          isOnline: client.isOnline,
          lastSeenAt: client.lastSeenAt
        });
      }
    );

    /**
     * PATCH /api/v1/client/me
     * Update own metadata. Requires authentication.
     */
    fastify.patch<{
      Body: typeof ClientUpdateRequest.static;
      Reply: typeof ClientProfileResponse.static;
    }>(
      '/client/me',
      {
        preHandler: requireAuth,
        schema: {
          description: 'Update own client metadata',
          body: ClientUpdateRequest,
          response: {
            200: ClientProfileResponse
          }
        }
      },
      async (request, reply) => {
        const clientId = request.client!.clientId;
        const updates: Record<string, string> = {};
        if (request.body.name) updates.name = request.body.name.trim();
        if (request.body.role) updates.role = request.body.role.trim();
        if (request.body.location) updates.location = request.body.location.trim();

        const updated = await clientRegistry.updateClient(clientId, updates);

        if (!updated) {
          reply.code(404).send({ message: 'Client not found' } as any);
          return;
        }

        reply.send({
          clientId: updated._id,
          name: updated.name,
          role: updated.role,
          location: updated.location,
          isOnline: updated.isOnline,
          lastSeenAt: updated.lastSeenAt
        });
      }
    );

    /**
     * GET /api/v1/client/list
     * List all online clients. Requires authentication.
     */
    fastify.get<{
      Reply: typeof ClientListResponse.static;
    }>(
      '/client/list',
      {
        preHandler: requireAuth,
        config: {
          rateLimit: {
            max: 30,
            timeWindow: '1 minute'
          }
        },
        schema: {
          description: 'List all online clients with metadata',
          response: {
            200: ClientListResponse
          }
        }
      },
      async (_request, reply) => {
        const clients = await clientRegistry.listOnlineClients();
        reply.send(
          clients.map((c) => ({
            clientId: c._id,
            name: c.name,
            role: c.role,
            location: c.location,
            isOnline: c.isOnline,
            lastSeenAt: c.lastSeenAt
          }))
        );
      }
    );

    /**
     * GET /api/v1/client/:clientId
     * Get a specific client's profile. Requires authentication.
     */
    fastify.get<{
      Params: { clientId: string };
      Reply: typeof ClientProfileResponse.static;
    }>(
      '/client/:clientId',
      {
        preHandler: requireAuth,
        schema: {
          description: 'Get a specific client profile',
          response: {
            200: ClientProfileResponse
          }
        }
      },
      async (request, reply) => {
        const { clientId } = request.params;
        const client = await clientRegistry.getClient(clientId);

        if (!client) {
          reply.code(404).send({ message: 'Client not found' } as any);
          return;
        }

        reply.send({
          clientId: client._id,
          name: client.name,
          role: client.role,
          location: client.location,
          isOnline: client.isOnline,
          lastSeenAt: client.lastSeenAt
        });
      }
    );

    next();
  };
};
