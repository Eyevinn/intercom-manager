import { timingSafeEqual } from 'crypto';
import { onRequestHookHandler } from 'fastify';
import { Role, RoleFeatures } from './models';

/**
 * Roles & permissions support (#123).
 *
 * The manager understands three roles — `admin`, `editor` and `participant` —
 * each unlocked by its own password. Passwords are read from environment
 * variables and never hardcoded:
 *   - ROLE_ADMIN_PASSWORD
 *   - ROLE_EDITOR_PASSWORD
 *   - ROLE_PARTICIPANT_PASSWORD
 *
 * A role whose env var is unset (or empty after trimming) is simply
 * unavailable: no password will ever resolve to it. This keeps the feature
 * opt-in and backwards compatible.
 *
 * `POST /api/v1/permissions` (see src/api_productions.ts) exchanges a role
 * password for the resolved role and the set of frontend feature flags for
 * that role.
 *
 * Separately, `createAuthHook()` provides OPT-IN authentication of all incoming
 * requests. It only enforces an Authorization header when `REQUIRE_AUTH=true`
 * is set; when unset (the default) behaviour is unchanged and existing
 * unauthenticated clients keep working.
 */

const ROLE_ENV_VARS: Record<Role, string> = {
  admin: 'ROLE_ADMIN_PASSWORD',
  editor: 'ROLE_EDITOR_PASSWORD',
  participant: 'ROLE_PARTICIPANT_PASSWORD'
};

// Highest privilege first. If two roles happen to share a password the more
// privileged role wins, so a password is never silently downgraded.
const ROLE_PRECEDENCE: Role[] = ['admin', 'editor', 'participant'];

// Frontend feature flags per role. admin can do everything; editor manages
// content but cannot delete whole productions; participant can only join a
// line.
const ROLE_FEATURES: Record<Role, RoleFeatures> = {
  admin: {
    canCreateProduction: true,
    canEditProduction: true,
    canDeleteProduction: true,
    canManageLines: true,
    canRemoveParticipants: true,
    canManageIngests: true,
    canJoinLine: true
  },
  editor: {
    canCreateProduction: true,
    canEditProduction: true,
    canDeleteProduction: false,
    canManageLines: true,
    canRemoveParticipants: true,
    canManageIngests: true,
    canJoinLine: true
  },
  participant: {
    canCreateProduction: false,
    canEditProduction: false,
    canDeleteProduction: false,
    canManageLines: false,
    canRemoveParticipants: false,
    canManageIngests: false,
    canJoinLine: true
  }
};

/**
 * Constant-time string comparison used for all password/token checks so the
 * configured secret's length/contents are not leaked through timing side
 * channels. Mirrors the comparison used by the API key and reauth guards.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

/**
 * Resolve a plaintext role password to the role it unlocks, or `null` when the
 * password does not match any configured role. Roles whose env var is unset or
 * empty are unavailable.
 */
export function resolveRoleFromPassword(password: string): Role | null {
  if (!password) {
    return null;
  }
  for (const role of ROLE_PRECEDENCE) {
    const configured = process.env[ROLE_ENV_VARS[role]]?.trim();
    if (configured && constantTimeEquals(password, configured)) {
      return role;
    }
  }
  return null;
}

/** The frontend feature flags for a given role. */
export function getRoleFeatures(role: Role): RoleFeatures {
  return ROLE_FEATURES[role];
}

/** Whether opt-in request authentication is enabled (REQUIRE_AUTH=true). */
export function isAuthRequired(): boolean {
  return process.env.REQUIRE_AUTH === 'true';
}

// Paths that must stay reachable even when REQUIRE_AUTH is enabled: the health
// check, the Swagger docs, and the permissions endpoint itself (otherwise a
// client could never obtain a role to authenticate with). Compared against the
// path with any query string and trailing slash removed.
const AUTH_EXEMPT_PATHS = new Set(['/', '/api/v1/permissions']);

function normalizePath(url: string): string {
  const path = url.split('?')[0];
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

function isExemptPath(url: string): boolean {
  const path = normalizePath(url);
  return AUTH_EXEMPT_PATHS.has(path) || path.startsWith('/api/docs');
}

/**
 * Opt-in `onRequest` hook that authenticates ALL incoming requests based on
 * the Authorization header — but only when `REQUIRE_AUTH=true` is set. When the
 * flag is unset (default) the hook is a no-op and every request passes through
 * unchanged, so existing unauthenticated clients are not broken.
 *
 * When enabled, a request must present `Authorization: Bearer <role-password>`
 * where the password matches one of the configured role passwords. CORS
 * preflight (OPTIONS) requests and the exempt paths above are always allowed
 * through. Anything else is rejected with a generic 401.
 */
export function createAuthHook(): onRequestHookHandler {
  return (request, reply, done) => {
    if (!isAuthRequired()) {
      done();
      return;
    }

    if (request.method === 'OPTIONS' || isExemptPath(request.url)) {
      done();
      return;
    }

    const authHeader = request.headers['authorization'];
    const prefix = 'Bearer ';
    const token =
      typeof authHeader === 'string' && authHeader.startsWith(prefix)
        ? authHeader.slice(prefix.length).trim()
        : '';

    if (resolveRoleFromPassword(token)) {
      done();
      return;
    }

    reply
      .header('WWW-Authenticate', 'Bearer realm="intercom", charset="UTF-8"')
      .code(401)
      .send({ error: 'Unauthorized' });
  };
}
