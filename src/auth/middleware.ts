import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, JwtPayload } from './jwt';
import { Log } from '../log';

// Extend Fastify's request type to include the authenticated client
declare module 'fastify' {
  interface FastifyRequest {
    client?: JwtPayload;
  }
}

/**
 * Fastify preHandler hook that enforces JWT authentication.
 *
 * Extracts a Bearer token from the Authorization header, verifies it,
 * and attaches the decoded payload to `request.client`.
 *
 * Returns 401 if the token is missing or invalid.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    Log().warn(
      `Auth failed: missing or malformed Authorization header for ${request.method} ${request.url}`
    );
    reply.code(401).send({ message: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7); // Remove 'Bearer '

  try {
    const payload = verifyToken(token);
    request.client = payload;
  } catch (err: any) {
    Log().warn(`Auth failed: invalid token for ${request.method} ${request.url} — ${err.message}`);
    reply.code(401).send({ message: 'Invalid or expired token' });
    return;
  }
}
