import { Static, Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import { ErrorResponse } from './models';

type Role = 'admin' | 'editor' | 'participant';

const PermissionsResponse = Type.Object({
  permissions: Type.Array(Type.String()),
  role: Type.String(),
});

const apiPermissions: FastifyPluginCallback = (fastify, _opts, next) => {
  fastify.get<{
    Reply: Static<typeof PermissionsResponse> | ErrorResponse;
  }>(
    '/permissions',
    {
      schema: {
        description: 'Get frontend permissions for a given access key',
        querystring: Type.Object({
          accessKey: Type.Optional(Type.String()),
        }),
        response: {
          200: {
            description: 'Successful permissions response',
            ...PermissionsResponse,
            example: {
              role: 'admin',
              permissions: [
                'create_production',
                'manage_production',
                'manage_ingests',
                'join_calls'
              ],
            },
          },
          400: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { accessKey } = request.query as { accessKey?: string };

      const envRoles = {
        admin: process.env.ADMIN_ACCESS_KEY,
        editor: process.env.EDITOR_ACCESS_KEY,
      };

      const noAccessControl = !envRoles.admin && !envRoles.editor;

      let role: Role;

      if (noAccessControl) {
        role = 'admin';
      } else if (accessKey) {
        const matched = (Object.keys(envRoles) as (keyof typeof envRoles)[]).find(
          (r) => envRoles[r] === accessKey
        );
      
        if (!matched) {
          return reply.code(403).send({ message: 'Invalid access key' });
        }
      
        role = matched;
      } else {
        role = 'participant';
      }

      const permissions: Record<Role, string[]> = {
        admin: ['create_production', 'manage_production', 'manage_ingests', 'join_calls'],
        editor: ['create_production', 'manage_production', 'join_calls'],
        participant: ['join_calls'],
      };

      return { permissions: permissions[role], role };
    }
  );

  next();
};

export default apiPermissions;
