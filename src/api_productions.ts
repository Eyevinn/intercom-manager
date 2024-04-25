import { Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import {
  NewProduction,
  LineResponse,
  SmbEndpointDescription,
  User,
  ProductionResponse,
  DetailedProductionResponse,
  UserSession
} from './models';
import { SmbProtocol } from './smb';
import { ProductionManager } from './production_manager';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { ConnectionQueue } from './connection_queue';
import { CoreFunctions } from './api_productions_core_functions';
dotenv.config();

const productionManager = new ProductionManager();
const connectionQueue = new ConnectionQueue();
const coreFunctions = new CoreFunctions(productionManager, connectionQueue);

export function checkUserStatus() {
  productionManager.checkUserStatus();
}

export interface ApiProductionsOptions {
  smbServerBaseUrl: string;
  endpointIdleTimeout: string;
}

const apiProductions: FastifyPluginCallback<ApiProductionsOptions> = (
  fastify,
  opts,
  next
) => {
  const smbServerUrl = new URL(
    '/conferences/',
    opts.smbServerBaseUrl
  ).toString();
  const smb = new SmbProtocol();

  fastify.post<{
    Body: NewProduction;
    Reply: ProductionResponse | string;
  }>(
    '/production',
    {
      schema: {
        description: 'Create a new Production.',
        body: NewProduction,
        response: {
          200: ProductionResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const production = await productionManager.createProduction(
          request.body
        );

        if (production) {
          const productionResponse: ProductionResponse = {
            name: production.name,
            productionid: production._id.toString()
          };
          reply.code(200).send(productionResponse);
        } else {
          reply.code(500).send('Failed to create production');
        }
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to create production: ' + err);
      }
    }
  );

  fastify.get<{
    Reply: ProductionResponse[] | string;
  }>(
    '/productions',
    {
      schema: {
        description: 'Retrieves all Productions.',
        response: {
          200: Type.Array(ProductionResponse)
        }
      }
    },
    async (request, reply) => {
      try {
        const productions = await productionManager.getProductions(50);
        reply.code(200).send(
          productions.map(({ _id, name }) => ({
            name,
            productionid: _id.toString()
          }))
        );
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to get productions: ' + err);
      }
    }
  );

  fastify.get<{
    Params: { productionid: string };
    Reply: DetailedProductionResponse | string;
  }>(
    '/productions/:productionid',
    {
      schema: {
        description: 'Retrieves a Production.',
        response: {
          200: DetailedProductionResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const production = await productionManager.requireProduction(
          parseInt(request.params.productionid, 10)
        );
        const allLinesResponse: LineResponse[] =
          coreFunctions.getAllLinesResponse(production);
        const productionResponse: DetailedProductionResponse = {
          name: production.name,
          productionid: production._id.toString(),
          lines: allLinesResponse
        };
        reply.code(200).send(productionResponse);
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to get productions: ' + err);
      }
    }
  );

  fastify.get<{
    Params: { productionid: string };
    Reply: LineResponse[] | string;
  }>(
    '/productions/:productionid/lines',
    {
      schema: {
        description: 'Retrieves all lines for a Production.',
        response: {
          200: Type.Array(LineResponse)
        }
      }
    },
    async (request, reply) => {
      try {
        const production = await productionManager.requireProduction(
          parseInt(request.params.productionid, 10)
        );
        const allLinesResponse: LineResponse[] =
          coreFunctions.getAllLinesResponse(production);
        reply.code(200).send(allLinesResponse);
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to get line: ' + err);
      }
    }
  );

  fastify.get<{
    Params: { productionid: string; lineid: string };
    Reply: LineResponse | string;
  }>(
    '/productions/:productionid/lines/:lineid',
    {
      schema: {
        description: 'Retrieves an active Production line.',
        response: {
          200: LineResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionid, lineid } = request.params;
        const production = await productionManager.requireProduction(
          parseInt(productionid, 10)
        );
        const line = productionManager.requireLine(production.lines, lineid);

        const participantlist: User[] = productionManager.getUsersForLine(
          productionid,
          line.id
        );
        const lineResponse: LineResponse = {
          name: line.name,
          id: line.id,
          smbconferenceid: line.smbconferenceid,
          participants: participantlist
        };
        reply.code(200).send(lineResponse);
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to get line: ' + err);
      }
    }
  );

  fastify.post<{
    Params: { productionid: string; lineid: string; username: string };
    Reply: { [key: string]: string | string[] } | string;
  }>(
    '/productions/:productionid/lines/:lineid/users/:username',
    {
      schema: {
        description:
          'Initiate connection protocol. Generates sdp offer describing remote SMB instance.',
        response: {
          200: Type.Object({
            sdp: Type.String(),
            sessionid: Type.String()
          })
        }
      }
    },
    async (request, reply) => {
      try {
        const { lineid, productionid, username } = request.params;
        const sessionId: string = uuidv4();
        const production = await productionManager.requireProduction(
          parseInt(productionid, 10)
        );

        await coreFunctions.createConferenceForLine(
          smb,
          smbServerUrl,
          production,
          lineid
        );

        const line = productionManager.requireLine(production.lines, lineid);

        const endpointId: string = uuidv4();
        const endpoint = await coreFunctions.createEndpoint(
          smb,
          smbServerUrl,
          line.smbconferenceid,
          endpointId,
          true,
          false,
          parseInt(opts.endpointIdleTimeout, 10)
        );
        if (!endpoint.audio) {
          throw new Error('Missing audio when creating sdp offer for endpoint');
        }
        if (!endpoint.audio.ssrcs) {
          throw new Error('Missing ssrcs when creating sdp offer for endpoint');
        }

        const sdpOffer = await coreFunctions.createConnection(
          productionid,
          lineid,
          endpoint,
          username,
          endpointId,
          sessionId
        );

        if (sdpOffer) {
          reply.code(200).send({ sdp: sdpOffer, sessionid: sessionId });
        } else {
          reply.code(500).send('Failed to generate sdp offer for endpoint');
        }
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to create endpoint: ' + err);
      }
    }
  );

  fastify.patch<{
    Params: { productionid: string; lineid: string; sessionid: string };
    Body: string;
  }>(
    '/productions/:productionid/lines/:lineid/session/:sessionid',
    {
      schema: {
        description:
          'Provide client local SDP description as request body to finalize connection protocol.',
        response: {
          200: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionid, lineid, sessionid } = request.params;
        const production = await productionManager.requireProduction(
          parseInt(productionid, 10)
        );
        const line = productionManager.requireLine(production.lines, lineid);

        const userSession: UserSession | undefined =
          productionManager.getUser(sessionid);
        if (!userSession) {
          throw new Error(
            'Could not get user session or session does not exist'
          );
        }
        const connectionEndpointDescription:
          | SmbEndpointDescription
          | undefined = userSession.sessionDescription;
        if (!connectionEndpointDescription) {
          throw new Error('Could not get connection endpoint description');
        }
        const endpointId: string | undefined = userSession.endpointId;
        if (!endpointId) {
          throw new Error('Could not get connection endpoint id');
        }

        await coreFunctions.handleAnswerRequest(
          smb,
          smbServerUrl,
          line.smbconferenceid,
          endpointId,
          connectionEndpointDescription,
          request.body
        );
        reply.code(200);
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to configure endpoint: ' + err);
      }
    }
  );

  fastify.delete<{
    Params: { productionid: string };
    Reply: string;
  }>(
    '/productions/:productionid',
    {
      schema: {
        description: 'Deletes a Production.',
        response: {
          204: Type.String()
        }
      }
    },
    async (request, reply) => {
      const { productionid } = request.params;
      try {
        if (!(await productionManager.deleteProduction(productionid))) {
          throw new Error('Could not delete production');
        }
        reply.code(204).send(`Deleted production ${productionid}`);
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to delete production: ' + err);
      }
    }
  );

  fastify.delete<{
    Params: { productionid: string; lineid: string; sessionid: string };
    Reply: string;
  }>(
    '/productions/:productionid/lines/:lineid/session/:sessionid',
    {
      schema: {
        description: 'Deletes a Connection from ProductionManager.',
        response: {
          204: Type.String()
        }
      }
    },
    async (request, reply) => {
      const sessionId = request.params.sessionid;
      try {
        const deletedSessionId = productionManager.removeUserSession(sessionId);
        if (!deletedSessionId) {
          throw new Error(`Could not delete connection ${sessionId}`);
        }
        reply.code(204).send(`Deleted connection ${sessionId}`);
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to delete connection: ' + err);
      }
    }
  );

  //Long poll endpoint
  fastify.post<{
    Params: { productionid: string; lineid: string; sessionid: string };
    Reply: User[] | string;
  }>(
    '/productions/:productionid/lines/:lineid/participants',
    {
      schema: {
        description: 'Long Poll Endpoint to get participant list.',
        response: {
          200: Type.Array(User)
        }
      }
    },
    async (request, reply) => {
      try {
        const participants = productionManager.getUsersForLine(
          request.params.productionid,
          request.params.lineid
        );

        const waitForChange = new Promise<void>((resolve) => {
          productionManager.once('users:change', () => {
            resolve();
          });
        });
        await waitForChange;
        reply.code(200).send(participants);
      } catch (err) {
        reply
          .code(500)
          .send(
            'Exception thrown when trying to set connection status for session: ' +
              err
          );
      }
    }
  );

  fastify.get<{
    Params: { sessionid: string };
  }>(
    '/heartbeat/:sessionid',
    {
      schema: {
        description: 'Update user session lastSeen',
        response: {
          200: Type.String(),
          410: Type.String()
        }
      }
    },
    async (request, reply) => {
      const { sessionid } = request.params;
      const status = productionManager.updateUserLastSeen(sessionid);
      if (status) {
        reply.code(200).send('ok');
      } else {
        reply.code(410).send(`User session id "${sessionid}" not found.`);
      }
    }
  );

  next();
};

export async function getApiProductions() {
  await productionManager.load();
  return apiProductions;
}
