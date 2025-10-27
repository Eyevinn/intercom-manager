import { FastifyPluginCallback } from 'fastify';
import { Type } from '@sinclair/typebox';
import { DbManager } from './db/interface';
import {
  NewReceiver,
  Receiver,
  ReceiverListResponse,
  ReceiverStateChange,
  PatchReceiver,
  BridgeStatus
} from './models';
import { Log } from './log';

export interface ApiBridgeRxOptions {
  dbManager: DbManager;
  whepGatewayUrl: string;
  whepGatewayApiKey?: string;
}

const ParamsId = Type.Object({
  id: Type.String({
    description: 'Receiver ID'
  })
});

const apiBridgeRx: FastifyPluginCallback<ApiBridgeRxOptions> = (
  fastify,
  opts,
  next
) => {
  const { dbManager, whepGatewayUrl, whepGatewayApiKey } = opts;

  // Helper function to call gateway API
  const callGateway = async (
    method: string,
    path: string,
    body?: any
  ): Promise<any> => {
    const url = `${whepGatewayUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (whepGatewayApiKey) {
      headers['x-api-key'] = whepGatewayApiKey;
    }

    const options: RequestInit = {
      method,
      headers
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Gateway request failed: ${response.status} ${errorText}`
      );
    }

    if (response.status === 204) {
      return null;
    }

    const text = await response.text();
    if (!text) {
      return null;
    }

    // Try to parse as JSON, if it fails, return the text as-is
    try {
      return JSON.parse(text);
    } catch (e) {
      // If it's a plain boolean string, convert it
      if (text.toLowerCase() === 'true') return true;
      if (text.toLowerCase() === 'false') return false;
      // Otherwise return the text
      return text;
    }
  };

  // List all receivers
  fastify.get<{
    Querystring: { limit?: string; offset?: string };
    Reply: ReceiverListResponse | { error: string };
  }>(
    '/bridge/rx',
    {
      schema: {
        description: 'List all receivers',
        querystring: Type.Object({
          limit: Type.Optional(Type.String()),
          offset: Type.Optional(Type.String())
        }),
        response: {
          200: ReceiverListResponse,
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const limit = parseInt(request.query.limit || '100', 10);
        const offset = parseInt(request.query.offset || '0', 10);

        const receivers = await dbManager.getReceivers(limit, offset);
        const totalItems = await dbManager.getReceiversLength();

        // Clean up undefined fields by using JSON.parse/stringify
        // This removes undefined values which Fast JSON Stringify can't handle
        const cleanedReceivers = JSON.parse(JSON.stringify(receivers));

        reply.code(200).send({
          receivers: cleanedReceivers,
          limit,
          offset,
          totalItems
        });
      } catch (error) {
        console.error('Failed to list receivers - Full error:', error);
        console.error('Error stack:', (error as Error).stack);
        Log().error('Failed to list receivers:', error);
        reply.code(500).send({ error: 'Failed to list receivers' });
      }
    }
  );

  // Get a specific receiver
  fastify.get<{
    Params: { id: string };
    Reply: Receiver | { error: string };
  }>(
    '/bridge/rx/:id',
    {
      schema: {
        description: 'Get a receiver by ID',
        params: ParamsId,
        response: {
          200: Receiver,
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const receiver = await dbManager.getReceiver(request.params.id);

        if (!receiver) {
          reply.code(404).send({ error: 'Receiver not found' });
          return;
        }

        // Clean up undefined fields
        const cleanedReceiver = JSON.parse(JSON.stringify(receiver));
        reply.code(200).send(cleanedReceiver);
      } catch (error) {
        Log().error('Failed to get receiver:', error);
        reply.code(500).send({ error: 'Failed to get receiver' });
      }
    }
  );

  // Create a new receiver
  fastify.post<{
    Body: NewReceiver;
    Reply: Receiver | { error: string };
  }>(
    '/bridge/rx',
    {
      schema: {
        description: 'Create a new receiver',
        body: NewReceiver,
        response: {
          201: Receiver,
          400: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        // Save to database first
        const receiver = await dbManager.addReceiver(request.body);

        // Try to create on gateway
        try {
          await callGateway('POST', '/api/v1/rx', {
            id: receiver._id,
            whepUrl: receiver.whepUrl,
            srtUrl: receiver.srtUrl,
            status: BridgeStatus.IDLE
          });

          // Update status to idle (gateway created successfully)
          receiver.status = BridgeStatus.IDLE;
          await dbManager.updateReceiver(receiver);
        } catch (gatewayError) {
          Log().error('Failed to create receiver on gateway:', gatewayError);
          // Mark as failed but keep in database
          receiver.status = BridgeStatus.FAILED;
          await dbManager.updateReceiver(receiver);
        }

        reply.code(201).send(receiver);
      } catch (error) {
        Log().error('Failed to create receiver:', error);
        reply.code(500).send({ error: 'Failed to create receiver' });
      }
    }
  );

  // Update receiver state
  fastify.put<{
    Params: { id: string };
    Body: ReceiverStateChange;
    Reply: Receiver | { error: string };
  }>(
    '/bridge/rx/:id/state',
    {
      schema: {
        description: 'Update receiver state',
        params: ParamsId,
        body: ReceiverStateChange,
        response: {
          200: Receiver,
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const receiver = await dbManager.getReceiver(request.params.id);

        if (!receiver) {
          reply.code(404).send({ error: 'Receiver not found' });
          return;
        }

        // Save desired state in database
        receiver.desiredStatus = request.body.desired;
        await dbManager.updateReceiver(receiver);

        // Update gateway state
        try {
          await callGateway('PUT', `/api/v1/rx/${request.params.id}/state`, {
            desired: request.body.desired
          });

          // Update actual status
          receiver.status = request.body.desired;
          await dbManager.updateReceiver(receiver);

          reply.code(200).send(receiver);
        } catch (gatewayError) {
          Log().error(
            'Failed to update receiver state on gateway:',
            gatewayError
          );
          // Desired state is saved, sync will retry
          reply.code(500).send({ error: 'Failed to update receiver state' });
        }
      } catch (error) {
        Log().error('Failed to update receiver:', error);
        reply.code(500).send({ error: 'Failed to update receiver' });
      }
    }
  );

  // Update receiver metadata
  fastify.patch<{
    Params: { id: string };
    Body: PatchReceiver;
    Reply: Receiver | { error: string };
  }>(
    '/bridge/rx/:id',
    {
      schema: {
        description: 'Update receiver metadata (label, productionId, lineId)',
        params: ParamsId,
        body: PatchReceiver,
        response: {
          200: Receiver,
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const receiver = await dbManager.getReceiver(request.params.id);

        if (!receiver) {
          reply.code(404).send({ error: 'Receiver not found' });
          return;
        }

        // Check if productionId or lineId are changing
        const productionChanged =
          request.body.productionId !== undefined &&
          request.body.productionId !== receiver.productionId;
        const lineChanged =
          request.body.lineId !== undefined &&
          request.body.lineId !== receiver.lineId;

        // If only label is changing, simple update
        if (!productionChanged && !lineChanged && request.body.label !== undefined) {
          receiver.label = request.body.label;
          receiver.updatedAt = new Date().toISOString();
          await dbManager.updateReceiver(receiver);
          const cleanedReceiver = JSON.parse(JSON.stringify(receiver));
          reply.code(200).send(cleanedReceiver);
          return;
        }

        // If production or line changed, need to recreate gateway object
        if (productionChanged || lineChanged) {
          // Save the current state to restore after recreation
          const previousStatus = receiver.status;
          const previousDesiredStatus = receiver.desiredStatus;

          // Update the receiver data
          if (request.body.label !== undefined) {
            receiver.label = request.body.label;
          }
          if (request.body.productionId !== undefined) {
            receiver.productionId = request.body.productionId;
          }
          if (request.body.lineId !== undefined) {
            receiver.lineId = request.body.lineId;
          }

          // Reconstruct WHEP URL with new production/line IDs
          // URL format: ${backendBaseUrl}/api/v1/whep/${productionId}/${lineId}/${whepUsername}
          // Extract username from existing URL
          const urlParts = receiver.whepUrl.split('/');
          const whepUsername = urlParts[urlParts.length - 1];
          const backendBaseUrl = receiver.whepUrl.split('/api/v1/')[0];
          receiver.whepUrl = `${backendBaseUrl}/api/v1/whep/${receiver.productionId}/${receiver.lineId}/${whepUsername}`;

          // Update timestamp
          receiver.updatedAt = new Date().toISOString();

          // Set desired state to STOPPED in database FIRST to prevent state enforcer from restarting
          receiver.status = BridgeStatus.STOPPED;
          receiver.desiredStatus = BridgeStatus.STOPPED;
          await dbManager.updateReceiver(receiver);

          try {
            // Stop the gateway first before deleting
            try {
              await callGateway('PUT', `/api/v1/rx/${request.params.id}/state`, {
                desired: BridgeStatus.STOPPED
              });
            } catch (stopError) {
              Log().warn('Failed to stop receiver before deletion:', stopError);
            }

            // Delete from gateway
            try {
              await callGateway('DELETE', `/api/v1/rx/${request.params.id}`);
            } catch (deleteError) {
              Log().warn('Failed to delete receiver from gateway:', deleteError);
            }

            // Create new gateway object with updated URL (gateway requires initial status)
            await callGateway('POST', '/api/v1/rx', {
              id: receiver._id,
              whepUrl: receiver.whepUrl,
              srtUrl: receiver.srtUrl,
              status: BridgeStatus.IDLE
            });

            // Restore previous state if it was running
            if (previousStatus === BridgeStatus.RUNNING || previousDesiredStatus === BridgeStatus.RUNNING) {
              try {
                await callGateway('PUT', `/api/v1/rx/${request.params.id}/state`, {
                  desired: BridgeStatus.RUNNING
                });
                receiver.status = BridgeStatus.RUNNING;
                receiver.desiredStatus = BridgeStatus.RUNNING;
              } catch (stateError) {
                Log().warn('Failed to restore receiver state:', stateError);
                receiver.status = BridgeStatus.IDLE;
              }
            } else {
              receiver.status = BridgeStatus.IDLE;
              receiver.desiredStatus = BridgeStatus.IDLE;
            }

            await dbManager.updateReceiver(receiver);
          } catch (gatewayError) {
            Log().error('Failed to recreate receiver on gateway:', gatewayError);
            receiver.status = BridgeStatus.FAILED;
            await dbManager.updateReceiver(receiver);
          }
        }

        // Clean up undefined fields
        const cleanedReceiver = JSON.parse(JSON.stringify(receiver));
        reply.code(200).send(cleanedReceiver);
      } catch (error) {
        Log().error('Failed to update receiver:', error);
        reply.code(500).send({ error: 'Failed to update receiver' });
      }
    }
  );

  // Delete a receiver
  fastify.delete<{
    Params: { id: string };
    Reply: { success: boolean } | { error: string };
  }>(
    '/bridge/rx/:id',
    {
      schema: {
        description: 'Delete a receiver',
        params: ParamsId,
        response: {
          200: Type.Object({ success: Type.Boolean() }),
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const receiver = await dbManager.getReceiver(request.params.id);

        if (!receiver) {
          reply.code(404).send({ error: 'Receiver not found' });
          return;
        }

        // Delete from gateway first
        try {
          await callGateway('DELETE', `/api/v1/rx/${request.params.id}`);
        } catch (gatewayError) {
          Log().warn('Failed to delete receiver from gateway:', gatewayError);
          // Continue with database deletion even if gateway fails
        }

        // Delete from database
        await dbManager.deleteReceiver(request.params.id);

        reply.code(200).send({ success: true });
      } catch (error) {
        Log().error('Failed to delete receiver:', error);
        reply.code(500).send({ error: 'Failed to delete receiver' });
      }
    }
  );

  next();
};

export default apiBridgeRx;
