import { FastifyPluginCallback } from 'fastify';
import { Type } from '@sinclair/typebox';
import { DbManager } from './db/interface';
import {
  NewTransmitter,
  Transmitter,
  TransmitterListResponse,
  TransmitterStateChange,
  PatchTransmitter,
  BridgeStatus
} from './models';
import { Log } from './log';

export interface ApiBridgeTxOptions {
  dbManager: DbManager;
  whipGatewayUrl: string;
  whipGatewayApiKey?: string;
}

const ParamsPort = Type.Object({
  port: Type.String({
    description: 'SRT port'
  })
});

const apiBridgeTx: FastifyPluginCallback<ApiBridgeTxOptions> = (
  fastify,
  opts,
  next
) => {
  const { dbManager, whipGatewayUrl, whipGatewayApiKey } = opts;

  // Helper function to call gateway API
  const callGateway = async (
    method: string,
    path: string,
    body?: any
  ): Promise<any> => {
    const url = `${whipGatewayUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (whipGatewayApiKey) {
      headers['x-api-key'] = whipGatewayApiKey;
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

  // List all transmitters
  fastify.get<{
    Querystring: { limit?: string; offset?: string };
    Reply: TransmitterListResponse | { error: string };
  }>(
    '/bridge/tx',
    {
      schema: {
        description: 'List all transmitters',
        querystring: Type.Object({
          limit: Type.Optional(Type.String()),
          offset: Type.Optional(Type.String())
        }),
        response: {
          200: TransmitterListResponse,
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const limit = parseInt(request.query.limit || '100', 10);
        const offset = parseInt(request.query.offset || '0', 10);

        const transmitters = await dbManager.getTransmitters(limit, offset);
        const totalItems = await dbManager.getTransmittersLength();

        // Clean up undefined fields by using JSON.parse/stringify
        // This removes undefined values which Fast JSON Stringify can't handle
        const cleanedTransmitters = JSON.parse(JSON.stringify(transmitters));

        reply.code(200).send({
          transmitters: cleanedTransmitters,
          limit,
          offset,
          totalItems
        });
      } catch (error) {
        Log().error('Failed to list transmitters:', error);
        reply.code(500).send({ error: 'Failed to list transmitters' });
      }
    }
  );

  // Get a specific transmitter
  fastify.get<{
    Params: { port: string };
    Reply: Transmitter | { error: string };
  }>(
    '/bridge/tx/:port',
    {
      schema: {
        description: 'Get a transmitter by port',
        params: ParamsPort,
        response: {
          200: Transmitter,
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const port = parseInt(request.params.port, 10);
        const transmitter = await dbManager.getTransmitter(port);

        if (!transmitter) {
          reply.code(404).send({ error: 'Transmitter not found' });
          return;
        }

        // Clean up undefined fields
        const cleanedTransmitter = JSON.parse(JSON.stringify(transmitter));
        reply.code(200).send(cleanedTransmitter);
      } catch (error) {
        Log().error('Failed to get transmitter:', error);
        reply.code(500).send({ error: 'Failed to get transmitter' });
      }
    }
  );

  // Create a new transmitter
  fastify.post<{
    Body: NewTransmitter;
    Reply: Transmitter | { error: string };
  }>(
    '/bridge/tx',
    {
      schema: {
        description: 'Create a new transmitter',
        body: NewTransmitter,
        response: {
          201: Transmitter,
          400: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        // Save to database first
        const transmitter = await dbManager.addTransmitter(request.body);

        // Try to create on gateway
        try {
          await callGateway('POST', '/api/v1/tx', {
            label: transmitter.label,
            port: transmitter.port,
            mode: transmitter.mode === 'caller' ? 1 : 2,
            srtUrl: transmitter.srtUrl,
            whipUrl: transmitter.whipUrl,
            passThroughUrl: transmitter.passThroughUrl,
            noVideo: true,
            status: BridgeStatus.IDLE
          });

          // Update status to idle (gateway created successfully)
          transmitter.status = BridgeStatus.IDLE;
          await dbManager.updateTransmitter(transmitter);
        } catch (gatewayError) {
          Log().error('Failed to create transmitter on gateway:', gatewayError);
          // Mark as failed but keep in database
          transmitter.status = BridgeStatus.FAILED;
          await dbManager.updateTransmitter(transmitter);
        }

        reply.code(201).send(transmitter);
      } catch (error) {
        Log().error('Failed to create transmitter:', error);
        reply.code(500).send({ error: 'Failed to create transmitter' });
      }
    }
  );

  // Update transmitter state
  fastify.put<{
    Params: { port: string };
    Body: TransmitterStateChange;
    Reply: Transmitter | { error: string };
  }>(
    '/bridge/tx/:port/state',
    {
      schema: {
        description: 'Update transmitter state',
        params: ParamsPort,
        body: TransmitterStateChange,
        response: {
          200: Transmitter,
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const port = parseInt(request.params.port, 10);
        const transmitter = await dbManager.getTransmitter(port);

        if (!transmitter) {
          reply.code(404).send({ error: 'Transmitter not found' });
          return;
        }

        // Save desired state in database
        transmitter.desiredStatus = request.body.desired;
        await dbManager.updateTransmitter(transmitter);

        // Update gateway state
        try {
          await callGateway('PUT', `/api/v1/tx/${port}/state`, {
            desired: request.body.desired
          });

          // Update actual status
          transmitter.status = request.body.desired;
          await dbManager.updateTransmitter(transmitter);

          reply.code(200).send(transmitter);
        } catch (gatewayError) {
          Log().error(
            'Failed to update transmitter state on gateway:',
            gatewayError
          );
          // Desired state is saved, sync will retry
          reply.code(500).send({ error: 'Failed to update transmitter state' });
        }
      } catch (error) {
        Log().error('Failed to update transmitter:', error);
        reply.code(500).send({ error: 'Failed to update transmitter' });
      }
    }
  );

  // Update transmitter metadata
  fastify.patch<{
    Params: { port: string };
    Body: PatchTransmitter;
    Reply: Transmitter | { error: string };
  }>(
    '/bridge/tx/:port',
    {
      schema: {
        description:
          'Update transmitter metadata (label, productionId, lineId)',
        params: ParamsPort,
        body: PatchTransmitter,
        response: {
          200: Transmitter,
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const port = parseInt(request.params.port, 10);
        const transmitter = await dbManager.getTransmitter(port);

        if (!transmitter) {
          reply.code(404).send({ error: 'Transmitter not found' });
          return;
        }

        // Check if productionId or lineId are changing
        const productionChanged =
          request.body.productionId !== undefined &&
          request.body.productionId !== transmitter.productionId;
        const lineChanged =
          request.body.lineId !== undefined &&
          request.body.lineId !== transmitter.lineId;

        // If only label is changing, simple update
        if (
          !productionChanged &&
          !lineChanged &&
          request.body.label !== undefined
        ) {
          transmitter.label = request.body.label;
          transmitter.updatedAt = new Date().toISOString();
          await dbManager.updateTransmitter(transmitter);
          const cleanedTransmitter = JSON.parse(JSON.stringify(transmitter));
          reply.code(200).send(cleanedTransmitter);
          return;
        }

        // If production or line changed, need to recreate gateway object
        if (productionChanged || lineChanged) {
          // Save the current state to restore after recreation
          const previousStatus = transmitter.status;
          const previousDesiredStatus = transmitter.desiredStatus;

          // Update the transmitter data
          if (request.body.label !== undefined) {
            transmitter.label = request.body.label;
          }
          if (request.body.productionId !== undefined) {
            transmitter.productionId = request.body.productionId;
          }
          if (request.body.lineId !== undefined) {
            transmitter.lineId = request.body.lineId;
          }

          // Reconstruct WHIP URL with new production/line IDs
          // URL format: ${backendBaseUrl}/api/v1/whip/${productionId}/${lineId}/${whipUsername}
          // Extract username from existing URL
          const urlParts = transmitter.whipUrl.split('/');
          const whipUsername = urlParts[urlParts.length - 1];
          const backendBaseUrl = transmitter.whipUrl.split('/api/v1/')[0];
          transmitter.whipUrl = `${backendBaseUrl}/api/v1/whip/${transmitter.productionId}/${transmitter.lineId}/${whipUsername}`;

          // Update timestamp
          transmitter.updatedAt = new Date().toISOString();

          // Set desired state to STOPPED in database FIRST to prevent state enforcer from restarting
          transmitter.status = BridgeStatus.STOPPED;
          transmitter.desiredStatus = BridgeStatus.STOPPED;
          await dbManager.updateTransmitter(transmitter);

          try {
            // Stop the gateway first before deleting
            try {
              await callGateway('PUT', `/api/v1/tx/${port}/state`, {
                desired: BridgeStatus.STOPPED
              });
            } catch (stopError) {
              Log().warn(
                'Failed to stop transmitter before deletion:',
                stopError
              );
            }

            // Delete from gateway
            try {
              await callGateway('DELETE', `/api/v1/tx/${port}`);
            } catch (deleteError) {
              Log().warn(
                'Failed to delete transmitter from gateway:',
                deleteError
              );
            }

            // Create new gateway object with updated URL (gateway requires initial status)
            await callGateway('POST', '/api/v1/tx', {
              label: transmitter.label,
              port: transmitter.port,
              mode: transmitter.mode === 'caller' ? 1 : 2,
              srtUrl: transmitter.srtUrl,
              whipUrl: transmitter.whipUrl,
              passThroughUrl: transmitter.passThroughUrl,
              noVideo: true,
              status: BridgeStatus.IDLE
            });

            // Restore previous state if it was running
            if (
              previousStatus === BridgeStatus.RUNNING ||
              previousDesiredStatus === BridgeStatus.RUNNING
            ) {
              try {
                await callGateway('PUT', `/api/v1/tx/${port}/state`, {
                  desired: BridgeStatus.RUNNING
                });
                transmitter.status = BridgeStatus.RUNNING;
                transmitter.desiredStatus = BridgeStatus.RUNNING;
              } catch (stateError) {
                Log().warn('Failed to restore transmitter state:', stateError);
                transmitter.status = BridgeStatus.IDLE;
              }
            } else {
              transmitter.status = BridgeStatus.IDLE;
              transmitter.desiredStatus = BridgeStatus.IDLE;
            }

            await dbManager.updateTransmitter(transmitter);
          } catch (gatewayError) {
            Log().error(
              'Failed to recreate transmitter on gateway:',
              gatewayError
            );
            transmitter.status = BridgeStatus.FAILED;
            await dbManager.updateTransmitter(transmitter);
          }
        }

        // Clean up undefined fields
        const cleanedTransmitter = JSON.parse(JSON.stringify(transmitter));
        reply.code(200).send(cleanedTransmitter);
      } catch (error) {
        Log().error('Failed to update transmitter:', error);
        reply.code(500).send({ error: 'Failed to update transmitter' });
      }
    }
  );

  // Delete a transmitter
  fastify.delete<{
    Params: { port: string };
    Reply: { success: boolean } | { error: string };
  }>(
    '/bridge/tx/:port',
    {
      schema: {
        description: 'Delete a transmitter',
        params: ParamsPort,
        response: {
          200: Type.Object({ success: Type.Boolean() }),
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const port = parseInt(request.params.port, 10);
        const transmitter = await dbManager.getTransmitter(port);

        if (!transmitter) {
          reply.code(404).send({ error: 'Transmitter not found' });
          return;
        }

        // Delete from gateway first
        try {
          await callGateway('DELETE', `/api/v1/tx/${port}`);
        } catch (gatewayError) {
          Log().warn(
            'Failed to delete transmitter from gateway:',
            gatewayError
          );
          // Continue with database deletion even if gateway fails
        }

        // Delete from database
        await dbManager.deleteTransmitter(port);

        reply.code(200).send({ success: true });
      } catch (error) {
        Log().error('Failed to delete transmitter:', error);
        reply.code(500).send({ error: 'Failed to delete transmitter' });
      }
    }
  );

  next();
};

export default apiBridgeTx;
