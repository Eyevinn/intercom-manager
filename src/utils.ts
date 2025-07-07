// Custom light assert function because jest breaks node:assert
import { Log } from './log';

// see https://github.com/jestjs/jest/issues/7547
export function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    // There is no good way to manipulate the stack trace, so stack traces will point to this line
    throw new Error(message);
  }
}

export function getIceServers(): string[] {
  const defaultStun = 'stun:stun.l.google.com:19302';
  const iceServers = process.env.ICE_SERVERS || '';
  const entries = iceServers
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  const links: string[] = [];

  for (const entry of entries) {
    try {
      const url = new URL(entry);

      if (url.protocol.startsWith('stun')) {
        links.push(`<${url.href}>; rel="ice-server"`);
      } else if (url.protocol.startsWith('turn')) {
        const username = url.username;
        const credential = url.password;
        const turnUrl = `${url.protocol.slice(0, -1)}:${url.host}${
          url.pathname
        }`;
        if (username && credential) {
          links.push(
            `<${turnUrl}>; rel="ice-server"; username="${username}"; credential="${credential}"`
          );
        }
      }
    } catch {
      Log().warn(`Invalid ICE server URL: ${entry}`);
    }
  }

  // Fallback to default STUN if none was provided
  if (!links.some((l) => l.includes('stun:'))) {
    links.unshift(`<${defaultStun}>; rel="ice-server"`);
  }

  return links;
}
