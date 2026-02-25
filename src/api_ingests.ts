import { Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import {
  IngestListResponse,
  Ingest,
  ErrorResponse,
  PatchIngestResponse,
  PatchIngest,
  NewIngest
} from './models';
import { IngestManager } from './ingest_manager';
import dotenv from 'dotenv';
import { Log } from './log';
import { DbManager } from './db/interface';
dotenv.config();

export interface ApiIngestsOptions {
  dbManager: DbManager;
  ingestManager: IngestManager;
}

const apiIngests: FastifyPluginCallback<ApiIngestsOptions> = (
  fastify,
  opts,
  next
) => {
  const ingestManager = opts.ingestManager;

  // Ingest routes are disabled — return 501 Not Implemented
  fastify.addHook('preHandler', async (_request, reply) => {
    reply.code(501).send({ message: 'Ingest API is not implemented' });
  });

  fastify.post<{
    Body: NewIngest;
    Reply: { success: boolean; message: string };
  }>(
    '/ingest',
    {
      schema: {
        description:
          'Create a new Ingest. The device data will be fetched from the specified IP address.',
        body: NewIngest,
        response: {
          200: Type.Object({
            success: Type.Boolean(),
            message: Type.String()
          }),
          400: ErrorResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const ingest = await ingestManager.createIngest(request.body);

        if (ingest) {
          await ingestManager.load();
          reply.code(200).send({
            success: true,
            message: `Successfully created ingest with ID ${ingest._id}`
          });
        } else {
          reply.code(400).send({
            success: false,
            message: 'Failed to create ingest - could not connect to device'
          });
        }
      } catch (err) {
        Log().error(err);
        reply.code(500).send({
          success: false,
          message: 'Failed to create ingest'
        });
      }
    }
  );

  fastify.get<{
    Reply: IngestListResponse | string;
    Querystring: {
      limit?: number;
      offset?: number;
      extended?: boolean;
    };
  }>(
    '/ingest',
    {
      schema: {
        description: 'Paginated list of all ingests.',
        querystring: Type.Object({
          limit: Type.Optional(Type.Number()),
          offset: Type.Optional(Type.Number())
        }),
        response: {
          200: IngestListResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const limit = request.query.limit || 50;
        const offset = request.query.offset || 0;
        const ingests = await ingestManager.getIngests(limit, offset);
        const totalItems = await ingestManager.getNumberOfIngests();
        const responseIngests: Ingest[] = ingests.map(
          ({ _id, label, ipAddress, deviceOutput, deviceInput }) => ({
            _id,
            label,
            ipAddress,
            deviceOutput,
            deviceInput
          })
        );

        reply.code(200).send({
          ingests: responseIngests,
          offset,
          limit,
          totalItems
        });
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to get ingests');
      }
    }
  );

  fastify.get<{
    Params: { ingestId: string };
    Reply: Ingest | string;
  }>(
    '/ingest/:ingestId',
    {
      schema: {
        description: 'Retrieves an ingest.',
        response: {
          200: Ingest,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const ingest = await ingestManager.getIngest(
          parseInt(request.params.ingestId, 10)
        );
        if (!ingest) {
          reply.code(404).send('Ingest not found');
          return;
        }
        const ingestResponse: Ingest = {
          _id: ingest._id,
          label: ingest.label,
          ipAddress: ingest.ipAddress,
          deviceOutput: ingest.deviceOutput,
          deviceInput: ingest.deviceInput
        };
        reply.code(200).send(ingestResponse);
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to get ingests');
      }
    }
  );

  fastify.patch<{
    Params: { ingestId: string };
    Body: PatchIngest;
    Reply: PatchIngestResponse | ErrorResponse | string;
  }>(
    '/ingest/:ingestId',
    {
      schema: {
        description:
          'Modify an existing Ingest. By changing the label, the deviceOutput or the deviceInput, the ingest is updated and the new ingest is returned.',
        body: PatchIngest,
        response: {
          200: PatchIngestResponse,
          400: ErrorResponse,
          404: ErrorResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const { ingestId } = request.params;
        let ingest;
        try {
          ingest = await ingestManager.getIngest(parseInt(ingestId, 10));
        } catch (err) {
          Log().warn('Trying to patch an ingest that does not exist');
        }
        if (!ingest) {
          reply.code(404).send({
            message: `Ingest with id ${ingestId} not found`
          });
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updates: any = {};

          if ('deviceOutput' in request.body) {
            updates.deviceOutput = request.body.deviceOutput;
          } else if ('deviceInput' in request.body) {
            updates.deviceInput = request.body.deviceInput;
          } else if ('label' in request.body) {
            updates.label = request.body.label;
          } else {
            reply.code(400).send({
              message: 'Invalid request body'
            });
            return;
          }

          const updatedIngest = await ingestManager.updateIngest(
            ingest,
            updates
          );

          if (!updatedIngest) {
            reply.code(400).send({
              message: `Failed to update ingest with id ${ingestId}`
            });
          } else {
            reply.code(200).send({
              _id: updatedIngest._id,
              label: updatedIngest.label,
              deviceOutput: updatedIngest.deviceOutput,
              deviceInput: updatedIngest.deviceInput
            });
          }
        }
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to get ingest');
      }
    }
  );

  fastify.delete<{
    Params: { ingestId: string };
    Reply: string;
  }>(
    '/ingest/:ingestId',
    {
      schema: {
        description: 'Deletes a Ingest.',
        response: {
          200: Type.String(),
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      const { ingestId } = request.params;
      try {
        if (!(await ingestManager.deleteIngest(parseInt(ingestId, 10)))) {
          throw new Error('Could not delete ingest');
        }
        reply.code(200).send(`Deleted ingest ${ingestId}`);
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to delete ingest');
      }
    }
  );

  next();
};

export function getApiIngests() {
  return apiIngests;
}
