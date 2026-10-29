// Resolver for Fastify's `trustProxy` option, driven by the TRUST_PROXY env var.
//
// Behind a reverse proxy (e.g. the frontend nginx in front of /api/) every
// request arrives from the proxy's address, so `request.ip` is the same for all
// clients and they share one @fastify/rate-limit budget. When the proxy is
// trusted, Fastify derives `request.ip` from X-Forwarded-For instead.
//
// This is only safe when a trusted proxy is actually in front of the manager
// (otherwise clients can spoof X-Forwarded-For), so it defaults to OFF.
//
// Accepted values:
//   unset / empty / "false"  -> false (do not trust any proxy)
//   "true"                   -> true (trust all hops)
//   "10.0.0.0/8,172.16.0.1"  -> comma-separated trusted proxy addresses/CIDRs

export type TrustProxy = boolean | string[];

export function resolveTrustProxy(
  value: string | undefined = process.env.TRUST_PROXY
): TrustProxy {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'false') return false;
  if (trimmed.toLowerCase() === 'true') return true;
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
