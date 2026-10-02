import { Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import { ErrorResponse, ShareRequest, ShareResponse } from './models';
import { isValidJwt, oscTokenServiceBaseUrl } from './utils';

export interface ApiShareOptions {
  publicHost: string;
}

const OSC_ENVIRONMENT = process.env.OSC_ENVIRONMENT ?? 'prod';

const apiShare: FastifyPluginCallback<ApiShareOptions> = (
  fastify,
  opts,
  next
) => {
  fastify.post<{
    Body: ShareRequest;
  }>(
    '/share',
    {
      schema: {
        description: 'Generate a share link for a given application path',
        body: ShareRequest,
        response: {
          200: ShareResponse,
          400: ErrorResponse,
          429: Type.Object({ error: Type.String() }),
          500: ErrorResponse
        }
      },
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          hook: 'onRequest',
          errorResponseBuilder: (_req, context) => {
            return {
              statusCode: 429,
              error: 'Too Many Requests',
              message: 'Too many requests, please try again later',
              expiresIn: context.after
            };
          }
        }
      }
    },
    async (req, reply) => {
      let shareLinkUrl = new URL(req.body.path, opts.publicHost);
      if (shareLinkUrl.origin !== new URL(opts.publicHost).origin) {
        return reply.code(400).send({
          message: 'Invalid path: must resolve within the application host'
        });
      }
      if (process.env.OSC_ACCESS_TOKEN) {
        // A configured token that is not a structurally valid JWT (e.g.
        // truncated or misconfigured) would only fail with an opaque error at
        // the OSC token service. Reject it up front. See #226.
        if (!isValidJwt(process.env.OSC_ACCESS_TOKEN)) {
          return reply
            .code(500)
            .send({ message: 'OSC_ACCESS_TOKEN is missing or malformed' });
        }
        const response = await fetch(
          `${oscTokenServiceBaseUrl(
            OSC_ENVIRONMENT
          )}/delegate/eyevinn-intercom-manager`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-pat-jwt': `Bearer ${process.env.OSC_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
              redirectUrl: shareLinkUrl.toString()
            })
          }
        );
        if (response.ok) {
          const json = (await response.json()) as { shareUrl?: string };
          if (json.shareUrl) {
            shareLinkUrl = new URL(json.shareUrl);
          }
        }
      }
      reply.send({ url: shareLinkUrl.toString() });
    }
  );
  next();
};

export default apiShare;
