import { FastifyPluginCallback } from 'fastify';
import { ErrorResponse, ShareRequest, ShareResponse } from './models';

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
          400: ErrorResponse
        }
      }
    },
    async (req, reply) => {
      let shareLinkUrl = new URL(req.body.path, opts.publicHost);
      if (process.env.OSC_ACCESS_TOKEN) {
        const response = await fetch(
          `https://token.svc.${OSC_ENVIRONMENT}.osaas.io/delegate/eyevinn-intercom-manager`,
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
