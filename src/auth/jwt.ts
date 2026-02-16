import jwt from 'jsonwebtoken';
import { Log } from '../log';

export interface JwtPayload {
  clientId: string;
  name: string;
  role: string;
  location: string;
  iat?: number;
  exp?: number;
}

const TOKEN_EXPIRY = '24h';

let jwtSecret: string | undefined;

export function initJwt(secret: string): void {
  jwtSecret = secret;
  Log().info('JWT authentication initialized');
}

function getSecret(): string {
  if (!jwtSecret) {
    throw new Error(
      'JWT secret not initialized. Call initJwt() before using JWT functions.'
    );
  }
  return jwtSecret;
}

/**
 * Generate a JWT token for a registered client.
 */
export function generateToken(
  clientId: string,
  name: string,
  role: string,
  location: string
): string {
  const payload: JwtPayload = {
    clientId,
    name,
    role,
    location
  };

  return jwt.sign(payload, getSecret(), {
    expiresIn: TOKEN_EXPIRY,
    algorithm: 'HS256'
  });
}

/**
 * Verify a JWT token and return the decoded payload.
 * Throws if the token is invalid or expired.
 */
export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getSecret(), {
    algorithms: ['HS256']
  });
  return decoded as JwtPayload;
}
