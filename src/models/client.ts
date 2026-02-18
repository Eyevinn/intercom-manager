import { Static, Type } from '@sinclair/typebox';

// ── TypeBox schemas for client registration and presence ──

/**
 * Core client document stored in CouchDB.
 * _id is the persistent clientId (UUID v4).
 */
export const ClientDocument = Type.Object({
  _id: Type.String({ description: 'Persistent client ID (UUID v4)' }),
  _rev: Type.Optional(Type.String({ description: 'CouchDB revision' })),
  docType: Type.Literal('client', {
    description: 'Document type discriminator for CouchDB'
  }),
  name: Type.String({ description: 'Display name' }),
  role: Type.String({ description: 'Client role (e.g., producer, reporter)' }),
  location: Type.String({
    description: 'Location / editorial office (Plats/Redaktion)'
  }),
  isOnline: Type.Boolean({
    description: 'Whether the client is currently connected'
  }),
  lastSeenAt: Type.String({
    format: 'date-time',
    description: 'ISO timestamp of last activity'
  }),
  createdAt: Type.String({
    format: 'date-time',
    description: 'ISO timestamp of initial registration'
  })
});

export type ClientDocument = Static<typeof ClientDocument>;

/**
 * Request body for POST /api/v1/client/register
 */
export const ClientRegistrationRequest = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Display name'
  }),
  role: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Client role'
  }),
  location: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Location / editorial office'
  }),
  existingClientId: Type.Optional(
    Type.String({
      maxLength: 100,
      description:
        'If provided and valid, reuse this persistent client ID (returning user)'
    })
  )
});

export type ClientRegistrationRequest = Static<
  typeof ClientRegistrationRequest
>;

/**
 * Response body for POST /api/v1/client/register
 */
export const ClientRegistrationResponse = Type.Object({
  clientId: Type.String(),
  token: Type.String(),
  name: Type.String(),
  role: Type.String(),
  location: Type.String()
});

export type ClientRegistrationResponse = Static<
  typeof ClientRegistrationResponse
>;

/**
 * Response body for GET /api/v1/client/me and GET /api/v1/client/:clientId
 */
export const ClientProfileResponse = Type.Object({
  clientId: Type.String(),
  name: Type.String(),
  role: Type.String(),
  location: Type.String(),
  isOnline: Type.Boolean(),
  lastSeenAt: Type.String()
});

export type ClientProfileResponse = Static<typeof ClientProfileResponse>;

/**
 * Request body for PATCH /api/v1/client/me
 */
export const ClientUpdateRequest = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  role: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  location: Type.Optional(Type.String({ minLength: 1, maxLength: 100 }))
});

export type ClientUpdateRequest = Static<typeof ClientUpdateRequest>;

/**
 * Response body for GET /api/v1/client/list
 */
export const ClientListResponse = Type.Array(ClientProfileResponse);

export type ClientListResponse = Static<typeof ClientListResponse>;
