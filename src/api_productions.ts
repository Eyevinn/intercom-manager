import { Static, Type } from '@sinclair/typebox';
import dotenv from 'dotenv';
import { FastifyPluginCallback } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { DbManagerCouchDb } from './db/couchdb';
import { DbManagerMongoDb } from './db/mongodb';
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
  UserSession,
  WhipRequest,
  WhipResponse
} from './models';
import { ProductionManager } from './production_manager';
import { SmbProtocol } from './smb';
import { parse } from 'sdp-transform';
dotenv.config();

const DB_CONNECTION_STRING: string =
  process.env.DB_CONNECTION_STRING ??
  process.env.MONGODB_CONNECTION_STRING ??
  'mongodb://localhost:27017/intercom-manager';
let dbManager;
const dbUrl = new URL(DB_CONNECTION_STRING);
if (dbUrl.protocol === 'mongodb:') {
  dbManager = new DbManagerMongoDb(dbUrl);
} else if (dbUrl.protocol === 'http:' || dbUrl.protocol === 'https:') {
  dbManager = new DbManagerCouchDb(dbUrl);
} else {
  throw new Error('Unsupported database protocol');
}

const productionManager = new ProductionManager(dbManager);
const connectionQueue = new ConnectionQueue();
const coreFunctions = new CoreFunctions(productionManager, connectionQueue);

export function checkUserStatus() {
  productionManager.checkUserStatus();
}

export interface ApiProductionsOptions {
  smbServerBaseUrl: string;
  endpointIdleTimeout: string;
  smbServerApiKey?: string;
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
  const whipHeartbeatIntervals: Record<string, NodeJS.Timeout> = {};

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

  // WHIP endpoint for ingesting WebRTC streams
  fastify.post<{
    Params: { productionId: string; lineId: string };
    Body: Static<typeof WhipRequest>;
    // Reply: Static<typeof WhipResponse>;
    Reply: any;
  }>(
    '/whip/:productionId/:lineId',
    {
      schema: {
        description: 'WHIP endpoint for ingesting WebRTC streams',
        body: WhipRequest,
        response: {
          201: WhipResponse,
          400: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionId, lineId } = request.params;
        const sdpOffer = request.body;

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

        // Handle the SDP answer
        const sdpAnswer = await coreFunctions.createAnswer(
          smb,
          smbServerUrl,
          smbServerApiKey,
          smbConferenceId,
          endpointId,
          endpoint,
          sdpOffer
        );

        // Create user session in production manager
        productionManager.createUserSession(
          productionId,
          lineId,
          sessionId,
          'WHIPing tears off my face'
        );

        // Update user endpoint information
        productionManager.updateUserEndpoint(sessionId, endpointId, endpoint);

        // Start heartbeat for this WHIP session
        const interval = setInterval(() => {
          const success = productionManager.updateUserLastSeen(sessionId);
          if (!success) {
            clearInterval(interval);
            delete whipHeartbeatIntervals[sessionId];
          }
        }, 10_000);

        whipHeartbeatIntervals[sessionId] = interval;

        // Create the Location URL for the WHIP resource
        const baseUrl =
          request.protocol + '://' + request.hostname + ':' + request.port;
        const locationUrl = `${baseUrl}/api/v1/whip/${productionId}/${lineId}/${sessionId}`;

        // Set response headers according to WHIP specification
        reply.header('Content-Type', 'application/sdp');
        reply.header('Location', locationUrl);
        reply.header('ETag', sessionId);

        // Add CORS headers for browser compatibility
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
        reply.header(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization'
        );
        reply.header('Access-Control-Expose-Headers', 'Location, ETag');

        // Return 201 Created with the SDP answer
        await reply.code(201).send(sdpAnswer);

        console.log('SLUT PÅ ALLT: ', sessionId);
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send({ error: `Failed to process WHIP request: ${err}` });
      }
    }
  );

