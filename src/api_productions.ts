import { Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import {
  NewProduction,
  Production,
  Line,
  LineResponse,
  SmbEndpointDescription,
  ProductionResponse,
  User,
  SdpOfferResponse
} from './models';
import { SmbProtocol } from './smb';
import { ProductionManager } from './production_manager';
import { Connection } from './connection';
import { write, SessionDescription } from 'sdp-transform';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { UserManager } from './user_manager';
import { ConnectionQueue } from './connection_queue';
import { CoreFunctions } from './api_productions_core_functions';
import { ResponseFunctions } from './api_productions_response_functions';
dotenv.config();

const productionManager = new ProductionManager();
const connectionQueue = new ConnectionQueue();
const coreFunctions = new CoreFunctions(productionManager, connectionQueue);
const responseFunctions = new ResponseFunctions(
  productionManager,
  coreFunctions
);

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
        const productionResponse: ProductionResponse | undefined =
          responseFunctions.makeCreateProductionResponse(request.body);
        if (productionResponse) {
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
        const productionsResponse: ProductionResponse[] =
          responseFunctions.makeGetAllProductionsResponse();
        reply.code(200).send(productionsResponse);
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to get productions: ' + err);
      }
    }
  );

  fastify.get<{
    Params: { productionid: string };
    Reply: ProductionResponse | string;
  }>(
    '/productions/:productionid',
    {
      schema: {
        description: 'Retrieves a Production.',
        response: {
          200: ProductionResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const production: ProductionResponse =
          responseFunctions.makeGetProductionResponse(
            request.params.productionid
          );
        reply.code(200).send(production);
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
        const productionLines: LineResponse[] =
          responseFunctions.makeGetAllLinesInProductionResponse(
            request.params.productionid
          );
        reply.code(200).send(productionLines);
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
        description: 'Retrieves a Production line.',
        response: {
          200: LineResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const lineResponse: LineResponse =
          responseFunctions.makeGetLineInProductionResponse(
            request.params.productionid,
            request.params.lineid
          );
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
    Reply: SdpOfferResponse | string;
  }>(
    '/productions/:productionid/lines/:lineid/users/:username',
    {
      schema: {
        description:
          'Initiate connection protocol. Generates sdp offer describing remote SMB instance.',
        response: {
          200: SdpOfferResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const sessionId: string = uuidv4();
        const production: Production = coreFunctions.getProduction(
          request.params.productionid
        );

        await coreFunctions.createConferenceForLine(
          smb,
          smbServerUrl,
          production,
          request.params.lineid
        );

        const line: Line = coreFunctions.getLine(
          production.lines,
          request.params.lineid
        );

        const endpointId: string = uuidv4();
        const endpoint = await coreFunctions.createEndpoint(
          smb,
          smbServerUrl,
          line.smbid,
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

        const connection: Connection = coreFunctions.createConnection(
          endpoint,
          production.productionid,
          line.id,
          request.params.username,
          endpointId,
          sessionId
        );

        const offer: SessionDescription = connection.createOffer();
        const sdpOffer: string = write(offer);

        if (sdpOffer) {
          const lineUserManager: UserManager = line.users;
          lineUserManager.addUser({
            name: request.params.username,
            isActive: true,
            sessionid: sessionId
          });
          const sdpResponse: SdpOfferResponse = {
            sdp: sdpOffer,
            sessionid: sessionId
          };
          reply.code(200).send(sdpResponse);
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
    Reply: LineResponse | string;
    Body: string;
  }>(
    '/productions/:productionid/lines/:lineid/session/:sessionid',
    {
      schema: {
        description:
          'Provide client local SDP description as request body to finalize connection protocol.',
        response: {
          200: LineResponse
        }
      }
    },
    async (request, reply) => {
      try {
        const line: Line = coreFunctions.retrieveLineFromProduction(
          request.params.productionid,
          request.params.lineid
        );

        const connectionEndpointDescription: SmbEndpointDescription =
          line.connections[request.params.sessionid].sessionDescription;
        const endpointId: string =
          line.connections[request.params.sessionid].endpointId;

        if (!connectionEndpointDescription) {
          throw new Error('Could not get connection endpoint description');
        }
        if (!endpointId) {
          throw new Error('Could not get connection endpoint id');
        }

        await coreFunctions.handleAnswerRequest(
          smb,
          smbServerUrl,
          line.smbid,
          endpointId,
          connectionEndpointDescription,
          request.body
        );
        const lineResponse: LineResponse = {
          name: line.name,
          id: line.id,
          smbconferenceid: line.smbid,
          participants: line.users.users
        };
        reply.code(200).send(lineResponse);
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
      try {
        if (!productionManager.deleteProduction(request.params.productionid)) {
          throw new Error('Could not delete production');
        }
        reply
          .code(204)
          .send(`Deleted production ${request.params.productionid}`);
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
      try {
        if (
          !productionManager.removeConnectionFromLine(
            request.params.productionid,
            request.params.lineid,
            request.params.sessionid
          )
        ) {
          throw new Error(
            `Could not delete connection ${request.params.sessionid}`
          );
        }
        reply.code(204).send(`Deleted connection ${request.params.sessionid}`);
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
        description:
          'Long Poll Endpoint to confirm client connection is active and receive participant list.',
        response: {
          200: Type.Array(User)
        }
      }
    },
    async (request, reply) => {
      try {
        const line: Line = coreFunctions.retrieveLineFromProduction(
          request.params.productionid,
          request.params.lineid
        );
        const lineUserManager: UserManager = line.users;
        const participants: User[] = lineUserManager.getUsers();

        const waitForChange = new Promise<void>((resolve) => {
          lineUserManager.once('change', () => {
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

  next();
};

export default apiProductions;
