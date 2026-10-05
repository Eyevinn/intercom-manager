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

// Maximum age of a reusable share link before it is considered expired and can
// no longer be redeemed. Overridable via SHARE_LINK_MAX_AGE_MS; defaults to
// 7 days. Follows the `parseInt(process.env.X ?? 'default', 10)` convention used
// for the WHIP_* timers in production_manager.ts. See #316.
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const SHARE_LINK_MAX_AGE_MS = parseInt(
  process.env.SHARE_LINK_MAX_AGE_MS ?? `${SEVEN_DAYS_MS}`,
  10
);

// Thrown when the external OSC token service cannot be reached or declines the
// request. Lets route handlers return a clean 502 instead of leaking an opaque
// 500 when OSC has a transient blip. See #316.
class OscTokenServiceError extends Error {}

// Returns true when it is safe to redirect a browser to `url`. The OSC token
// service returns an absolute https share URL on its own origin, and the
// no-token fallback returns the already-origin-validated manager URL. Anything
// else (e.g. a non-https or unexpected target) is rejected as defense in depth.
function isAllowedRedirectTarget(url: URL, publicOrigin: string): boolean {
  return url.protocol === 'https:' || url.origin === publicOrigin;
}

// Mint a fresh single-use OSC delegate token for the given redirect URL and
// return the decorated share URL. The external OSC token service issues a
// 5-minute, single-use Common Access Token (it returns 401 "Token has already
// been used" on reuse), so this must be invoked once per link *access* rather
// than once per link. When no OSC access token is configured, or the service
// declines, the original URL is returned unchanged. A transport-level failure
// (OSC unreachable) is surfaced as an OscTokenServiceError so callers can return
// a clean error instead of an opaque 500.
async function mintOscShareUrl(redirectUrl: URL): Promise<URL> {
  if (!process.env.OSC_ACCESS_TOKEN) {
    return redirectUrl;
  }
  let response: Response;
  try {
    response = await fetch(
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
  } catch (e) {
    throw new OscTokenServiceError(
      `Failed to reach OSC token service: ${(e as Error).message}`
    );
  }
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

      try {
        const finalUrl = await mintOscShareUrl(shareLinkUrl);
        reply.send({ url: finalUrl.toString() });
      } catch (e) {
        if (e instanceof OscTokenServiceError) {
          return reply
            .code(502)
            .send({ message: 'OSC token service is currently unavailable' });
        }
        throw e;
      }
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
          410: ErrorResponse,
          429: Type.Object({ error: Type.String() }),
          500: ErrorResponse,
          502: ErrorResponse
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
      // Reusable links expire after SHARE_LINK_MAX_AGE_MS so a leaked link does
      // not mint tokens forever. See #316.
      if (Date.now() - shareLink.createdAt > SHARE_LINK_MAX_AGE_MS) {
        return reply.code(410).send({ message: 'Share link has expired' });
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
      let finalUrl: URL;
      try {
        finalUrl = await mintOscShareUrl(targetUrl);
      } catch (e) {
        if (e instanceof OscTokenServiceError) {
          return reply
            .code(502)
            .send({ message: 'OSC token service is currently unavailable' });
        }
        throw e;
      }
      // Defense-in-depth: the redirect target comes from the external OSC token
      // service. Only follow a trusted (https or same-origin) target.
      if (!isAllowedRedirectTarget(finalUrl, publicOrigin)) {
        return reply
          .code(502)
          .send({ message: 'OSC token service returned an invalid share URL' });
      }
      return reply.redirect(finalUrl.toString());
    }
  );

  // Revocation endpoint for reusable share links. Deleting the stored document
  // immediately invalidates the link (subsequent GETs 404). See #316.
  fastify.delete<{
    Params: { id: string };
  }>(
    '/share/:id',
    {
      schema: {
        description: 'Revoke a reusable share link',
        params: Type.Object({
          id: Type.String({ description: 'The reusable share link id' })
        }),
        response: {
          204: Type.Null(),
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
      const deleted = await opts.dbManager.deleteShareLink(req.params.id);
      if (!deleted) {
        return reply.code(404).send({ message: 'Share link not found' });
      }
      return reply.code(204).send();
    }
  );

  next();
};

export default apiShare;
