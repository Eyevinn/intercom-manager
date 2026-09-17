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
import { BridgeDriver } from './bridge/driver';

export interface ApiBridgeTxOptions {
  dbManager: DbManager;
  bridgeDriver: BridgeDriver;
}

const ParamsId = Type.Object({
  id: Type.String({
    description: 'Transmitter ID'
  })
});

const apiBridgeTx: FastifyPluginCallback<ApiBridgeTxOptions> = (
  fastify,
  opts,
  next
) => {
  const { dbManager } = opts;

  fastify.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      productionId?: string;
      lineId?: string;
    };
    Reply: TransmitterListResponse | { error: string };
  }>(
    '/bridge/tx',
    {
      schema: {
        description: 'List all transmitters',
        querystring: Type.Object({
          limit: Type.Optional(Type.String()),
          offset: Type.Optional(Type.String()),
          productionId: Type.Optional(Type.String()),
          lineId: Type.Optional(Type.String())
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

        const filter = {
          productionId: request.query.productionId
            ? parseInt(request.query.productionId, 10)
            : undefined,
          lineId: request.query.lineId
            ? parseInt(request.query.lineId, 10)
            : undefined
        };

        const transmitters = await dbManager.getTransmitters(
          limit,
          offset,
          filter
        );
        const totalItems = await dbManager.getTransmittersLength(filter);

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
    Params: { id: string };
    Reply: Transmitter | { error: string };
  }>(
    '/bridge/tx/:id',
    {
      schema: {
        description: 'Get a transmitter by id',
        params: ParamsId,
        response: {
          200: Transmitter,
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const id = request.params.id;
        const transmitter = await dbManager.getTransmitter(id);

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
          409: Type.Object({ error: Type.String() }),
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
          await opts.bridgeDriver.createTransmitter(
            transmitter,
            BridgeStatus.IDLE
          );

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
    Params: { id: string };
    Body: TransmitterStateChange;
    Reply: Transmitter | { error: string };
  }>(
    '/bridge/tx/:id/state',
    {
      schema: {
        description: 'Update transmitter state',
        params: ParamsId,
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
        const id = request.params.id;
        const transmitter = await dbManager.getTransmitter(id);

        if (!transmitter) {
          reply.code(404).send({ error: 'Transmitter not found' });
          return;
        }

        // Save desired state in database
        transmitter.desiredStatus = request.body.desired;
        await dbManager.updateTransmitter(transmitter);

        // Update gateway state
        try {
          await opts.bridgeDriver.setTransmitterState(
            transmitter._id,
            request.body.desired
          );

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
    Params: { id: string };
    Body: PatchTransmitter;
    Reply: Transmitter | { error: string };
  }>(
    '/bridge/tx/:id',
    {
      schema: {
        description:
          'Update transmitter metadata (label, productionId, lineId)',
        params: ParamsId,
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
        const id = request.params.id;
        const transmitter = await dbManager.getTransmitter(id);

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
              await opts.bridgeDriver.setTransmitterState(
                transmitter._id,
                BridgeStatus.STOPPED
              );
            } catch (stopError) {
              Log().warn(
                'Failed to stop transmitter before deletion:',
                stopError
              );
            }

            // Delete from gateway
            try {
              await opts.bridgeDriver.deleteTransmitter(transmitter._id);
            } catch (deleteError) {
              Log().warn(
                'Failed to delete transmitter from gateway:',
                deleteError
              );
            }

            // Create new gateway object with updated URL (gateway requires initial status)
            await opts.bridgeDriver.createTransmitter(
              transmitter,
              BridgeStatus.IDLE
            );

            // Restore previous state if it was running
            if (
              previousStatus === BridgeStatus.RUNNING ||
              previousDesiredStatus === BridgeStatus.RUNNING
            ) {
              try {
                await opts.bridgeDriver.setTransmitterState(
                  transmitter._id,
                  BridgeStatus.RUNNING
                );
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
    Params: { id: string };
    Reply: { success: boolean } | { error: string };
  }>(
    '/bridge/tx/:id',
    {
      schema: {
        description: 'Delete a transmitter',
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
        const id = request.params.id;
        const transmitter = await dbManager.getTransmitter(id);

        if (!transmitter) {
          reply.code(404).send({ error: 'Transmitter not found' });
          return;
        }

        // Delete from gateway first
        try {
          await opts.bridgeDriver.deleteTransmitter(transmitter._id);
        } catch (gatewayError) {
          Log().warn(
            'Failed to delete transmitter from gateway:',
            gatewayError
          );
          // Continue with database deletion even if gateway fails
        }

        // Delete from database
        await dbManager.deleteTransmitter(id);

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
