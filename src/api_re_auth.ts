import { timingSafeEqual } from 'crypto';
import { FastifyPluginCallback } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorResponse, ReAuthResponse } from './models';
import { oscTokenServiceBaseUrl } from './utils';

export interface ApiReAuthOptions {
  reAuthKey?: string;
}

const OSC_ACCESS_TOKEN = process.env.OSC_ACCESS_TOKEN;
const OSC_ENVIRONMENT = process.env.OSC_ENVIRONMENT ?? 'prod';

const REAUTH_MAX_ATTEMPTS = 3;
const REAUTH_RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET /api/v1/reauth
 *
 * This endpoint renews the OSC service access token (SAT). It exchanges the
 * configured OSC Personal Access Token (`OSC_ACCESS_TOKEN`) for a fresh service
 * access token from the OSC token service and stores it in the
 * `eyevinn-intercom-manager.sat` cookie, which lives for two hours, so that API
 * calls keep working as the previous token approaches expiry. With no
 * `OSC_ACCESS_TOKEN` configured the service is not running in an OSC context
 * and the route responds with 405.
 *
 * Access to this route is protected: when a `reAuthKey` is configured the
 * request must present a matching `Authorization: Bearer <key>` header,
 * otherwise the route responds with 401. This prevents unauthenticated callers
 * from minting fresh SATs. See #264. The renewed SAT is never returned in the
 * response body; it is delivered only via the httpOnly cookie above.
 */
const apiReAuth: FastifyPluginCallback<ApiReAuthOptions> = (
  fastify,
  opts,
  next
) => {
  const reAuthKey = opts.reAuthKey?.trim();

  async function requireReAuth(request: any, reply: any): Promise<boolean> {
    if (!reAuthKey) {
      return true; // auth disabled
    }

    const authHeader =
      request.headers['authorization'] || request.headers['Authorization'];
    const prefix = 'Bearer ';

    const token = authHeader?.startsWith?.(prefix)
      ? authHeader.slice(prefix.length).trim()
      : '';
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(reAuthKey);
    const isValid =
      tokenBuf.length === keyBuf.length && timingSafeEqual(tokenBuf, keyBuf);

    if (!authHeader || typeof authHeader !== 'string' || !isValid) {
      reply
        .header('WWW-Authenticate', 'Bearer realm="reauth", charset="UTF-8"')
        .code(401)
        .send({ error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  fastify.get(
    '/reauth',
    {
      schema: {
        description:
          'Generate a new OSC Service Access Token for the OSC Intercom instance.',
        response: {
          200: ReAuthResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          405: ErrorResponse,
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
    async (request, reply) => {
      if (!(await requireReAuth(request, reply))) {
        return;
      }
      if (OSC_ACCESS_TOKEN) {
        const url = `${oscTokenServiceBaseUrl(OSC_ENVIRONMENT)}/servicetoken`;
        const options = {
          method: 'POST' as const,
          headers: {
            'Content-Type': 'application/json',
            'x-pat-jwt': `Bearer ${OSC_ACCESS_TOKEN}`
          },
          body: JSON.stringify({
            serviceId: 'eyevinn-intercom-manager'
          })
        };

        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= REAUTH_MAX_ATTEMPTS; attempt++) {
          try {
            const response = await fetch(url, options);
            if (response.ok) {
              const json = (await response.json()) as { token: string };
              reply
                .cookie(
                  'eyevinn-intercom-manager.sat',
                  `Bearer ${json.token}`,
                  {
                    path: '/',
                    httpOnly: true,
                    secure: true,
                    sameSite: 'strict',
                    maxAge: 60 * 60 * 2 // 2 hours, in seconds
                  }
                )
                .send({ success: true });
              return;
            }
            lastError = new Error(
              `ServiceToken Service responded with ${response.status} ${response.statusText}`
            );
          } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
          }
          if (attempt < REAUTH_MAX_ATTEMPTS) {
            await sleep(REAUTH_RETRY_DELAY_MS);
          }
        }

        reply.code(500).send({
          error:
            'ServiceToken Service failed to generate new SAT Token after ' +
            REAUTH_MAX_ATTEMPTS +
            ' attempts'
        });
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
