// Custom light assert function because jest breaks node:assert
// see https://github.com/jestjs/jest/issues/7547
export function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    // There is no good way to manipulate the stack trace, so stack traces will point to this line
    throw new Error(message);
  }
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
        console.warn('Invalid TURN format, missing "@":', entry);
        continue;
      }

      const creds = rest.slice(0, atIndex);
      const host = rest.slice(atIndex + 1);

      const [username, credential] = creds.split(':');
      if (!username || !credential) {
        console.warn('Invalid TURN credentials:', creds);
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
