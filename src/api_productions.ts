import { Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import {
  NewProduction,
  Production,
  Line,
  LineResponse,
  SmbEndpointDescription,
  ProductionResponse,
  User
} from './models';
import { SmbProtocol } from './smb';
import { ProductionManager } from './production_manager';
import { Connection } from './connection';
import { write, parse, SessionDescription } from 'sdp-transform';
import dotenv from 'dotenv';
import { MediaStreamsInfoSsrc } from './media_streams_info';
import { v4 as uuidv4 } from 'uuid';
import { Timer, UserManager } from './user_manager';
dotenv.config();

const productionManager = new ProductionManager();

function createConnection(
  endpoint: SmbEndpointDescription,
  productionId: string,
  lineId: string,
  username: string,
  endpointId: string,
  sessionId: string
): Connection {
  if (!endpoint.audio) {
    throw new Error('Missing audio when creating offer');
  }

  const ssrcs: MediaStreamsInfoSsrc[] = [];
  endpoint.audio.ssrcs.forEach((ssrcsNr) => {
    ssrcs.push({
      ssrc: ssrcsNr.toString(),
      cname: `${username}_audioCName`,
      mslabel: `${username}_audioMSLabel`,
      label: `${username}_audioLabel`
    });
  });

  const endpointMediaStreamInfo = {
    audio: {
      ssrcs: ssrcs
    }
  };

  const connection = new Connection(
    username,
    endpointMediaStreamInfo,
    endpoint,
    endpointId
  );

  productionManager.addConnectionToLine(
    productionId,
    lineId,
    endpoint,
    endpointId,
    sessionId
  );

  return connection;
}

async function createEndpoint(
  smb: SmbProtocol,
  smbServerUrl: string,
  lineId: string,
  endpointId: string,
  audio: boolean,
  data: boolean,
  endpointIdleTimeout: number
): Promise<SmbEndpointDescription> {
  const endpoint: SmbEndpointDescription = await smb.allocateEndpoint(
    smbServerUrl,
    lineId,
    endpointId,
    audio,
    data,
    endpointIdleTimeout
  );
  return endpoint;
}

async function handleAnswerRequest(
  smb: SmbProtocol,
  smbServerUrl: string,
  lineId: string,
  endpointId: string,
  endpointDescription: SmbEndpointDescription,
  answer: string
): Promise<void> {
  if (!endpointDescription) {
    throw new Error(
      'Missing endpointDescription when handling sdp answer from endpoint'
    );
  }
  if (!endpointDescription.audio) {
    throw new Error(
      'Missing endpointDescription audio when handling sdp answer from endpoint'
    );
  }
  endpointDescription.audio.ssrcs = [];

  const parsedAnswer = parse(answer);
  const answerMediaDescription = parsedAnswer.media[0];
  if (parsedAnswer.media[1].ssrcs) {
    let parsedSsrcs = parsedAnswer.media[1].ssrcs[0].id;
    if (typeof parsedSsrcs === 'string') {
      parsedSsrcs = parseInt(parsedSsrcs, 10);
    }
    endpointDescription.audio.ssrcs.push(parsedSsrcs);
  }
  if (endpointDescription.audio.ssrcs.length === 0) {
    throw new Error(
      'Missing audio ssrcs when handling sdp answer from endpoint'
    );
  }

  const transport = endpointDescription['bundle-transport'];
  if (!transport) {
    throw new Error(
      'Missing endpointDescription when handling sdp answer from endpoint'
    );
  }
  if (!transport.dtls) {
    throw new Error('Missing dtls when handling sdp answer from endpoint');
  }
  if (!transport.ice) {
    throw new Error('Missing ice when handling sdp answer from endpoint');
  }

  const answerFingerprint = parsedAnswer.fingerprint
    ? parsedAnswer.fingerprint
    : answerMediaDescription.fingerprint;
  if (!answerFingerprint) {
    throw new Error(
      'Missing answerFingerprint when handling sdp answer from endpoint'
    );
  }
  transport.dtls.type = answerFingerprint.type;
  transport.dtls.hash = answerFingerprint.hash;
  transport.dtls.setup = answerMediaDescription.setup || '';
  transport.ice.ufrag = answerMediaDescription.iceUfrag || '';
  transport.ice.pwd = answerMediaDescription.icePwd || '';
  transport.ice.candidates = !answerMediaDescription.candidates
    ? []
    : answerMediaDescription.candidates.flatMap((element) => {
        return {
          generation: element.generation ? element.generation : 0,
          component: element.component,
          protocol: element.transport.toLowerCase(),
          port: element.port,
          ip: element.ip,
          relPort: element.rport,
          relAddr: element.raddr,
          foundation: element.foundation.toString(),
          priority: parseInt(element.priority.toString(), 10),
          type: element.type,
          network: element['network-id']
        };
      });

  return await smb.configureEndpoint(
    smbServerUrl,
    lineId,
    endpointId,
    endpointDescription
  );
}

async function getActiveLines(
  smb: SmbProtocol,
  smbServerUrl: string
): Promise<string[]> {
  const productions: string[] = await smb.getConferences(smbServerUrl);
  return productions;
}

function getProduction(productionId: string): Production {
  const production: Production | undefined =
    productionManager.getProduction(productionId);
  if (!production) {
    throw new Error('Trying to get production that does not exist');
  }
  return production;
}

function getLine(productionLines: Line[], lineId: string): Line {
  const line: Line | undefined = productionManager.getLine(
    productionLines,
    lineId
  );
  if (!line) {
    throw new Error('Trying to get line that does not exist');
  }
  return line;
}

function getUser(line: Line, sessionid: string): User {
  const lineUserManager: UserManager = line.users;
  const user: User | undefined = lineUserManager.getUser(sessionid);
  if (!user) {
    throw new Error(`Could not find user session ${sessionid}`);
  }
  return user;
}

function retrieveLineFromProduction(productionId: string, lineId: string) {
  const production: Production = getProduction(productionId);
  const line: Line = getLine(production.lines, lineId);
  return line;
}

function cleanupInActiveSessions(
  userInactivityThreshold: string,
  userRemovalThreshold: string
) {
  const productions: Production[] = productionManager.getProductions();
  for (const production of productions) {
    for (const line of production.lines) {
      const lineUserManager: UserManager = line.users;
      const users: User[] = lineUserManager.getUsers();
      for (const user of users) {
        const userTimer: Timer = user.heartbeatTimer;
        const timeSinceLastHeartbeat: number = userTimer.getTime();
        if (timeSinceLastHeartbeat >= parseInt(userInactivityThreshold, 10)) {
          user.isActive = false;
        } else if (
          timeSinceLastHeartbeat >= parseInt(userRemovalThreshold, 10)
        ) {
          const lineUserManager: UserManager = line.users;
          lineUserManager.removeUser(user.sessionid);
        }
      }
    }
  }
}

export interface ApiProductionsOptions {
  smbServerBaseUrl: string;
  endpointIdleTimeout: string;
  regularCleanup: string;
  userInactivityThreshold: string;
  userRemovalThreshold: string;
  userCleanupInterval: string;
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

  if (opts.regularCleanup === 'true') {
    setInterval(() => {
      cleanupInActiveSessions(
        opts.userInactivityThreshold,
        opts.userCleanupInterval
      );
    }, parseInt(opts.userCleanupInterval, 10) * 1000);
  }

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
        const production: Production | undefined =
          productionManager.createProduction(request.body);
        if (production) {
          const productionRepsonse: ProductionResponse = {
            productionid: production.productionid
          };
          reply.code(200).send(productionRepsonse);
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
    Reply: Production[] | string;
  }>(
    '/productions',
    {
      schema: {
        description: 'Retrieves all Productions.',
        response: {
          200: Type.Array(Production)
        }
      }
    },
    async (request, reply) => {
      try {
        const productions: Production[] = productionManager.getProductions();
        reply.code(200).send(productions);
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to get productions: ' + err);
      }
    }
  );

  fastify.get<{
    Params: { productionid: string };
    Reply: Production | string;
  }>(
    '/productions/:productionid',
    {
      schema: {
        description: 'Retrieves a Production.',
        response: {
          200: Production
        }
      }
    },
    async (request, reply) => {
      try {
        const production: Production = getProduction(
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
    Reply: Line[] | string;
  }>(
    '/productions/:productionid/lines',
    {
      schema: {
        description: 'Retrieves all lines for a Production.',
        response: {
          200: Type.Array(Line)
        }
      }
    },
    async (request, reply) => {
      try {
        const production: Production = getProduction(
          request.params.productionid
        );
        reply.code(200).send(production.lines);
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
        const line: Line = retrieveLineFromProduction(
          request.params.productionid,
          request.params.lineid
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
        const production: Production = getProduction(
          request.params.productionid
        );
        const line: Line = getLine(production.lines, request.params.lineid);

        const activeLines = await getActiveLines(smb, smbServerUrl);
        if (!activeLines.includes(line.smbid)) {
          const newLineId = await smb.allocateConference(smbServerUrl);
          if (
            !productionManager.setLineId(
              production.productionid,
              line.id,
              newLineId
            )
          ) {
            throw new Error(
              `Failed to set line smb id for line ${line.id} in production ${production.productionid}`
            );
          }
        }

        const endpointId: string = uuidv4();
        const endpoint = await createEndpoint(
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
        const sessionId: string = uuidv4();
        const connection: Connection = createConnection(
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
          200: Line
        }
      }
    },
    async (request, reply) => {
      try {
        const line: Line = retrieveLineFromProduction(
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

        await handleAnswerRequest(
          smb,
          smbServerUrl,
          line.smbid,
          endpointId,
          connectionEndpointDescription,
          request.body
        );
        reply.code(200).send(line);
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
        description: 'Long Poll Endpoint to receive participant list.',
        response: {
          200: Type.Array(User)
        }
      }
    },
    async (request, reply) => {
      try {
        const line: Line = retrieveLineFromProduction(
          request.params.productionid,
          request.params.lineid
        );
        const lineUserManager: UserManager = line.users;
        const participants: User[] = lineUserManager.getUsers();

        const waitForChange = new Promise<void>((resolve) => {
          lineUserManager.changeEmitter.once('change', () => {
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

  //heartbeat endpoint
  fastify.post<{
    Params: { productionid: string; lineid: string; sessionid: string };
    Reply: string;
  }>(
    '/productions/:productionid/lines/:lineid/session/:sessionid',
    {
      schema: {
        description: 'Heartbeat Endpoint to confirm client session is active.',
        response: {
          200: Type.String()
        }
      }
    },
    async (request, reply) => {
      try {
        const line: Line = retrieveLineFromProduction(
          request.params.productionid,
          request.params.lineid
        );
        const user: User = getUser(line, request.params.sessionid);
        user.heartbeatTimer.resetTimer();
        reply
          .code(200)
          .send(`Heartbeat confirmed for session ${request.params.sessionid}`);
      } catch (err) {
        reply
          .code(500)
          .send(
            `Exception thrown when trying to set connection status for session ${request.params.sessionid}: ` +
              err
          );
      }
    }
  );

  next();
};

export default apiProductions;
