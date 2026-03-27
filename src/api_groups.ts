import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import { DbManager } from './db/interface';
import {
  ErrorResponse,
  NewPreset,
  Preset,
  PresetListResponse,
  TUpdatePreset,
  UpdatePreset
} from './models';

export interface ApiGroupsOptions {
  dbManager: DbManager;
}

const apiGroups: FastifyPluginCallback<ApiGroupsOptions> = (
  fastify,
  opts,
  next
) => {
  const instance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  instance.get(
    '/preset',
    {
      schema: {
        response: {
          200: PresetListResponse
        }
      }
    },
    async (_req, reply) => {
      const presets = await opts.dbManager.getPresets();
      reply.send({ presets });
    }
  );

  instance.post(
    '/preset',
    {
      schema: {
        body: NewPreset,
        response: {
          201: Preset,
          400: ErrorResponse
        }
      }
    },
    async (req, reply) => {
      const preset = await opts.dbManager.addPreset({
        ...req.body,
        createdAt: new Date().toISOString()
      });
      reply.code(201).send(preset);
    }
  );

  instance.get(
    '/preset/:id',
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: {
          200: Preset,
          404: ErrorResponse
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params;
      const preset = await opts.dbManager.getPreset(id);
      if (!preset) return reply.code(404).send({ message: 'Preset not found' });
      reply.send(preset);
    }
  );

  instance.patch(
    '/preset/:id',
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: UpdatePreset,
        response: {
          200: Preset,
          404: ErrorResponse
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params;
      const body = req.body as TUpdatePreset;
      const update: {
        name?: string;
        calls?: { productionId: string; lineId: string }[];
        companionUrl?: string | null;
      } = {};
      if (body.name !== undefined) update.name = body.name;
      if (body.calls !== undefined) update.calls = body.calls;
      if (body.companionUrl !== undefined) {
        // AJV coerces null to "" for string|null unions — treat empty string as null (removal)
        update.companionUrl =
          body.companionUrl === '' ? null : body.companionUrl;
      }
      const updated = await opts.dbManager.updatePreset(id, update);
      if (!updated)
        return reply.code(404).send({ message: 'Preset not found' });
      reply.send(updated);
    }
  );

  instance.delete(
    '/preset/:id',
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: {
          204: Type.Null(),
          404: ErrorResponse
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params;
      const ok = await opts.dbManager.deletePreset(id);
      if (!ok) return reply.code(404).send({ message: 'Preset not found' });
      reply.code(204).send(null);
    }
  );

  next();
};

export default apiGroups;
