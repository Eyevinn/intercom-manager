import { Type } from '@sinclair/typebox';
import dotenv from 'dotenv';
import { FastifyPluginCallback } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { CoreFunctions } from './api_productions_core_functions';
import { DbManager } from './db/interface';
import { Log } from './log';
import {
  DetailedProductionResponse,
  ErrorResponse,
  LineResponse,
  NewProduction,
  NewProductionLine,
  NewSession,
  PatchLine,
  PatchLineResponse,
  PatchProduction,
  PatchProductionResponse,
  ProductionListResponse,
  ProductionResponse,
  SdpAnswer,
  SessionResponse,
  SmbEndpointDescription,
  UserResponse,
  UserSession
} from './models';
import { ProductionManager } from './production_manager';
import { SmbProtocol } from './smb';
dotenv.config();

export interface ApiProductionsOptions {
  smbServerBaseUrl: string;
  endpointIdleTimeout: string;
  smbServerApiKey?: string;
  dbManager: DbManager;
  productionManager: ProductionManager;
  coreFunctions: CoreFunctions;
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
  const smbServerApiKey = opts.smbServerApiKey || '';

  const productionManager = opts.productionManager;
  const coreFunctions = opts.coreFunctions;

  fastify.post<{
    Body: NewProduction;
    Reply: ProductionResponse | ErrorResponse | string;
  }>(
    '/production',
    {
      schema: {
        description: 'Create a new Production.',
        body: NewProduction,
        response: {
          200: ProductionResponse,
          400: ErrorResponse
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
            productionId: production._id.toString()
          };
          reply.code(200).send(productionResponse);
        } else {
          reply.code(400).send({ message: 'Failed to create production' });
        }
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to create production: ' + err);
      }
    }
  );

  fastify.get<{
    Reply: ProductionListResponse | string;
    Querystring: {
      limit?: number;
      offset?: number;
      extended?: boolean;
    };
  }>(
    '/productionlist',
    {
      schema: {
        description: 'Paginated list of all productions.',
        querystring: Type.Object({
          limit: Type.Optional(Type.Number()),
          offset: Type.Optional(Type.Number()),
          extended: Type.Optional(Type.Boolean())
        }),
        response: {
          200: ProductionListResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const limit = request.query.limit || 50;
        const offset = request.query.offset || 0;
        const extended = request.query.extended || false;
        const productions = await productionManager.getProductions(
          limit,
          offset
        );
        const totalItems = await productionManager.getNumberOfProductions();
        let responseProductions: ProductionResponse[];
        if (!extended) {
          responseProductions = productions.map(({ _id, name }) => ({
            name,
            productionId: _id.toString()
          }));
        } else {
          const extendedProductions = await Promise.all(
            productions.map(async (production) => {
              const extendedProduction =
                await productionManager.requireProduction(
                  parseInt(production._id.toString(), 10)
                );
              const allLinesResponse: LineResponse[] =
                coreFunctions.getAllLinesResponse(extendedProduction);
              return {
                ...production,
                lines: allLinesResponse
              };
            })
          );
          responseProductions = extendedProductions.map(
            ({ _id, name, lines }) => ({
              name,
              productionId: _id.toString(),
              lines
            })
          );
        }
        reply.code(200).send({
          productions: responseProductions,
          offset,
          limit,
          totalItems
        });
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send(
            'Exception thrown when trying to get paginated productions: ' + err
          );
      }
    }
  );

  fastify.get<{
    Reply: ProductionResponse[] | string;
  }>(
    '/production',
    {
      schema: {
        description:
          'Retrieves 50 most recently created productions. Deprecated. Use /productionlist instead.',
        deprecated: true,
        response: {
          200: Type.Array(ProductionResponse),
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const productions = await productionManager.getProductions(50, 0);
        reply.code(200).send(
          productions.map(({ _id, name }) => ({
            name,
            productionId: _id.toString()
          }))
        );
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to get productions: ' + err);
      }
    }
  );

  fastify.get<{
    Params: { productionId: string };
    Reply: DetailedProductionResponse | string;
  }>(
    '/production/:productionId',
    {
      schema: {
        description: 'Retrieves a Production.',
        response: {
          200: DetailedProductionResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const production = await productionManager.requireProduction(
          parseInt(request.params.productionId, 10)
        );
        const allLinesResponse: LineResponse[] =
          coreFunctions.getAllLinesResponse(production);
        const productionResponse: DetailedProductionResponse = {
          name: production.name,
          productionId: production._id.toString(),
          lines: allLinesResponse
        };
        reply.code(200).send(productionResponse);
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to get productions: ' + err);
      }
    }
  );

  fastify.patch<{
    Params: { productionId: string };
    Body: PatchProduction;
    Reply: PatchProductionResponse | ErrorResponse | string;
  }>(
    '/production/:productionId',
    {
      schema: {
        description: 'Modify an existing Production line.',
        body: PatchProduction,
        response: {
          200: PatchProductionResponse,
          400: ErrorResponse,
          404: ErrorResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionId } = request.params;
        let production;
        try {
          production = await productionManager.requireProduction(
            parseInt(productionId, 10)
          );
        } catch (err) {
          console.warn(
            'Trying to patch a production line in a production that does not exist'
          );
        }
        if (!production) {
          reply.code(404).send({
            message: `Production with id ${productionId} not found`
          });
        } else {
          const updatedProduction = await productionManager.updateProduction(
            production,
            request.body.name
          );
          if (!updatedProduction) {
            reply.code(400).send({
              message: `Failed to update production with id ${productionId}`
            });
          } else {
            reply.code(200).send({
              name: request.body.name,
              _id: updatedProduction._id
            });
          }
        }
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to get production: ' + err);
      }
    }
  );

  fastify.get<{
    Params: { productionId: string };
    Reply: LineResponse[] | string;
  }>(
    '/production/:productionId/line',
    {
      schema: {
        description: 'Retrieves all lines for a Production.',
        response: {
          200: Type.Array(LineResponse),
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const production = await productionManager.requireProduction(
          parseInt(request.params.productionId, 10)
        );
        const allLinesResponse: LineResponse[] =
          coreFunctions.getAllLinesResponse(production);
        reply.code(200).send(allLinesResponse);
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to get lines: ' + err);
      }
    }
  );

  fastify.post<{
    Params: { productionId: string };
    Body: NewProductionLine;
    Reply: LineResponse[] | ErrorResponse | string;
  }>(
    '/production/:productionId/line',
    {
      schema: {
        description: 'Add a new Line to a Production.',
        body: NewProductionLine,
        response: {
          200: Type.Array(LineResponse),
          400: ErrorResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const production = await productionManager.requireProduction(
          parseInt(request.params.productionId, 10)
        );
        if (production.lines.find((line) => line.name === request.body.name)) {
          reply.code(400).send({
            message: `Line with name ${request.body.name} already exists`
          });
        } else {
          await productionManager.addProductionLine(
            production,
            request.body.name,
            request.body.programOutputLine || false
          );
          const allLinesResponse: LineResponse[] =
            coreFunctions.getAllLinesResponse(production);
          reply.code(200).send(allLinesResponse);
        }
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Unhandled exception thrown when trying to add line: ' + err);
      }
    }
  );

  fastify.get<{
    Params: { productionId: string; lineId: string };
    Reply: LineResponse | ErrorResponse | string;
  }>(
    '/production/:productionId/line/:lineId',
    {
      schema: {
        description: 'Retrieves an active Production line.',
        response: {
          200: LineResponse,
          404: ErrorResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionId, lineId } = request.params;
        const production = await productionManager.requireProduction(
          parseInt(productionId, 10)
        );
        const line = productionManager.getLine(production.lines, lineId);
        if (!line) {
          reply.code(404).send({ message: `Line with id ${lineId} not found` });
        } else {
          const participantlist = productionManager.getUsersForLine(
            productionId,
            line.id
          );
          const lineResponse: LineResponse = {
            name: line.name,
            id: line.id,
            smbConferenceId: line.smbConferenceId,
            participants: participantlist,
            programOutputLine: line.programOutputLine || false
          };
          reply.code(200).send(lineResponse);
        }
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to get line: ' + err);
      }
    }
  );

  fastify.patch<{
    Params: { productionId: string; lineId: string };
    Body: PatchLine;
    Reply: PatchLineResponse | ErrorResponse | string;
  }>(
    '/production/:productionId/line/:lineId',
    {
      schema: {
        description: 'Modify an existing Production line.',
        body: PatchLine,
        response: {
          200: PatchLineResponse,
          400: ErrorResponse,
          404: ErrorResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionId, lineId } = request.params;
        let production;
        try {
          production = await productionManager.requireProduction(
            parseInt(productionId, 10)
          );
        } catch (err) {
          console.warn(
            'Trying to patch a production line in a production that does not exist'
          );
        }
        if (!production) {
          reply
            .code(404)
            .send({ message: `Production with id ${productionId} not found` });
        } else {
          const line = productionManager.getLine(production.lines, lineId);
          if (!line) {
            reply
              .code(404)
              .send({ message: `Line with id ${lineId} not found` });
          } else {
            const updatedProduction =
              await productionManager.updateProductionLine(
                production,
                lineId,
                request.body.name
              );
            if (!updatedProduction) {
              reply.code(400).send({
                message: `Failed to update line with id ${lineId} in production ${productionId}`
              });
            } else {
              reply.code(200).send({
                name: request.body.name,
                id: lineId,
                programOutputLine: line.programOutputLine || false
              });
            }
          }
        }
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to get line: ' + err);
      }
    }
  );

  fastify.delete<{
    Params: { productionId: string; lineId: string };
    Reply: string | ErrorResponse;
  }>(
    '/production/:productionId/line/:lineId',
    {
      schema: {
        description: 'Removes a line from a production.',
        response: {
          200: Type.String(),
          400: ErrorResponse,
          404: ErrorResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionId, lineId } = request.params;
        const production = await productionManager.requireProduction(
          parseInt(productionId, 10)
        );

        const line = productionManager.getLine(production.lines, lineId);
        if (!line) {
          reply.code(404).send({ message: `Line with id ${lineId} not found` });
        } else {
          const participantlist = productionManager.getUsersForLine(
            productionId,
            line.id
          );
          if (participantlist.filter((p) => p.isActive).length > 0) {
            reply.code(400).send({
              message: 'Cannot remove a line with active participants'
            });
          } else {
            await productionManager.deleteProductionLine(production, lineId);
            reply.code(200).send('deleted');
          }
        }
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to get line: ' + err);
      }
    }
  );

  fastify.post<{
    Body: NewSession;
    Reply: SessionResponse | ErrorResponse | string;
  }>(
    '/session',
    {
      schema: {
        description:
          'Initiate connection protocol. Generates sdp offer describing remote SMB instance.',
        body: NewSession,
        response: {
          201: SessionResponse,
          400: ErrorResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const { lineId, productionId, username } = request.body;
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
          true, // audio
          true, // data
          true, // iceControlling
          'ssrc-rewrite', // relayType
          parseInt(opts.endpointIdleTimeout, 10)
        );
        if (!endpoint.audio) {
          throw new Error('Missing audio when creating sdp offer for endpoint');
        }
        if (!endpoint.audio.ssrcs) {
          throw new Error('Missing ssrcs when creating sdp offer for endpoint');
        }

        const sdpOffer = await coreFunctions.createConnection(
          productionId,
          lineId,
          endpoint,
          username,
          endpointId,
          sessionId
        );

        if (sdpOffer) {
          reply
            .code(201)
            .type('application/json')
            .send({ sessionId: sessionId, sdp: sdpOffer });
        } else {
          reply.code(400).send({
            message: 'Could not establish a media connection',
            stackTrace: 'Failed to generate sdp offer for endpoint'
          });
        }
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to create endpoint: ' + err);
      }
    }
  );

  fastify.patch<{
    Params: { sessionId: string };
    Body: SdpAnswer;
  }>(
    '/session/:sessionId',
    {
      schema: {
        description:
          'Provide client local SDP description as request body to finalize connection protocol.',
        response: {
          200: Type.String(),
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const { sessionId } = request.params;

        const userSession: UserSession | undefined =
          productionManager.getUser(sessionId);
        if (!userSession) {
          throw new Error(
            'Could not get user session or session does not exist'
          );
        }

        const production = await productionManager.requireProduction(
          parseInt(userSession.productionId, 10)
        );
        const line = productionManager.requireLine(
          production.lines,
          userSession.lineId
        );

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
          smbServerApiKey,
          line.smbConferenceId,
          endpointId,
          connectionEndpointDescription,
          request.body.sdpAnswer
        );
        reply.code(204);
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to configure endpoint: ' + err);
      }
    }
  );

  fastify.delete<{
    Params: { productionId: string };
    Reply: string;
  }>(
    '/production/:productionId',
    {
      schema: {
        description: 'Deletes a Production.',
        response: {
          200: Type.String(),
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      const { productionId } = request.params;
      try {
        if (
          !(await productionManager.deleteProduction(
            parseInt(productionId, 10)
          ))
        ) {
          throw new Error('Could not delete production');
        }
        reply.code(200).send(`Deleted production ${productionId}`);
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to delete production: ' + err);
      }
    }
  );

  fastify.delete<{
    Params: { sessionId: string };
    Reply: string;
  }>(
    '/session/:sessionId',
    {
      schema: {
        description: 'Deletes a Connection from ProductionManager.',
        response: {
          200: Type.String(),
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      const sessionId = request.params.sessionId;
      try {
        const deletedSessionId = productionManager.removeUserSession(sessionId);
        if (!deletedSessionId) {
          throw new Error(`Could not delete connection ${sessionId}`);
        }
        reply.code(200).send(`Deleted connection ${sessionId}`);
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to delete connection: ' + err);
      }
    }
  );

  //Long poll endpoint
  fastify.post<{
    Params: { productionId: string; lineId: string };
    Reply: UserResponse[] | string;
  }>(
    '/production/:productionId/line/:lineId/participants',
    {
      schema: {
        description: 'Long Poll Endpoint to get participant list.',
        response: {
          200: Type.Array(UserResponse),
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const participants = productionManager.getUsersForLine(
          request.params.productionId,
          request.params.lineId
        );

        const waitForChange = new Promise<void>((resolve) => {
          productionManager.once('users:change', () => {
            resolve();
          });
        });
        await waitForChange;
        reply.code(200).send(participants);
      } catch (err) {
        Log().error(err);
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
    Params: { sessionId: string };
  }>(
    '/heartbeat/:sessionId',
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
      const { sessionId } = request.params;
      const status = productionManager.updateUserLastSeen(sessionId);
      if (status) {
        reply.code(200).send('ok');
      } else {
        reply.code(410).send(`User session id "${sessionId}" not found.`);
      }
    }
  );

  next();
};

export function getApiProductions() {
  return apiProductions;
}
