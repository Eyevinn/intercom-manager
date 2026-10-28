import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import { requireApiKey } from './auth';
import { IngestManager } from './ingest_manager';
import { Log } from './log';
import { Device, DeviceListResponse } from './models';

export interface ApiDevicesOptions {
  ingestManager: IngestManager;
}

const apiDevices: FastifyPluginCallback<ApiDevicesOptions> = (
  fastify,
  opts,
  next
) => {
  const instance = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const ingestManager = opts.ingestManager;

  instance.get(
    '/devices',
    {
      preHandler: requireApiKey,
      schema: {
        description:
          'Aggregated list of all input and output devices found across every ingest, so the frontend can present them in a single list.',
        response: {
          200: DeviceListResponse,
          500: Type.String()
        }
      }
    },
    async (_request, reply) => {
      try {
        // Fetch every ingest. getIngests paginates, and a limit of 0 does not
        // reliably mean "all" across both DB backends (CouchDB slices to an
        // empty list, Mongo treats 0 as unlimited), so the total count is used
        // as the limit to pull all ingests regardless of backend.
        const totalItems = await ingestManager.getNumberOfIngests();
        const ingests =
          totalItems > 0 ? await ingestManager.getIngests(totalItems, 0) : [];

        const devices: Device[] = [];
        for (const ingest of ingests) {
          for (const input of ingest.deviceInput) {
            devices.push({
              ingestId: ingest._id,
              ingestLabel: ingest.label,
              type: 'input',
              name: input.name,
              label: input.label
            });
          }
          for (const output of ingest.deviceOutput) {
            devices.push({
              ingestId: ingest._id,
              ingestLabel: ingest.label,
              type: 'output',
              name: output.name,
              label: output.label
            });
          }
        }

        reply.code(200).send({ devices });
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to get devices');
      }
    }
  );

  next();
};

export function getApiDevices() {
  return apiDevices;
}
