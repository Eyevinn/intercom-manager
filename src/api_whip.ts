import { Static, Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import sdpTransform, { parse } from 'sdp-transform';
import { v4 as uuidv4 } from 'uuid';
import { CoreFunctions } from './api_productions_core_functions';
import { Log } from './log';
import { Line, WhipWhepRequest, WhipWhepResponse } from './models';
import { ProductionManager } from './production_manager';
import { SmbProtocol } from './smb';
import { getIceServers } from './utils';
import { DbManager } from './db/interface';

export interface ApiWhipOptions {
  smbServerBaseUrl: string;
  endpointIdleTimeout: string;
  smbServerApiKey?: string;
  coreFunctions: CoreFunctions;
  productionManager: ProductionManager;
  dbManager: DbManager;
  whipAuthKey?: string;
}

export const apiWhip: FastifyPluginCallback<ApiWhipOptions> = (
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

  const smb = new SmbProtocol();
  const smbServerApiKey = opts.smbServerApiKey || '';
  const coreFunctions = opts.coreFunctions;
  const whipAuthKey = opts.whipAuthKey?.trim();

  async function requireWhipAuth(request: any, reply: any): Promise<boolean> {
    if (!whipAuthKey) {
      return true; // auth disabled
    }

    const authHeader =
      request.headers['authorization'] || request.headers['Authorization'];
    const prefix = 'Bearer ';

    if (
      !authHeader ||
      typeof authHeader !== 'string' ||
      !authHeader.startsWith(prefix) ||
      authHeader.slice(prefix.length).trim() !== whipAuthKey //checks if presented key is equal to actual key
    ) {
      reply
        .header('WWW-Authenticate', 'Bearer realm="whip", charset="UTF-8"')
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
    '/whip/:productionId/:lineId/:username',
    {
      schema: {
        description: 'WHIP endpoint for ingesting WebRTC streams',
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
      if (!(await requireWhipAuth(request, reply))) return;
      try {
        const { productionId, lineId, username } = request.params;

        Log().info(
          `Received WHIP request - username: ${username}, production: ${productionId}, line: ${lineId}, IP: ${request.ip}`
        );

        if (request.headers['content-type'] !== 'application/sdp') {
          return reply.code(415).send({ error: 'Unsupported Media Type' });
        }

        const sdpOffer = parse(request.body);

        // Create a unique session ID for this WHIP connection
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
          false, // no data channel needed for WHIP
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
          `Creating WHIP user session - username: ${username}, sessionId: ${sessionId}, production: ${productionId}, line: ${lineId}`
        );

        await productionManager.createUserSession(
          smbConferenceId,
          productionId,
          lineId,
          sessionId,
          username,
          true
        );

        // Update user endpoint information
        await productionManager.updateUserEndpoint(
          sessionId,
          endpointId,
          endpoint
        );

        // Create the Location URL for the WHIP resource
        // Location URL can be relative to Request URL, so this is OK.
        const locationUrl = `/api/v1/whip/${productionId}/${lineId}/${sessionId}`;

        // Set response headers
        reply.headers({
          'Content-Type': 'application/sdp',
          Location: locationUrl,
          ETag: sessionId,
          Link: getIceServers().join(','),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS, PATCH',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, ETag, If-Match, Link',
          'Access-Control-Expose-Headers': 'Location, ETag, Link'
        });

        await reply.code(201).send(sdpAnswer);
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send({ error: `Failed to process WHIP request: ${err}` });
      }
    }
  );

  fastify.delete<{
    Params: { productionId: string; lineId: string; sessionId: string };
  }>(
    '/whip/:productionId/:lineId/:sessionId',
    {
      schema: {
        description: 'Terminate a WHIP connection',
        response: {
          200: Type.String({ description: 'OK' }),
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      if (!(await requireWhipAuth(request, reply))) return;
      try {
        const { sessionId } = request.params;

        Log().info(
          `Received WHIP DELETE request - sessionId: ${sessionId}, IP: ${request.ip}`
        );

        const doc = await opts.dbManager.getSession(sessionId);
        if (!doc) {
          Log().warn(
            `WHIP session not found for deletion - sessionId: ${sessionId}`
          );
          reply.code(404).send({ error: 'WHIP session not found' });
          return;
        }

        // Remove the user session
        await opts.dbManager.deleteUserSession(sessionId);
        productionManager.removeUserSession(sessionId);
        productionManager.emit('users:change');

        Log().info(
          `WHIP session deleted successfully - sessionId: ${sessionId}`
        );
        // Add CORS headers for browser compatibility
        reply.headers({
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });

        reply.code(200).send('OK');
      } catch (err) {
        Log().error(
          `Failed to delete WHIP session - sessionId: ${request.params.sessionId}:`,
          err
        );
        reply
          .code(500)
          .send({ error: `Failed to terminate WHIP connection: ${err}` });
      }
    }
  );

  fastify.patch<{
    Params: { productionId: string; lineId: string; sessionId: string };
    Body: string;
  }>('/whip/:productionId/:lineId/:sessionId', {}, async (request, reply) => {
    reply.code(405).send('Method not allowed');
  });

  fastify.options<{
    Params: { productionId: string; lineId: string };
  }>(
    '/whip/:productionId/:lineId',
    {
      schema: {
        description: 'CORS preflight and WHIP discovery endpoint',
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
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS, PATCH',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, ETag',
          'Access-Control-Expose-Headers': 'Location, ETag, Link',
          'Access-Control-Max-Age': '86400', // 24 hours
          'Accept-Post': 'application/sdp'
        });

        reply.code(200).send('OK');
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send({ error: `Failed to process OPTIONS request: ${err}` });
      }
    }
  );

  next();
};

export default apiWhip;
