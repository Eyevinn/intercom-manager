// Shared resolver for the allowed CORS origin(s). Both the CORS registration in
// api.ts and the startup validation in server.ts import from here so they agree
// on the exact same logic.
//
// Resolution order:
//   1. CORS_ORIGIN (comma-separated) — if set and non-empty, use it.
//   2. Otherwise derive the instance's own origin from OSC_HOSTNAME
//      (auto-injected by Eyevinn Open Source Cloud). Accepts either a bare
//      hostname (prefixed with https://) or a full URL (trailing slash
//      stripped).
//   3. If neither is set, return null so callers can fail fast.
//
// Empty / whitespace-only values are treated as unset.

/**
 * Normalize an OSC_HOSTNAME value into a full origin.
 * - Bare hostname (`myinstance.eyevinn.technology`) → `https://myinstance.eyevinn.technology`
 * - Full URL (`https://x.osc.io/`) → `https://x.osc.io` (trailing slash stripped)
 */
function normalizeOscHostname(hostname: string): string {
  const trimmed = hostname.trim();
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

/**
 * Resolve the allowed CORS origin(s).
 *
 * @returns an array of allowed origins, or null when neither CORS_ORIGIN nor
 *   OSC_HOSTNAME is configured (both unset/empty/whitespace).
 */
export function resolveCorsOrigin(): string[] | null {
  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin && corsOrigin.trim()) {
    return corsOrigin.split(',');
  }

  const oscHostname = process.env.OSC_HOSTNAME;
  if (oscHostname && oscHostname.trim()) {
    return [normalizeOscHostname(oscHostname)];
  }

  return null;
}

/**
 * Whether a CORS origin can be resolved from the environment (either
 * CORS_ORIGIN or OSC_HOSTNAME is set and non-empty).
 */
export function hasCorsConfig(): boolean {
  return resolveCorsOrigin() !== null;
}
