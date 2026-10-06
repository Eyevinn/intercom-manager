// Resolver for the allowlist of trusted origins used by the CSRF
// Origin/Referer check (see src/csrf.ts). The allowlist is configured via the
// CSRF_TRUSTED_ORIGINS environment variable (comma-separated). When the
// variable is unset/empty the check is a no-op and every request is allowed,
// so existing deployments are unaffected by default.

/**
 * Normalize an origin for comparison: trim whitespace and strip any trailing
 * slashes so that `https://example.com/` and `https://example.com` are equal.
 */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

/**
 * Resolve the allowlist of trusted origins from CSRF_TRUSTED_ORIGINS.
 *
 * @returns an array of normalized, non-empty origins, or null when
 *   CSRF_TRUSTED_ORIGINS is unset/empty/whitespace (i.e. the CSRF check should
 *   be a no-op).
 */
export function resolveTrustedOrigins(): string[] | null {
  const raw = process.env.CSRF_TRUSTED_ORIGINS;
  if (!raw || !raw.trim()) {
    return null;
  }
  const origins = raw
    .split(',')
    .map((o) => normalizeOrigin(o))
    .filter((o) => o.length > 0);
  return origins.length > 0 ? origins : null;
}
