import { Static, Type } from '@sinclair/typebox';
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
  SetLineWhepSourceRequest,
  SetLineWhepSourceResponse,
  SetSessionVideoSourceRequest,
  SetSessionVideoSourceResponse,
  SmbEndpointDescription,
  UserResponse,
  UserSession
} from './models';
import { ProductionManager } from './production_manager';
import { ISmbProtocol, SmbEndpointActionError, SmbProtocol } from './smb';

export interface ApiProductionsOptions {
  smbServerBaseUrl: string;
  endpointIdleTimeout: string;
  smbServerApiKey?: string;
  dbManager: DbManager;
  productionManager: ProductionManager;
  coreFunctions: CoreFunctions;
  smb?: ISmbProtocol;
}

function toUserResponse(doc: any) {
  const out: any = {
    sessionId: String(doc?._id ?? ''),
    name: String(doc?.name ?? ''),
    isActive: Boolean(doc?.isActive),
    isWhip: Boolean(doc?.isWhip),
    isWhepReceiver: Boolean(doc?.isWhepReceiver),
    hasVideo: Boolean(doc?.hasVideo)
  };
  if (typeof doc?.endpointId === 'string' && doc.endpointId.length > 0) {
    out.endpointId = doc.endpointId;
  }
  return out;
}

// To keep participant list order from changing on each fetch of participants
function sortParticipants(participants: UserResponse[]): UserResponse[] {
  return [...participants].sort((a, b) => {
    const nameA = a.name?.toLocaleLowerCase?.() ?? '';
    const nameB = b.name?.toLocaleLowerCase?.() ?? '';
    if (nameA || nameB) {
      const cmp =
        nameA.localeCompare(nameB, undefined, { sensitivity: 'base' }) || 0;
      if (cmp !== 0) return cmp;
    }
    return (a.sessionId ?? '').localeCompare(b.sessionId ?? '');
  });
}

// ── Param schemas for route validation ──────────────────────────────────

const ProductionIdParams = Type.Object({
  productionId: Type.String({ minLength: 1, pattern: '^[0-9]+$' })
});

const ProductionLineParams = Type.Object({
  productionId: Type.String({ minLength: 1, pattern: '^[0-9]+$' }),
  lineId: Type.String({ minLength: 1, maxLength: 200 })
});

const SessionIdParams = Type.Object({
  sessionId: Type.String({ minLength: 1, maxLength: 200 })
});

