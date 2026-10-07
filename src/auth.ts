import { timingSafeEqual } from 'crypto';
import { preHandlerHookHandler } from 'fastify';

/**
 * Fastify `preHandler` hook that guards management endpoints with a static API
 * key read from the `API_KEY` environment variable. See #222.
 *
 * Behaviour:
 * - When `API_KEY` is unset or empty (after trimming) authentication is
 *   disabled and the request is allowed through unchanged. This preserves the
 *   current (dev) behaviour and keeps existing tests green.
 * - Otherwise the request must present an `Authorization: Bearer <API_KEY>`
 *   header. A missing header, a missing/malformed `Bearer ` prefix or a token
 *   that does not match the configured key results in a generic `401`.
 *
 * The key is never logged and is only ever read from `process.env`. The token
 * comparison is constant-time (via `timingSafeEqual`) to avoid leaking the key
 * length/contents through timing side channels, mirroring the WHIP/WHEP and
 * reauth guards elsewhere in this codebase.
 */
export const requireApiKey: preHandlerHookHandler = (request, reply, done) => {
  const apiKey = process.env.API_KEY?.trim();

  // Auth disabled when no API_KEY is configured (dev mode).
  if (!apiKey) {
    done();
    return;
  }

  const authHeader = request.headers['authorization'];
  const prefix = 'Bearer ';
  const token =
    typeof authHeader === 'string' && authHeader.startsWith(prefix)
      ? authHeader.slice(prefix.length).trim()
      : '';

  const tokenBuf = Buffer.from(token);
  const keyBuf = Buffer.from(apiKey);
  const isValid =
    tokenBuf.length === keyBuf.length && timingSafeEqual(tokenBuf, keyBuf);

  if (!isValid) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  done();
};
