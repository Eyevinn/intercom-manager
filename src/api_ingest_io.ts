import { Type } from '@sinclair/typebox';
import { FastifyInstance } from 'fastify';
import {
  ErrorResponse,
  IngestIo,
  IngestIoListResponse,
  NewIngestIo,
  PatchIngestIo
} from './models';
import { IngestManager } from './ingest_manager';
import { Log } from './log';
import { requireApiKey } from './auth';

const IngestIdParams = Type.Object({
  ingestId: Type.String({
    minLength: 1,
    maxLength: 128,
    pattern: '^[0-9]+$'
  })
});

const IngestIoParams = Type.Object({
  ingestId: IngestIdParams.properties.ingestId,
  ioId: Type.String({ minLength: 1, maxLength: 128 })
});

/**
 * Registers the Ingest-IO sub-resource routes
 * (/ingest/:ingestId/io and /ingest/:ingestId/io/:ioId).
 *
 * Must be called from within the ingest plugin so the routes share its
 * encapsulated hooks (including the 501 gate while the Ingest API is
 * disabled).
 */
export function registerIngestIoRoutes(
  fastify: FastifyInstance,
  ingestManager: IngestManager
): void {
  fastify.get<{
    Params: { ingestId: string };
    Reply: IngestIoListResponse | ErrorResponse;
  }>(
    '/ingest/:ingestId/io',
    {
      schema: {
        description: 'Lists the IOs (inputs and outputs) of an ingest.',
        params: IngestIdParams,
        response: {
          200: IngestIoListResponse,
          404: ErrorResponse,
          500: ErrorResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const ingestId = parseInt(request.params.ingestId, 10);
        if (!(await ingestManager.getIngest(ingestId))) {
          reply.code(404).send({ message: `Ingest ${ingestId} not found` });
          return;
        }
        const ios = await ingestManager.getIngestIos(ingestId);
        reply.code(200).send({ ios });
      } catch (err) {
        Log().error(err);
        reply.code(500).send({ message: 'Failed to get ingest IOs' });
      }
    }
  );

  fastify.post<{
    Params: { ingestId: string };
    Body: NewIngestIo;
    Reply: IngestIo | ErrorResponse;
  }>(
    '/ingest/:ingestId/io',
    {
      preHandler: requireApiKey,
      schema: {
        description: 'Creates an IO for an ingest.',
        params: IngestIdParams,
        body: NewIngestIo,
        response: {
          201: IngestIo,
          404: ErrorResponse,
          500: ErrorResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const ingestId = parseInt(request.params.ingestId, 10);
        if (!(await ingestManager.getIngest(ingestId))) {
          reply.code(404).send({ message: `Ingest ${ingestId} not found` });
          return;
        }
        const io = await ingestManager.createIngestIo(ingestId, request.body);
        reply.code(201).send(io);
      } catch (err) {
        Log().error(err);
        reply.code(500).send({ message: 'Failed to create ingest IO' });
      }
    }
  );

  fastify.get<{
    Params: { ingestId: string; ioId: string };
    Reply: IngestIo | ErrorResponse;
  }>(
    '/ingest/:ingestId/io/:ioId',
    {
      schema: {
        description: 'Retrieves an IO of an ingest.',
        params: IngestIoParams,
        response: {
          200: IngestIo,
          404: ErrorResponse,
          500: ErrorResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const { ingestId, ioId } = request.params;
        const io = await ingestManager.getIngestIo(
          parseInt(ingestId, 10),
          ioId
        );
        if (!io) {
          reply.code(404).send({ message: `IO ${ioId} not found` });
          return;
        }
        reply.code(200).send(io);
      } catch (err) {
        Log().error(err);
        reply.code(500).send({ message: 'Failed to get ingest IO' });
      }
    }
  );

  fastify.patch<{
    Params: { ingestId: string; ioId: string };
    Body: PatchIngestIo;
    Reply: IngestIo | ErrorResponse;
  }>(
    '/ingest/:ingestId/io/:ioId',
    {
      preHandler: requireApiKey,
      schema: {
        description: 'Modifies an IO of an ingest.',
        params: IngestIoParams,
        body: PatchIngestIo,
        response: {
          200: IngestIo,
          400: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const { ingestId, ioId } = request.params;
        const io = await ingestManager.getIngestIo(
          parseInt(ingestId, 10),
          ioId
        );
        if (!io) {
          reply.code(404).send({ message: `IO ${ioId} not found` });
          return;
        }
        const updated = await ingestManager.updateIngestIo(io, request.body);
        if (!updated) {
          reply.code(400).send({ message: `Failed to update IO ${ioId}` });
          return;
        }
        reply.code(200).send(updated);
      } catch (err) {
        Log().error(err);
        reply.code(500).send({ message: 'Failed to update ingest IO' });
      }
    }
  );

  fastify.delete<{
    Params: { ingestId: string; ioId: string };
    Reply: string | ErrorResponse;
  }>(
    '/ingest/:ingestId/io/:ioId',
    {
      preHandler: requireApiKey,
      schema: {
        description: 'Deletes an IO of an ingest.',
        params: IngestIoParams,
        response: {
          200: Type.String(),
          404: ErrorResponse,
          500: ErrorResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const { ingestId, ioId } = request.params;
        if (
          !(await ingestManager.deleteIngestIo(parseInt(ingestId, 10), ioId))
        ) {
          reply.code(404).send({ message: `IO ${ioId} not found` });
          return;
        }
        reply.code(200).send(`Deleted IO ${ioId}`);
      } catch (err) {
        Log().error(err);
        reply.code(500).send({ message: 'Failed to delete ingest IO' });
      }
    }
  );
}