const apiProductions: FastifyPluginCallback<ApiProductionsOptions> = (
  fastify,
  opts,
  next
) => {
  const smbServerUrl = new URL(
    '/conferences/',
    opts.smbServerBaseUrl
  ).toString();
  const smb = opts.smb || new SmbProtocol();
  const smbServerApiKey = opts.smbServerApiKey || '';

  const productionManager = opts.productionManager;
  const coreFunctions = opts.coreFunctions;
  const dbManager = opts.dbManager;

  setInterval(async () => {
    try {
      await productionManager.checkUserStatus(
        smb,
        smbServerUrl,
        smbServerApiKey
      );
    } catch (err) {
      Log().error('checkUserStatus failed:', err);
    }
  }, 2_000);

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
        reply.code(500).send('Failed to create production');
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
          const productionIds = productions.map((production) =>
            production._id.toString()
          );
          // fetching all sessions by querying with array of prod ids
          const sessions = await dbManager.getSessionsByQuery({
            productionId: { $in: productionIds } as any,
            isExpired: false
          });

          // re-constructing a Map containing session for each production id
          const sessionsByProductions = new Map<string, UserSession[]>();
          sessions.forEach((session) => {
            const productionId = session.productionId;
            const existingSessions =
              sessionsByProductions.get(productionId) || [];
            sessionsByProductions.set(productionId, [
              ...existingSessions,
              session
            ]);
          });

          const extendedProductions = productions
            .filter((production) => production.lines)
            .map((production) => {
              const stringifiedProdId = production._id.toString();
              const dbSessions =
                sessionsByProductions.get(stringifiedProdId) || [];

              const lines: LineResponse[] = production.lines.map((line) => {
                const participants: UserResponse[] = (dbSessions as any[])
                  .filter((s) => s.lineId === line.id)
                  .map(toUserResponse);

                return {
                  name: line.name,
                  id: line.id,
                  smbConferenceId: line.smbConferenceId,
                  participants: sortParticipants(participants),
                  programOutputLine: line.programOutputLine || false,
                  videoEnabled: line.videoEnabled || false
                };
              });
              return { _id: production._id, name: production.name, lines };
            });
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
        reply.code(500).send('Failed to get productions');
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
        reply.code(500).send('Failed to get productions');
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
        params: ProductionIdParams,
        response: {
          200: DetailedProductionResponse,
          400: Type.String(),
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
          await coreFunctions.getAllLinesResponse(production);
        const productionResponse: DetailedProductionResponse = {
          name: production.name,
          productionId: production._id.toString(),
          lines: allLinesResponse
        };
        reply.code(200).send(productionResponse);
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to get productions');
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
        params: ProductionIdParams,
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
          Log().warn(
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
        reply.code(500).send('Failed to get production');
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
        params: ProductionIdParams,
        response: {
          200: Type.Array(LineResponse),
          400: Type.String(),
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const production = await productionManager.requireProduction(
          parseInt(request.params.productionId, 10)
        );

        const stringifiedProdId = production._id.toString();

        const dbSessions = await dbManager.getSessionsByQuery({
          productionId: stringifiedProdId,
          isExpired: false
        });

        const allLinesResponse: LineResponse[] = production.lines.map(
          (line) => {
            const participants: UserResponse[] = (dbSessions as any[])
              .filter((s) => s.lineId === line.id)
              .map(toUserResponse);

            return {
              name: line.name,
              id: line.id,
              smbConferenceId: line.smbConferenceId,
              participants: sortParticipants(participants),
              programOutputLine: line.programOutputLine || false,
              videoEnabled: line.videoEnabled || false
            };
          }
        );

        reply.code(200).send(allLinesResponse);
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to get lines');
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
        params: ProductionIdParams,
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
            request.body.programOutputLine || false,
            request.body.videoEnabled || false
          );
          const allLinesResponse: LineResponse[] =
            await coreFunctions.getAllLinesResponse(production);
          reply.code(200).send(allLinesResponse);
        }
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to add line');
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
        params: ProductionLineParams,
        response: {
          200: LineResponse,
          400: Type.String(),
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
          return;
        }

        const dbSessions = await dbManager.getSessionsByQuery({
          productionId,
          lineId,
          isExpired: false
        });

        const participants: UserResponse[] = (dbSessions as any[]).map((s) => ({
          sessionId: (s._id ?? '').toString(),
          endpointId: s.endpointId,
          name: s.name,
          isActive: s.isWhip ? true : Boolean(s.isActive),
          isWhip: Boolean(s.isWhip),
          isWhepReceiver: Boolean(s.isWhepReceiver),
          hasVideo: Boolean(s.hasVideo)
        }));

        const lineResponse: LineResponse = {
          name: line.name,
          id: line.id,
          smbConferenceId: line.smbConferenceId,
          participants: sortParticipants(participants),
          programOutputLine: line.programOutputLine || false,
          videoEnabled: line.videoEnabled || false,
          whepSourceSessionId: line.whepSourceSessionId ?? null
        };
        reply.code(200).send(lineResponse);
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to get line');
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
        params: ProductionLineParams,
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
          Log().warn(
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
                programOutputLine: line.programOutputLine || false,
                videoEnabled: line.videoEnabled || false
              });
            }
          }
        }
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to get line');
      }
    }
  );

  fastify.patch<{
    Params: { productionId: string; lineId: string };
    Body: Static<typeof SetLineWhepSourceRequest>;
    Reply: Static<typeof SetLineWhepSourceResponse> | ErrorResponse | string;
  }>(
    '/production/:productionId/line/:lineId/whep-source',
    {
      schema: {
        description:
          'Pin a single participant as the WHEP egress source for this line. Pass `null` to clear and restore forward-all behaviour.',
        body: SetLineWhepSourceRequest,
        response: {
          200: SetLineWhepSourceResponse,
          404: ErrorResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionId, lineId } = request.params;
        const { pinnedSessionId: rawPinned } = request.body;
        const pinnedSessionId: string | null =
          rawPinned === '' ? null : rawPinned;

        let production;
        try {
          production = await productionManager.requireProduction(
            parseInt(productionId, 10)
          );
        } catch {
          reply
            .code(404)
            .send({ message: `Production with id ${productionId} not found` });
          return;
        }

        const line = productionManager.getLine(production.lines, lineId);
        if (!line) {
          reply.code(404).send({ message: `Line with id ${lineId} not found` });
          return;
        }

        const updated = await productionManager.setLineWhepSource(
          production,
          lineId,
          pinnedSessionId
        );
        if (!updated) {
          reply.code(500).send('Failed to update WHEP source pin');
          return;
        }

        reply.code(200).send({ lineId, pinnedSessionId });
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send('Exception thrown when trying to set WHEP source: ' + err);
      }
    }
  );

  fastify.patch<{
    Params: { sessionId: string };
    Body: Static<typeof SetSessionVideoSourceRequest>;
    Reply:
      | Static<typeof SetSessionVideoSourceResponse>
      | ErrorResponse
      | string;
  }>(
    '/session/:sessionId/video-source',
    {
      schema: {
        description:
          'Pin a single publisher as this session’s video source. SMB egress filter updates in place via the `reconfigure` action. Pass `null` to clear.',
        body: SetSessionVideoSourceRequest,
        response: {
          200: SetSessionVideoSourceResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          425: ErrorResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const { sessionId } = request.params;
        const { pinnedSessionId: rawPinned } = request.body;
        const pinnedSessionId: string | null =
          rawPinned === '' ? null : rawPinned;

        const userSession = await dbManager.getSession(sessionId);
        if (!userSession) {
          reply.code(404).send({ message: `Session ${sessionId} not found` });
          return;
        }

        const endpointId = userSession.endpointId;
        const endpointDescription = userSession.sessionDescription;
        if (!endpointId || !endpointDescription) {
          reply.code(409).send({
            message:
              'Session has no SMB endpoint yet (still negotiating). Try again after PATCH /session.'
          });
          return;
        }

        let whitelist: number[] = [];
        if (pinnedSessionId) {
          const sourceSession = await dbManager.getSession(pinnedSessionId);
          const sourceVideo: any = sourceSession?.sessionDescription?.video;
          const ssrcs: number[] = Array.isArray(sourceVideo?.ssrcs)
            ? sourceVideo.ssrcs
            : [];
          whitelist = Array.from(new Set(ssrcs))
            .filter((n) => Number.isFinite(n))
            .slice(0, 2);
          if (whitelist.length === 0) {
            reply.code(425).send({
              message:
                `Pin source ${pinnedSessionId} has no video SSRCs yet ` +
                `(still negotiating). Retry shortly.`
            });
            return;
          }
        }

        const updatedDescription: SmbEndpointDescription = JSON.parse(
          JSON.stringify(endpointDescription)
        );
        if (updatedDescription.video) {
          if (whitelist.length > 0) {
            updatedDescription.video['ssrc-whitelist'] = whitelist;
          } else {
            delete updatedDescription.video['ssrc-whitelist'];
          }
        }

        const productionIdNum = parseInt(userSession.productionId, 10);
        let production;
        try {
          production = await productionManager.requireProduction(
            productionIdNum
          );
        } catch {
          reply.code(404).send({ message: 'Production not found' });
          return;
        }
        const line = productionManager.requireLine(
          production.lines,
          userSession.lineId
        );

        try {
          await smb.reconfigureEndpoint(
            smbServerUrl,
            line.smbConferenceId,
            endpointId,
            updatedDescription,
            smbServerApiKey
          );
        } catch (err) {
          if (
            err instanceof SmbEndpointActionError &&
            err.isEndpointNotConfiguredYet
          ) {
            reply.code(425).send({
              message:
                `Session ${sessionId} has no configured SMB endpoint yet ` +
                `(still negotiating). Retry shortly.`
            });
            return;
          }
          throw err;
        }

        const pinChanged =
          pinnedSessionId !== null &&
          pinnedSessionId !== (userSession.pinnedVideoSessionId ?? null);
        if (pinChanged) {
          await smb.requestKeyframe(
            smbServerUrl,
            line.smbConferenceId,
            endpointId,
            updatedDescription,
            smbServerApiKey
          );
        }

        await productionManager.updateSessionVideoPin(
          sessionId,
          updatedDescription,
          pinnedSessionId
        );

        reply.code(200).send({ sessionId, pinnedSessionId });
      } catch (err) {
        Log().error(err);
        reply
          .code(500)
          .send(
            'Exception thrown when trying to set session video source: ' + err
          );
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
        params: ProductionLineParams,
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
          const activeUsers = await productionManager.getActiveUsers(
            productionId
          );
          const activeUsersOnLine = activeUsers.filter(
            (s) => s.lineId === line.id && s.isActive
          );
          if (activeUsersOnLine.length > 0) {
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
        reply.code(500).send('Failed to get line');
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

        // Look up videoEnabled from the line configuration
        const production = await productionManager.requireProduction(
          parseInt(productionId, 10)
        );
        const line = productionManager.requireLine(production.lines, lineId);
        const videoEnabled = line.videoEnabled ?? false;

        await productionManager.createUserSession(
          smbConferenceId,
          productionId,
          lineId,
          sessionId,
          username,
          false
        );

        const endpointId: string = uuidv4();
        const idleTimeout = parseInt(opts.endpointIdleTimeout, 10);
        const endpoint = await coreFunctions.createEndpoint(
          smb,
          smbServerUrl,
          smbServerApiKey,
          smbConferenceId,
          endpointId,
          true, // audio
          videoEnabled, // video
          true, // data
          true, // iceControlling
          'ssrc-rewrite', // audio relay type
          isNaN(idleTimeout) ? 60 : idleTimeout,
          'ssrc-rewrite'
        );
        if (!endpoint.audio) {
          throw new Error('Missing audio when creating sdp offer for endpoint');
        }
        if (!endpoint.audio.ssrcs) {
          throw new Error('Missing ssrcs when creating sdp offer for endpoint');
        }

        await dbManager.updateSession(sessionId, {
          endpointId,
          sessionDescription: endpoint, // SmbEndpointDescription
          isActive: true,
          lastSeen: Date.now()
        });

        const sdpOffer = await coreFunctions.createConnection(
          smbConferenceId,
          productionId,
          lineId,
          endpoint,
          username,
          endpointId,
          sessionId,
          videoEnabled
        );

        if (sdpOffer) {
          reply
            .code(201)
            .type('application/json')
            .send({ sessionId, sdp: sdpOffer });
        } else {
          reply.code(400).send({
            message: 'Could not establish a media connection',
            stackTrace: 'Failed to generate sdp offer for endpoint'
          });
          return;
        }
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to create endpoint');
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
        params: SessionIdParams,
        response: {
          204: Type.Null(),
          400: Type.String(),
          410: ErrorResponse,
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const { sessionId } = request.params;

        let userSession = await dbManager.getSession(sessionId);

        // Retry up to 5×100ms in case sessionDescription has not been written to DB yet
        for (
          let i = 0;
          i < 5 && (!userSession || !userSession.sessionDescription);
          i++
        ) {
          await new Promise((r) => setTimeout(r, 100));
          userSession = await dbManager.getSession(sessionId);
        }

        if (!userSession) {
          reply
            .code(410)
            .send({ message: `User session id "${sessionId}" not found.` });
          return;
        }

        // Update db session
        await dbManager.updateSession(sessionId, {
          isActive: true,
          lastSeen: Date.now()
        });

        const productionIdNum = parseInt(userSession.productionId, 10);
        if (isNaN(productionIdNum)) {
          reply.code(400).send('Invalid production ID in session');
          return;
        }
        const production = await productionManager.requireProduction(
          productionIdNum
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

        let subscribeToVideo:
          | { ssrcs: number[]; endpointId: string }
          | undefined;
        try {
          const productionIdNum = parseInt(userSession.productionId, 10);
          if (!Number.isNaN(productionIdNum)) {
            const production = await productionManager.getProduction(
              productionIdNum
            );
            const lineForPin = production?.lines.find(
              (l) => l.id === userSession.lineId
            );
            let pinnedSessionId: string | null =
              lineForPin?.whepSourceSessionId ?? null;

            if (!pinnedSessionId) {
              const whipCandidates = (await dbManager.getSessionsByQuery({
                productionId: userSession.productionId,
                lineId: userSession.lineId,
                isActive: true,
                isWhip: true,
                hasVideo: true
              } as Partial<UserSession>)) as UserSession[];
              if (whipCandidates.length === 1) {
                pinnedSessionId =
                  (
                    whipCandidates[0] as UserSession & { _id?: unknown }
                  )._id?.toString?.() ?? null;
              }
            }

            if (pinnedSessionId) {
              const sourceSession = await dbManager.getSession(pinnedSessionId);
              const sourceVideo: any = sourceSession?.sessionDescription?.video;
              const sourceEndpointId = sourceSession?.endpointId;
              const ssrcs: number[] = Array.isArray(sourceVideo?.ssrcs)
                ? sourceVideo.ssrcs
                : [];
              if (sourceEndpointId && ssrcs.length > 0) {
                subscribeToVideo = { ssrcs, endpointId: sourceEndpointId };
              }
            }
          }
        } catch {
          // Pin resolution failed — fall back to default rotation.
        }

        await coreFunctions.handleAnswerRequest(
          smb,
          smbServerUrl,
          smbServerApiKey,
          line.smbConferenceId,
          endpointId,
          connectionEndpointDescription,
          request.body.sdpAnswer,
          subscribeToVideo
        );

        await productionManager.updateUserEndpoint(
          sessionId,
          endpointId,
          connectionEndpointDescription
        );

        try {
          const sendingSsrcs = connectionEndpointDescription.video?.ssrcs ?? [];
          await productionManager.updateSessionHasVideo(
            sessionId,
            sendingSsrcs.length > 0
          );
        } catch (hasVideoErr) {
          Log().warn(
            `Could not determine hasVideo for session=${sessionId} from ` +
              `endpoint: ${hasVideoErr}`
          );
        }

        reply.code(204).send();
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to configure endpoint');
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
        params: ProductionIdParams,
        response: {
          200: Type.String(),
          400: Type.String(),
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
        reply.code(500).send('Failed to delete production');
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
        params: SessionIdParams,
        response: {
          200: Type.String(),
          400: Type.String(),
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      const sessionId = request.params.sessionId;
      try {
        await productionManager.clearWhepSourceIfPinned(sessionId);

        try {
          const affected = await productionManager.getReceiversPinnedToSession(
            sessionId
          );
          if (affected.length > 0) {
            const production = await productionManager.getProduction(
              parseInt(affected[0].productionId, 10)
            );
            const line = production?.lines.find(
              (l) => l.id === affected[0].lineId
            );
            if (line) {
              await Promise.all(
                affected.map(async (receiver) => {
                  const receiverId = (receiver as any)._id?.toString?.();
                  const endpointId = receiver.endpointId;
                  const endpointDescription = receiver.sessionDescription;
                  if (!receiverId || !endpointId || !endpointDescription)
                    return;
                  const updatedDescription: SmbEndpointDescription = JSON.parse(
                    JSON.stringify(endpointDescription)
                  );
                  if (updatedDescription.video) {
                    delete updatedDescription.video['ssrc-whitelist'];
                  }
                  await smb.reconfigureEndpoint(
                    smbServerUrl,
                    line.smbConferenceId,
                    endpointId,
                    updatedDescription,
                    smbServerApiKey
                  );
                  await productionManager.updateSessionVideoPin(
                    receiverId,
                    updatedDescription,
                    null
                  );
                })
              );
            }
          }
        } catch {
          // Never let pin reconciliation block the session delete itself.
        }

        const ok = await dbManager.deleteUserSession(sessionId);
        if (!ok) {
          throw new Error(`Could not delete connection ${sessionId}`);
        }
        productionManager.removeUserSession(sessionId);
        productionManager.emit('users:change');
        reply.code(200).send(`Deleted connection ${sessionId}`);
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to delete connection');
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
        params: ProductionLineParams,
        response: {
          200: Type.Array(UserResponse),
          400: Type.String(),
          500: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const timeoutMs = 25_000;

        // Wait until either users:change fires or timeout expires
        await new Promise<void>((resolve) => {
          const onChange = () => {
            clearTimeout(timer);
            resolve();
          };

          const timer = setTimeout(() => {
            productionManager.off('users:change', onChange);
            resolve();
          }, timeoutMs);

          productionManager.once('users:change', onChange);
        });

        const { productionId, lineId } = request.params;

        const dbSessions = await dbManager.getSessionsByQuery({
          productionId,
          lineId,
          isExpired: false
        });

        const participants: UserResponse[] = (dbSessions as any[]).map((s) => ({
          sessionId: s._id.toString(),
          endpointId: s.endpointId,
          name: s.name,
          isActive: s.isWhip ? true : Boolean(s.isActive),
          isWhip: Boolean(s.isWhip),
          isWhepReceiver: Boolean(s.isWhepReceiver),
          hasVideo: Boolean(s.hasVideo)
        }));

        reply.code(200).send(sortParticipants(participants));
      } catch (err) {
        Log().error(err);
        reply.code(500).send('Failed to set connection status');
      }
    }
  );

  fastify.get<{
    Params: { sessionId: string };
    Reply: string;
  }>(
    '/heartbeat/:sessionId',
    {
      schema: {
        description: 'Update user session lastSeen',
        params: SessionIdParams,
        response: {
          200: Type.String(),
          400: Type.String(),
          410: Type.String()
        }
      }
    },
    async (request, reply) => {
      const { sessionId } = request.params;
      const status = await productionManager.updateUserLastSeen(sessionId);
      if (status) {
        reply.code(200).send('ok');
      } else {
        reply.code(410).send(`User session id "${sessionId}" not found.`);
      }
    }
  );

  fastify.get<{ Params: { sessionId: string } }>(
    '/session/:sessionId/name',
    {
      schema: {
        description: 'Get the display name of a session.',
        params: SessionIdParams,
        response: {
          200: Type.Object({
            sessionId: Type.String(),
            name: Type.String()
          }),
          404: ErrorResponse
        }
      }
    },
    async (request, reply) => {
      const name = await productionManager.getUserNameBySessionId(
        request.params.sessionId
      );
      if (name == null) {
        reply.code(404).send({ message: 'Session not found' });
        return;
      }
      reply.code(200).send({ sessionId: request.params.sessionId, name });
    }
  );

  next();
};

export function getApiProductions(): FastifyPluginCallback<ApiProductionsOptions> {
  return apiProductions;
}
