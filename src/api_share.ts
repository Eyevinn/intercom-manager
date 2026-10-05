import { Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import { ErrorResponse, ShareRequest, ShareResponse } from './models';
import { DbManager } from './db/interface';
import { isValidJwt, oscTokenServiceBaseUrl } from './utils';

export interface ApiShareOptions {
  publicHost: string;
  dbManager: DbManager;
}

const OSC_ENVIRONMENT = process.env.OSC_ENVIRONMENT ?? 'prod';

// Mint a fresh single-use OSC delegate token for the given redirect URL and
// return the decorated share URL. The external OSC token service issues a
// 5-minute, single-use Common Access Token (it returns 401 "Token has already
// been used" on reuse), so this must be invoked once per link *access* rather
// than once per link. When no OSC access token is configured, or the service
// declines, the original URL is returned unchanged.
async function mintOscShareUrl(redirectUrl: URL): Promise<URL> {
  if (!process.env.OSC_ACCESS_TOKEN) {
    return redirectUrl;
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
        redirectUrl: redirectUrl.toString()
      })
    }
  );
  if (response.ok) {
    const json = (await response.json()) as { shareUrl?: string };
    if (json.shareUrl) {
      return new URL(json.shareUrl);
    }
  }
  return redirectUrl;
}

const apiShare: FastifyPluginCallback<ApiShareOptions> = (
  fastify,
  opts,
  next
) => {
  const publicOrigin = new URL(opts.publicHost).origin;

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
      const shareLinkUrl = new URL(req.body.path, opts.publicHost);
      if (shareLinkUrl.origin !== publicOrigin) {
        return reply.code(400).send({
          message: 'Invalid path: must resolve within the application host'
        });
      }
      // A configured token that is not a structurally valid JWT (e.g.
      // truncated or misconfigured) would only fail with an opaque error at
      // the OSC token service. Reject it up front. See #226.
      if (
        process.env.OSC_ACCESS_TOKEN &&
        !isValidJwt(process.env.OSC_ACCESS_TOKEN)
      ) {
        return reply
          .code(500)
          .send({ message: 'OSC_ACCESS_TOKEN is missing or malformed' });
      }

      // Reusable (non-single-use) link: persist the path server-side and return
      // a manager-side link addressing it. The single-use OSC delegate token is
      // minted fresh on each redemption (see GET /share/:id) instead of being
      // embedded once, so the link itself stays valid for recurring sessions.
      // See #316.
      if (req.body.reusable) {
        const shareLink = await opts.dbManager.addShareLink({
          path: req.body.path,
          createdAt: Date.now()
        });
        const reusableUrl = new URL(
          `/api/v1/share/${shareLink._id}`,
          opts.publicHost
        );
        return reply.send({ url: reusableUrl.toString() });
      }

      const finalUrl = await mintOscShareUrl(shareLinkUrl);
      reply.send({ url: finalUrl.toString() });
    }
  );

  // Redemption endpoint for reusable share links. Looks up the stored path,
  // mints a fresh single-use OSC delegate token server-side, and redirects the
  // caller to the resulting share URL. Because the token is minted per access,
  // the link can be reused for recurring sessions. See #316.
  fastify.get<{
    Params: { id: string };
  }>(
    '/share/:id',
    {
      schema: {
        description:
          'Redeem a reusable share link, minting a fresh single-use OSC ' +
          'token and redirecting to the shared application path',
        params: Type.Object({
          id: Type.String({ description: 'The reusable share link id' })
        }),
        response: {
          400: ErrorResponse,
          404: ErrorResponse,
          429: Type.Object({ error: Type.String() }),
          500: ErrorResponse
        }
      },
      config: {
        rateLimit: {
          max: 30,
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
      const shareLink = await opts.dbManager.getShareLink(req.params.id);
      if (!shareLink) {
        return reply.code(404).send({ message: 'Share link not found' });
      }
      if (
        process.env.OSC_ACCESS_TOKEN &&
        !isValidJwt(process.env.OSC_ACCESS_TOKEN)
      ) {
        return reply
          .code(500)
          .send({ message: 'OSC_ACCESS_TOKEN is missing or malformed' });
      }
      const targetUrl = new URL(shareLink.path, opts.publicHost);
      // Defense-in-depth: the path was origin-validated at creation, re-check
      // the resolved origin before redirecting.
      if (targetUrl.origin !== publicOrigin) {
        return reply.code(400).send({
          message: 'Invalid path: must resolve within the application host'
        });
      }
      const finalUrl = await mintOscShareUrl(targetUrl);
      return reply.redirect(finalUrl.toString());
    }
  );

  next();
};

export default apiShare;
