import { Static, Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import sdpTransform, { parse } from 'sdp-transform';
import { v4 as uuidv4 } from 'uuid';
import { CoreFunctions } from './api_productions_core_functions';
import { Log } from './log';
import { Line, WhipRequest, WhipResponse } from './models';
import { ProductionManager } from './production_manager';
import { SmbProtocol } from './smb';
import { getIceServers } from './utils';

export interface ApiWhipOptions {
  smbServerBaseUrl: string;
  endpointIdleTimeout: string;
  smbServerApiKey?: string;
  coreFunctions: CoreFunctions;
  productionManager: ProductionManager;
  publicHost: string;
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

  fastify.post<{
    Params: { productionId: string; lineId: string; username: string };
    Body: Static<typeof WhipRequest>;
    Reply: Static<typeof WhipResponse> | { error: string };
  }>(
    '/whip/:productionId/:lineId/:username',
    {
      schema: {
        description: 'WHIP endpoint for ingesting WebRTC streams',
        body: WhipRequest,
        response: {
          201: WhipResponse,
          400: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          errorResponseBuilder: () => ({
            error: 'Too many requests, please try again later',
            code: 429
          })
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionId, lineId, username } = request.params;

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
          true, // no data channel needed for WHIP
          true, // iceControlling
          'ssrc-rewrite', // relayType
          parseInt(opts.endpointIdleTimeout, 10)
        );

        await coreFunctions.configureEndpointForWhip(
          sdpOffer,
          endpoint,
          smb,
          smbServerUrl,
          smbServerApiKey,
          smbConferenceId,
          endpointId
        );

        const sdpAnswer = await coreFunctions.createAnswer(sdpOffer, endpoint);

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

        // Create user session in production manager
        productionManager.createUserSession(
          smbConferenceId,
          productionId,
          lineId,
          sessionId,
          username,
          true
        );

        // Update user endpoint information
        productionManager.updateUserEndpoint(sessionId, endpointId, endpoint);

        // Create the Location URL for the WHIP resource
        const baseUrl = opts.publicHost.endsWith('/')
          ? opts.publicHost.slice(0, -1)
          : opts.publicHost;
        const locationUrl = `${baseUrl}/api/v1/whip/${productionId}/${lineId}/${sessionId}`;

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
      try {
        const { sessionId } = request.params;

        // Remove the user session
        const deletedSessionId = productionManager.removeUserSession(sessionId);
        if (!deletedSessionId) {
          reply.code(404).send({ error: 'WHIP session not found' });
          return;
        }

        // Add CORS headers for browser compatibility
        reply.headers({
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });

        reply.code(200).send('OK');
      } catch (err) {
        Log().error(err);
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
