import { Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import {
  ErrorResponse,
  IngestIO,
  IngestIOListResponse,
  NewIngestIO,
  PatchIngestIO,
  PatchIngestIOResponse
} from './models';
import dotenv from 'dotenv';
import { Log } from './log';
import { DbManagerMongoDb } from './db/mongodb';
import { DbManagerCouchDb } from './db/couchdb';
import { IngestIOManager } from './ingest_io_manager';
dotenv.config();

const DB_CONNECTION_STRING: string =
  process.env.DB_CONNECTION_STRING ??
  process.env.MONGODB_CONNECTION_STRING ??
  'mongodb://localhost:27017/intercom-manager';
let dbManager;
const dbUrl = new URL(DB_CONNECTION_STRING);
if (dbUrl.protocol === 'mongodb:') {
  dbManager = new DbManagerMongoDb(dbUrl);
} else if (dbUrl.protocol === 'http:' || dbUrl.protocol === 'https:') {
  dbManager = new DbManagerCouchDb(dbUrl);
} else {
  throw new Error('Unsupported database protocol');
}

const ingestIOManager = new IngestIOManager(dbManager);

const apiIngestIOs: FastifyPluginCallback = (fastify, opts, next) => {
  fastify.post<{
    Body: NewIngestIO;
    Reply: { success: boolean; message: string };
  }>(
    '/ingestio',
    {
      schema: {
        description:
          'Create a new Ingest IO, where an input and an output from an ingest are connected to a production line.',
        body: NewIngestIO,
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
        const ingestIO = await ingestIOManager.createIO(request.body);

        if (ingestIO) {
          reply.code(200).send({
            success: true,
            message: `Successfully created ingest IO with ID ${ingestIO._id}`
          });
        } else {
          reply.code(400).send({
            success: false,
            message: 'Failed to create ingest IO'
          });
        }
      } catch (err) {
        Log().error(err);
        reply.code(500).send({
          success: false,
          message: 'Exception thrown when trying to create ingest IO: ' + err
        });
      }
    }
  );

  fastify.get<{
    Reply: IngestIOListResponse | string;
    Querystring: {
      limit?: number;
      offset?: number;
      extended?: boolean;
    };
  }>(
    '/ingestiolist',
    {
      schema: {
        description: 'Paginated list of all ingests.',
        querystring: Type.Object({
          limit: Type.Optional(Type.Number()),
          offset: Type.Optional(Type.Number())
        }),
        response: {
          200: IngestIOListResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const limit = request.query.limit || 50;
        const offset = request.query.offset || 0;
        const ingestIOs = await ingestIOManager.getIngestIOs(limit, offset);
        const totalItems = await ingestIOManager.getNumberOfIngestIOs();
        const responseIngestIOs: IngestIO[] = ingestIOs.map(
          ({
            _id,
            label,
            ingestId,
            deviceInput,
            deviceOutput,
            productionId,
            lineId
          }: IngestIO) => ({
            _id,
            label,
            ingestId,
            deviceInput,
            deviceOutput,
            productionId,
            lineId
          })
        );

        reply.code(200).send({
          ingestIOs: responseIngestIOs,
          offset,
          limit,
          totalItems
        });
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send(
            'Exception thrown when trying to get paginated ingest IOs: ' + err
          );
      }
    }
  );

  fastify.get<{
    Params: { ingestIOId: string };
    Reply: IngestIO | string;
  }>(
    '/ingestio/:ingestIOId',
    {
      schema: {
        description: 'Retrieves an ingest IO.',
        response: {
          200: IngestIO,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const ingestIO = await ingestIOManager.getIngestIO(
          parseInt(request.params.ingestIOId, 10)
        );
        if (!ingestIO) {
          reply.code(404).send('Ingest IO not found');
          return;
        }
        const ingestResponse: IngestIO = {
          _id: ingestIO._id,
          label: ingestIO.label,
          ingestId: ingestIO.ingestId,
          deviceInput: ingestIO.deviceInput,
          deviceOutput: ingestIO.deviceOutput,
          productionId: ingestIO.productionId,
          lineId: ingestIO.lineId
        };
        reply.code(200).send(ingestResponse);
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to get ingest IOs: ' + err);
      }
    }
  );

  fastify.patch<{
    Params: { ingestIOId: string };
    Body: PatchIngestIO;
    Reply: PatchIngestIOResponse | ErrorResponse | string;
  }>(
    '/ingestio/:ingestIOId',
    {
      schema: {
        description:
          'Modify an existing Ingest. By changing the label, the deviceOutput or the deviceInput, the ingest is updated and the new ingest is returned.',
        body: PatchIngestIO,
        response: {
          200: PatchIngestIOResponse,
          400: ErrorResponse,
          404: ErrorResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const { ingestIOId } = request.params;
        let ingestIO;
        try {
          ingestIO = await ingestIOManager.getIngestIO(
            parseInt(ingestIOId, 10)
          );
        } catch (err) {
          console.warn(
            'Trying to patch an ingest IO in an ingest IO that does not exist'
          );
        }
        if (!ingestIO) {
          reply.code(404).send({
            message: `Ingest IO with id ${ingestIOId} not found`
          });
        } else {
          const updates: any = {};

          if ('deviceInput' in request.body) {
            updates.deviceInput = request.body.deviceInput;
          } else if ('deviceOutput' in request.body) {
            updates.deviceOutput = request.body.deviceOutput;
          } else if ('label' in request.body) {
            updates.label = request.body.label;
          } else if ('productionId' in request.body) {
            updates.productionId = request.body.productionId;
          } else if ('lineId' in request.body) {
            updates.lineId = request.body.lineId;
          } else {
            reply.code(400).send({
              message: 'Invalid request body'
            });
            return;
          }

          const updatedIngestIO = await ingestIOManager.updateIngestIO(
            ingestIO,
            updates
          );

          if (!updatedIngestIO) {
            reply.code(400).send({
              message: `Failed to update ingest IO with id ${ingestIOId}`
            });
          } else {
            reply.code(200).send({
              _id: updatedIngestIO._id,
              label: updatedIngestIO.label,
              deviceInput: updatedIngestIO.deviceInput,
              deviceOutput: updatedIngestIO.deviceOutput,
              productionId: updatedIngestIO.productionId,
              lineId: updatedIngestIO.lineId
            });
          }
        }
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to get ingest: ' + err);
      }
    }
  );

  fastify.delete<{
    Params: { ingestIOId: string };
    Reply: string;
  }>(
    '/ingestio/:ingestIOId',
    {
      schema: {
        description: 'Deletes an Ingest IO.',
        response: {
          200: Type.String(),
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      const { ingestIOId } = request.params;
      try {
        if (!(await ingestIOManager.deleteIngestIO(parseInt(ingestIOId, 10)))) {
          throw new Error('Could not delete ingest IO');
        }
        reply.code(200).send(`Deleted ingest IO ${ingestIOId}`);
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to delete ingest IO: ' + err);
      }
    }
  );

  next();
};

export async function getApiIngestIOs() {
  await ingestIOManager.load();
  return apiIngestIOs;
}
