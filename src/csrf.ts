// CSRF protection via Origin/Referer verification for state-mutating requests.
//
// This is a deliberately non-breaking, defence-in-depth check (see issue #224).
// For state-mutating methods (POST, PUT, PATCH, DELETE) the request's Origin
// header (falling back to the origin of the Referer header) is compared against
// a configured allowlist (CSRF_TRUSTED_ORIGINS). A request is rejected with 403
// ONLY when it carries an Origin/Referer whose origin is not in the allowlist.
//
// Requests that carry no Origin/Referer header at all (non-browser/native API
// clients, server-to-server calls, tests) are always allowed through, and when
// CSRF_TRUSTED_ORIGINS is unset the check is a complete no-op. Together this
// keeps the check from breaking existing clients or deployments.
//
// This intentionally does NOT use cookies/sessions or @fastify/csrf-protection:
// cookie-based auth is still being decided separately and such a token model
// would conflict with it.

import { FastifyRequest, onRequestHookHandler } from 'fastify';
import { Log } from './log';
import { normalizeOrigin, resolveTrustedOrigins } from './config/csrf-origin';

const STATE_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// WHIP/WHEP are media ingest/egress endpoints that are intentionally reachable
// cross-origin (they are served with a permissive `origin: '*'` CORS policy in
// api.ts). Applying an Origin allowlist to them would break legitimate
// cross-origin media clients, so they are exempt from the CSRF check, mirroring
// the CORS carve-out.
function isExemptPath(url: string): boolean {
  const path = url.split('?')[0];
  return (
    path.startsWith('/api/v1/whip') ||
    path.startsWith('/api/v1/whep') ||
    path.startsWith('/whip')
  );
}

/**
 * Extract the origin of a request from its Origin header, falling back to the
 * origin of the Referer header. Returns null when neither header is present or
 * parseable, which signals the caller to allow the request through.
 */
function requestOrigin(request: FastifyRequest): string | null {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin.trim()) {
    return normalizeOrigin(origin);
  }

  const referer = request.headers.referer;
  if (typeof referer === 'string' && referer.trim()) {
    try {
      return normalizeOrigin(new URL(referer).origin);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Create an `onRequest` hook that enforces Origin/Referer verification against
 * the CSRF_TRUSTED_ORIGINS allowlist. The allowlist is resolved once, when the
 * hook is created (i.e. when the app is built).
 */
export function createCsrfOriginHook(): onRequestHookHandler {
  const trustedOrigins = resolveTrustedOrigins();

  return async function csrfOriginHook(request, reply) {
    // No allowlist configured → no-op (allow everything).
    if (!trustedOrigins) {
      return;
    }
    // Only guard state-mutating methods; safe methods (GET, HEAD, OPTIONS) are
    // never blocked.
    if (!STATE_MUTATING_METHODS.has(request.method)) {
      return;
    }
    if (isExemptPath(request.url)) {
      return;
    }

    const origin = requestOrigin(request);
    // No Origin/Referer header → allow (non-browser/native/server-to-server).
    if (origin === null) {
      return;
    }
    if (trustedOrigins.includes(origin)) {
      return;
    }

    Log().warn(
      `CSRF: rejected ${request.method} ${request.url} from disallowed origin ${origin}`
    );
    return reply
      .code(403)
      .send({ error: 'CSRF validation failed: origin not allowed' });
  };
}
