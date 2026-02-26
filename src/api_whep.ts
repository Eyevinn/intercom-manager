import { timingSafeEqual } from 'crypto';
import { Static, Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import sdpTransform, { parse } from 'sdp-transform';
import { v4 as uuidv4 } from 'uuid';
import { CoreFunctions } from './api_productions_core_functions';
import { Log } from './log';
import { Line, WhipWhepRequest, WhipWhepResponse } from './models';
import { ProductionManager } from './production_manager';
import { ISmbProtocol, SmbProtocol } from './smb';
import { getIceServers } from './utils';
import { DbManager } from './db/interface';

export interface ApiWhepOptions {
  smbServerBaseUrl: string;
  endpointIdleTimeout: string;
  smbServerApiKey?: string;
  coreFunctions: CoreFunctions;
  productionManager: ProductionManager;
  dbManager: DbManager;
  whipAuthKey?: string;
  smb?: ISmbProtocol;
}

export const apiWhep: FastifyPluginCallback<ApiWhepOptions> = (
  fastify,
  opts,
  next
) => {
  const productionManager = opts.productionManager;

  fastify.addContentTypeParser(
    'application/sdp',
    { parseAs: 'string' },
    (req, body, done) => {
      done(null, body);
    }
  );

  fastify.addContentTypeParser(
    'application/trickle-ice-sdpfrag',
    { parseAs: 'string' },
    (req, body, done) => {
      done(null, body);
    }
  );

  const smbServerUrl = new URL(
    '/conferences/',
    opts.smbServerBaseUrl
  ).toString();

  const smb = opts.smb || new SmbProtocol();
  const smbServerApiKey = opts.smbServerApiKey || '';
  const coreFunctions = opts.coreFunctions;
  const whipAuthKey = opts.whipAuthKey?.trim();

  async function requireWhepAuth(request: any, reply: any): Promise<boolean> {
    if (!whipAuthKey) {
      return true; // auth disabled
    }

    const authHeader =
      request.headers['authorization'] || request.headers['Authorization'];
    const prefix = 'Bearer ';

    const token = authHeader?.startsWith?.(prefix)
      ? authHeader.slice(prefix.length).trim()
      : '';
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(whipAuthKey);
    const isValid =
      tokenBuf.length === keyBuf.length && timingSafeEqual(tokenBuf, keyBuf);

    if (!authHeader || typeof authHeader !== 'string' || !isValid) {
      reply
        .header('WWW-Authenticate', 'Bearer realm="whep", charset="UTF-8"')
        .code(401)
        .send({ error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  fastify.post<{
    Params: { productionId: string; lineId: string; username: string };
    Body: Static<typeof WhipWhepRequest>;
    Reply: Static<typeof WhipWhepResponse> | { error: string };
  }>(
    '/whep/:productionId/:lineId/:username',
    {
      schema: {
        description: 'WHEP endpoint for Egress WebRTC streams',
        params: Type.Object({
          productionId: Type.String({ maxLength: 200 }),
          lineId: Type.String({ maxLength: 200 }),
          username: Type.String({ maxLength: 200 })
        }),
        body: WhipWhepRequest,
        response: {
          201: WhipWhepResponse,
          400: Type.Object({ error: Type.String() }),
          406: Type.Object({ error: Type.String() }),
          415: Type.Object({ error: Type.String() }),
          429: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          hook: 'onRequest',
          errorResponseBuilder: (_req, context) => {
            return {
              statusCode: 429,
              error: 'Too Many Requests',
              message: 'Too many requests, please try again later',
              expiresIn: context.after
            };
          }
        }
      }
    },
    async (request, reply) => {
      if (!(await requireWhepAuth(request, reply))) return;
      try {
        const { productionId, lineId, username } = request.params;

        Log().info(
          `Received WHEP request - username: ${username}, production: ${productionId}, line: ${lineId}, IP: ${request.ip}`
        );

        if (request.headers['content-type'] !== 'application/sdp') {
          return reply.code(415).send({ error: 'Unsupported Media Type' });
        }

        const sdpOffer = parse(request.body);

        // Create a unique session ID for this WHEP connection
        const sessionId = uuidv4();
        const endpointId = uuidv4();

        // Create conference and endpoint in SMB
        const smbConferenceId = await coreFunctions.createConferenceForLine(
          smb,
          smbServerUrl,
          smbServerApiKey,
          productionId,
          lineId
        );

        // Allocate endpoint with audio support
        const endpoint = await coreFunctions.createEndpoint(
          smb,
          smbServerUrl,
          smbServerApiKey,
          smbConferenceId,
          endpointId,
          true, // audio
          false, // no data channel needed for WHEP
          true, // iceControlling
          'ssrc-rewrite', // relayType
          parseInt(opts.endpointIdleTimeout, 10)
        );

        await coreFunctions.configureEndpointForWhipWhep(
          sdpOffer,
          endpoint,
          smb,
          smbServerUrl,
          smbServerApiKey,
          smbConferenceId,
          endpointId
        );

        const sdpAnswer = await coreFunctions.createWhipWhepAnswer(
          sdpOffer,
          endpoint
        );

        // Check if any m= sections from the offer were rejected
        try {
          const offerParsed = sdpOffer;
          const answerParsed = sdpTransform.parse(sdpAnswer);

          const offerMids = offerParsed.media.map((m) => m.mid).filter(Boolean);
          const answerMids = answerParsed.media
            .map((m) => m.mid)
            .filter(Boolean);

          const missingMids = offerMids.filter(
            (mid) => !answerMids.includes(mid)
          );

          if (missingMids.length > 0) {
            return reply.code(406).send({
              error: `One or more m= sections could not be negotiated: ${missingMids.join(
                ', '
              )}`
            });
          }
        } catch (err) {
          Log().error('Malformed SDP:', err);
          return reply.code(400).send({ error: 'Malformed SDP' });
        }

        // Create user session in production manager (await to guarantee DB state)
        Log().info(
          `Creating WHEP user session - username: ${username}, sessionId: ${sessionId}, production: ${productionId}, line: ${lineId}`
        );
        await productionManager.createUserSession(
          smbConferenceId,
          productionId,
          lineId,
          sessionId,
          username,
          true
        );

        // Update user endpoint info and store a stable smbPresenceKey
        await productionManager.updateUserEndpoint(
          sessionId,
          endpointId,
          endpoint
        );

        // Create the Location URL for the WHEP resource
        // Location URL can be relative to Request URL, so this is OK.
        const locationUrl = `/api/v1/whep/${productionId}/${lineId}/${sessionId}`;

        // Set response headers
        reply.headers({
          'Content-Type': 'application/sdp',
          Location: locationUrl,
          ETag: sessionId,
          Link: getIceServers().join(',')
        });

        reply.code(201).send(sdpAnswer);
      } catch (err) {
        Log().error(err);
        reply.code(500).send({ error: 'Failed to process WHEP request' });
      }
    }
  );

  fastify.delete<{
    Params: { productionId: string; lineId: string; sessionId: string };
  }>(
    '/whep/:productionId/:lineId/:sessionId',
    {
      schema: {
        description: 'Terminate a WHEP connection',
        params: Type.Object({
          productionId: Type.String({ maxLength: 200 }),
          lineId: Type.String({ maxLength: 200 }),
          sessionId: Type.String({ maxLength: 200 })
        }),
        response: {
          200: Type.String({ description: 'OK' }),
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      if (!(await requireWhepAuth(request, reply))) return;
      const { sessionId } = request.params;
      try {
        Log().info(
          `Received WHEP DELETE request - sessionId: ${sessionId}, IP: ${request.ip}`
        );

        const doc = await opts.dbManager.getSession(sessionId);
        if (!doc) {
          Log().warn(
            `WHEP session not found for deletion - sessionId: ${sessionId}`
          );
          reply.code(404).send({ error: 'WHEP session not found' });
          return;
        }

        await opts.dbManager.deleteUserSession(sessionId);
        productionManager.removeUserSession(sessionId);
        productionManager.emit('users:change');

        Log().info(
          `WHEP session deleted successfully - sessionId: ${sessionId}`
        );

        reply.code(200).send('OK');
      } catch (err) {
        Log().error(
          `Failed to delete WHEP session - sessionId: ${sessionId}:`,
          err
        );
        reply.code(500).send({ error: 'Failed to terminate WHEP connection' });
      }
    }
  );

  fastify.patch<{
    Params: { productionId: string; lineId: string; sessionId: string };
    Body: string;
  }>('/whep/:productionId/:lineId/:sessionId', {}, async (request, reply) => {
    reply.code(405).send('Method not allowed');
  });

  fastify.options<{
    Params: { productionId: string; lineId: string };
  }>(
    '/whep/:productionId/:lineId',
    {
      schema: {
        description: 'CORS preflight and WHEP discovery endpoint',
        response: {
          200: Type.String({ description: 'OK' })
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionId, lineId } = request.params;

        // Check if production and line exist
        const productionIdNum = parseInt(productionId, 10);
        if (isNaN(productionIdNum)) {
          reply.code(400).send({ error: 'Invalid production ID' });
          return;
        }

        const production = await productionManager.getProduction(
          productionIdNum
        );
        if (!production) {
          reply.code(404).send({ error: 'Production not found' });
          return;
        }

        const line = production.lines.find((l: Line) => l.id === lineId);
        if (!line) {
          reply.code(404).send({ error: 'Line not found' });
          return;
        }

        reply.headers({
          'Accept-Post': 'application/sdp'
        });

        reply.code(200).send('OK');
      } catch (err) {
        Log().error(err);
        reply.code(500).send({ error: 'Failed to process OPTIONS request' });
      }
    }
  );

  next();
};

export default apiWhep;
