import { Log } from './log';

// Custom light assert function because jest breaks node:assert
// see https://github.com/jestjs/jest/issues/7547
export function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    // There is no good way to manipulate the stack trace, so stack traces will point to this line
    throw new Error(message);
  }
}

// Strip CR/LF and other control characters (keeping regular spaces) to prevent
// log injection / forging when untrusted values are logged. Defense-in-depth:
// schema validation should already reject such values, but this guarantees no
// control chars reach the logger even on error paths.
// Removes C0 controls (incl. LF \x0a, CR \x0d, ESC \x1b), DEL \x7f and C1
// controls (\x80-\x9f). Printable characters and spaces are kept.
export function sanitizeForLog(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

// The OSC shared token service is reached at a per-*platform-environment* host
// (`token.svc.prod.osaas.io`, `token.svc.stage.osaas.io`, ...), NOT at a
// per-hosting-cluster host. `docker-entrypoint.sh` derives `OSC_ENVIRONMENT`
// from the instance hostname, which on the Elastx cluster yields the cluster
// name `prod-se` rather than the platform environment `prod`. Building the
// token-service URL straight from that produces `token.svc.prod-se.osaas.io`,
// which does not exist, so reauth/share fail. Strip a trailing per-cluster
// suffix (e.g. `-se`) so `prod-se` -> `prod` and `stage-se` -> `stage`, while
// leaving bare platform environments (`prod`, `stage`, `dev`) untouched. See
// #317. Note: this normalization is applied ONLY when building the shared OSC
// token-service host; `OSC_ENVIRONMENT` itself is left as-is for any other use.
export function oscPlatformEnvironment(rawEnvironment: string): string {
  return rawEnvironment.replace(/-[a-z]+$/, '');
}

export function oscTokenServiceBaseUrl(rawEnvironment: string): string {
  return `https://token.svc.${oscPlatformEnvironment(rawEnvironment)}.osaas.io`;
}

export function getIceServers(): string[] {
  const defaultStun = 'stun:stun.l.google.com:19302';
  const raw = process.env.ICE_SERVERS || '';
  const entries = raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  const links: string[] = [];

  for (const entry of entries) {
    if (entry.startsWith('turn:')) {
      const rest = entry.slice('turn:'.length);
      const atIndex = rest.indexOf('@');
      if (atIndex === -1) {
        Log().warn('Invalid TURN format, missing "@":', entry);
        continue;
      }

      const creds = rest.slice(0, atIndex);
      const host = rest.slice(atIndex + 1);

      const [username, credential] = creds.split(':');
      if (!username || !credential) {
        Log().warn('Invalid TURN credentials:', creds);
        continue;
      }

      const uri = `turn:${host}`;
      links.push(
        `<${uri}>; rel="ice-server"; username="${username}"; credential="${credential}"; credential-type="password"`
      );
    } else if (entry.startsWith('stun:') || entry.startsWith('stuns:')) {
      links.push(`<${entry}>; rel="ice-server"`);
    }
  }

  if (!links.some((link) => link.includes('stun:'))) {
    links.unshift(`<${defaultStun}>; rel="ice-server"`);
  }

  return links;
}
