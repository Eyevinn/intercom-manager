import { FastifyPluginCallback } from 'fastify';
import { ErrorResponse, ReAuthResponse } from './models';

const OSC_ACCESS_TOKEN = process.env.OSC_ACCESS_TOKEN;
const OSC_ENVIRONMENT = process.env.OSC_ENVIRONMENT ?? 'prod';

const apiReAuth: FastifyPluginCallback = (fastify, _, next) => {
  fastify.get(
    '/reauth',
    {
      schema: {
        description:
          'Generate a new OSC Service Access Token for the OSC Intercom instance.',
        response: {
          200: ReAuthResponse,
          400: ErrorResponse
        }
      }
    },
    async (_, reply) => {
      if (OSC_ACCESS_TOKEN) {
        const response = await fetch(
          `https://token.svc.${OSC_ENVIRONMENT}.osaas.io/servicetoken`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-pat-jwt': `Bearer ${OSC_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
              serviceId: 'eyevinn-intercom-manager'
            })
          }
        );
        if (response.ok) {
          const json = (await response.json()) as { token: string };
          reply
            .cookie('eyevinn-intercom-manager.sat', `Bearer ${json.token}`, {
              path: '/',
              httpOnly: true,
              secure: true,
              sameSite: 'strict',
              maxAge: 60 * 60 * 2 // 2 Hours
            })
            .send({ token: json.token });
        } else {
          reply.code(500).send({
            error: 'ServiceToken Service failed to generate new SAT Token'
          });
        }
      } else {
        reply
          .code(405)
          .send({ error: 'No OSC_ACCESS_TOKEN set, method not allowed' });
      }
    }
  );
  next();
};

export default apiReAuth;