  // DELETE endpoint to terminate WHIP connection
  fastify.delete<{
    Params: { productionId: string; lineId: string; sessionId: string };
  }>(
    '/whip/:productionId/:lineId/:sessionId',
    {
      schema: {
        description: 'Terminate a WHIP connection',
        response: {
          204: Type.Null(),
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const { sessionId } = request.params;

        // Clear heartbeat interval if it exists
        if (whipHeartbeatIntervals[sessionId]) {
          console.log(`Clearing heartbeat for WHIP session ${sessionId}`);
          clearInterval(whipHeartbeatIntervals[sessionId]);
          delete whipHeartbeatIntervals[sessionId];
        }

        // Remove the user session
        const deletedSessionId = productionManager.removeUserSession(sessionId);
        if (!deletedSessionId) {
          reply.code(404).send({ error: 'WHIP session not found' });
          return;
        }

        // Add CORS headers for browser compatibility
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
        reply.header(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization'
        );

        reply.code(204).send();
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send({ error: `Failed to terminate WHIP connection: ${err}` });
      }
    }
  );

  // PATCH endpoint for Trickle ICE support
  fastify.patch<{
    Params: { productionId: string; lineId: string; sessionId: string };
    Body: string;
  }>(
    '/whip/:productionId/:lineId/:sessionId',
    {
      schema: {
        description: 'Trickle ICE endpoint for sending ICE candidates',
        body: Type.String({
          description: 'ICE candidate SDP fragment'
        }),
        response: {
          200: Type.Null(),
          204: Type.Null(),
          400: Type.Object({ error: Type.String() }),
          404: Type.Object({ error: Type.String() }),
          409: Type.Object({ error: Type.String() }),
          412: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        console.log('PATCH ENDPOINT CALLED');

        const { sessionId } = request.params;
        const iceCandidateSdp = request.body;
        const etag = request.headers.etag;

        // Check if session exists
        const session = productionManager.getUser(sessionId);
        if (!session) {
          reply.code(404).send({ error: 'WHIP session not found' });
          return;
        }

        // Validate ETag if provided
        if (etag && etag !== sessionId) {
          reply.code(412).send({ error: 'ETag mismatch' });
          return;
        }

        // Parse the ICE candidate SDP fragment
        if (!iceCandidateSdp || iceCandidateSdp.trim() === '') {
          reply.code(400).send({ error: 'Empty ICE candidate SDP fragment' });
          return;
        }

        // Extract ICE candidate from SDP fragment
        const candidateMatch = iceCandidateSdp.match(/a=candidate.*\r?\n?/);
        if (!candidateMatch || candidateMatch.length === 0) {
          reply.code(400).send({ error: 'Invalid ICE candidate format' });
          return;
        }

        const candidateString = candidateMatch[0].trim();
        Log().info(
          `Received ICE candidate for session ${sessionId}: ${candidateString}`
        );

        // TODO: Implement ICE candidate handling with SMB
        // This would typically involve:
        // 1. Storing the ICE candidate for the session
        // 2. Adding it to the SMB endpoint configuration
        // 3. Reconfiguring the SMB endpoint with the new ICE candidate

        // For now, we'll store the ICE candidate in the session
        // This is a placeholder implementation - you'll need to integrate with SMB
        if (!session.iceCandidates) {
          session.iceCandidates = [];
        }
        session.iceCandidates.push({
          candidate: candidateString,
          timestamp: Date.now()
        });

        // Update the session in the production manager
        productionManager.updateUserLastSeen(sessionId);

        // Add CORS headers
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header(
          'Access-Control-Allow-Methods',
          'POST, DELETE, OPTIONS, PATCH'
        );
        reply.header(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, ETag'
        );
        reply.header('Access-Control-Expose-Headers', 'Location, ETag, Link');

        // Return 204 No Content for successful ICE candidate processing
        reply.code(204).send();
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send({ error: `Failed to process ICE candidate: ${err}` });
      }
    }
  );

  // OPTIONS endpoint for CORS preflight requests and WHIP discovery
  fastify.options<{
    Params: { productionId: string; lineId: string };
  }>(
    '/whip/:productionId/:lineId',
    {
      schema: {
        description: 'CORS preflight and WHIP discovery endpoint',
        response: {
          200: Type.Null()
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionId, lineId } = request.params;

        console.log('OPTIONS ENDPOINT CALLED');

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

        const line = production.lines.find((l: any) => l.id === lineId);
        if (!line) {
          reply.code(404).send({ error: 'Line not found' });
          return;
        }

        // Add CORS headers for preflight requests
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header(
          'Access-Control-Allow-Methods',
          'POST, DELETE, OPTIONS, PATCH'
        );
        reply.header(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, ETag'
        );
        reply.header('Access-Control-Expose-Headers', 'Location, ETag, Link');
        reply.header('Access-Control-Max-Age', '86400'); // 24 hours

        // WHIP-specific headers
        reply.header('Accept-Post', 'application/sdp');

        reply.code(200).send();
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

export async function getApiProductions() {
  await productionManager.load();
  return apiProductions;
}
