import { FastifyPluginCallback } from 'fastify';
import bearerAuthPlugin from '@fastify/bearer-auth';
import { ErrorResponse } from './models';
import { Type } from '@sinclair/typebox';
import { v4 as uuidv4 } from 'uuid';
import { CoreFunctions } from './api_productions_core_functions';
import { SmbProtocol } from './smb';

export interface ApiWhipOptions {
  whipApiKey: string;
  smbServerBaseUrl: string;
  endpointIdleTimeout: string;
  smbServerApiKey?: string;
  coreFunctions: CoreFunctions;
}

const apiWhip: FastifyPluginCallback<ApiWhipOptions> = (
  fastify,
  opts,
  next
) => {
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
    Body: string;
  }>(
    '/production/:productionId/line/:lineId/username/:username',
    {
      schema: {
        description:
          'Initiate ingest of an external source to a production and line',
        body: Type.String(),
        params: {
          productionId: Type.String(),
          lineId: Type.String(),
          username: Type.String()
        },
        response: {
          201: Type.String(),
          500: ErrorResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionId, lineId, username } = request.params;
        const sdpOffer = request.body;
        const sessionId: string = uuidv4();

        const smbConferenceId = await coreFunctions.createConferenceForLine(
          smb,
          smbServerUrl,
          smbServerApiKey,
          productionId,
          lineId
        );
        const endpointId: string = uuidv4();
        const endpoint = await coreFunctions.createEndpoint(
          smb,
          smbServerUrl,
          smbServerApiKey,
          smbConferenceId,
          endpointId,
          true,
          true,
          parseInt(opts.endpointIdleTimeout, 10)
        );
        if (!endpoint.audio) {
          throw new Error('Missing audio when creating sdp offer for endpoint');
        }
        if (!endpoint.audio.ssrcs) {
          throw new Error('Missing ssrcs when creating sdp offer for endpoint');
        }

        const sdpAnswer = await coreFunctions.createConnectionFromOffer(
          productionId,
          lineId,
          endpoint,
          username,
          endpointId,
          sessionId,
          sdpOffer,
          smb,
          smbServerUrl,
          smbServerApiKey,
          smbConferenceId
        );
        const locationUrl = `/whip/session/${sessionId}`;
        reply.headers({
          'Content-Type': 'application/sdp',
          Location: locationUrl
        });
        reply.code(201).send(sdpAnswer);
      } catch (err) {
        console.error(err);
        reply.code(500).send({ message: 'Unhandled error: ' + err });
      }
    }
  );
  next();
};

export default apiWhip;
