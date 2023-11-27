import { Type, Static } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import { NewProduction, Production, Line } from './models';
import { SmbProtocol, SmbEndpointDescription } from './smb';
import { ProductionManager } from './production_manager';
import { Connection } from './connection';
import { write, parse } from 'sdp-transform';

type NewProduction = Static<typeof NewProduction>;
type Production = Static<typeof Production>;
type Line = Static<typeof Line>;

const productionManager = new ProductionManager();
const ENDPOINT_IDLE_TIMEOUT_S = 600;

function generateOffer(
  endpoint: SmbEndpointDescription,
  productionName: string,
  lineName: string,
  username: string
): string {
  if (!endpoint.audio) {
    throw new Error('Missing audio when creating offer');
  }

  const ssrcs: object[] = [];
  endpoint.audio.ssrcs.forEach((ssrcsNr) => {
    ssrcs.push({
      ssrc: ssrcsNr,
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
    endpoint
  );

  productionManager.addConnectionToLine(
    productionName,
    lineName,
    username,
    endpoint
  );

  const offer = connection.createOffer();
  const sdp = write(offer);
  return sdp;
}

async function createEndpoint(
  smb: SmbProtocol,
  smbServerUrl: string,
  lineId: string,
  endpointId: string,
  audio: boolean,
  data: boolean
): Promise<SmbEndpointDescription> {
  const endpoint: SmbEndpointDescription = await smb.allocateEndpoint(
    smbServerUrl,
    lineId,
    endpointId,
    audio,
    data,
    ENDPOINT_IDLE_TIMEOUT_S
  );
  return endpoint;
}

async function handleAnswerRequest(
  smb: SmbProtocol,
  smbServerUrl: string,
  lineName: string,
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
  //endpointDescription.video.streams = [];

  const parsedAnswer = parse(answer);
  const answerMediaDescription = parsedAnswer.media[0];
  if(parsedAnswer.media[1].ssrcs) {
    let parsedSsrcs = parsedAnswer.media[1].ssrcs[0].id;
    if (typeof parsedSsrcs === "string"){
      parsedSsrcs = parseInt(parsedSsrcs, 10);
    }
    endpointDescription.audio.ssrcs.push(parsedSsrcs) 
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
    lineName,
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

function getProduction(name: string): Production {
  const production: Production | undefined =
    productionManager.getProduction(name);
  if (!production) {
    throw new Error('Trying to join production that does not exist');
  }
  return production;
}

function getLine(productionLines: Line[], name: string): Line {
  const line: Line | undefined = productionManager.getLine(
    productionLines,
    name
  );
  if (!line) {
    throw new Error('Trying to join production that does not exist');
  }
  return line;
}

const apiProductions: FastifyPluginCallback = (fastify, opts, next) => {
  const smbServerUrl = 'http://localhost:8080/conferences/';
  const smb = new SmbProtocol();

  fastify.post<{
    Body: NewProduction;
    Reply: Production | string;
  }>(
    '/production',
    {
      schema: {
        // description: 'Create a new Production resource.',
        body: NewProduction,
        response: {
          200: Production
        }
      }
    },
    async (request, reply) => {
      try {
        const production: Production | undefined =
          await productionManager.createProduction(request.body);
        if (production) {
          reply.code(200).send(production);
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
    Reply: string[] | string;
  }>(
    '/productions/lines',
    {
      schema: {
        // description: 'Retrieves all active Production lines.',
        response: {
          200: Type.Array(Type.String())
        }
      }
    },
    async (request, reply) => {
      try {
        const productionsSavedInManager = productionManager.getProductions();
        console.log(productionsSavedInManager);
        const lines = await getActiveLines(smb, smbServerUrl);
        if (lines) {
          console.log(lines);
          reply.code(200).send(lines);
        }
      } catch (err) {
        reply
          .code(500)
          .send(
            'Exception thrown when trying to get active production lines: ' +
              err
          );
      }
    }
  );

  fastify.get<{
    Params: { name: string; lineName: string };
    Reply: Line | string;
  }>(
    '/productions/:name/lines/:lineName',
    {
      schema: {
        // description: 'Retrieves an active Production line.',
        response: {
          200: Type.Object({ Line })
        }
      }
    },
    async (request, reply) => {
      try {
        const production: Production = getProduction(request.params.name);
        const line: Line = getLine(production.lines, request.params.lineName);
        reply.code(200).send(line);
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to get line: ' + err);
      }
    }
  );

  fastify.post<{
    Params: { name: string; lineName: string; username: string };
    Reply: { [key: string]: string | string[] } | string;
  }>(
    '/productions/:name/lines/:lineName/:username',
    {
      schema: {
        // description: 'Join a Production.',
        response: {
          200: Type.Object({
            sdp: Type.String()
          })
        }
      }
    },
    async (request, reply) => {
      try {
        const production: Production = getProduction(request.params.name);
        const line: Line = getLine(production.lines, request.params.lineName);

        const activeLines = await getActiveLines(smb, smbServerUrl);
        if (!activeLines.includes(line.id)) {
          const newLineId = await smb.allocateConference(smbServerUrl);
          productionManager.setLineId(production.name, line.name, newLineId);
        }

        const endpoint = await createEndpoint(
          smb,
          smbServerUrl,
          line.id,
          request.params.username,
          true,
          false
        );
        if (!endpoint.audio) {
          throw new Error('Missing audio when creating sdp offer for endpoint');
        }
        if (!endpoint.audio.ssrcs) {
          throw new Error('Missing ssrcs when creating sdp offer for endpoint');
        }
        if (request.params.name in line.connections) {
          throw new Error(`Connection ${request.params.name} already exists`);
        }
        const sdpOffer = generateOffer(
          endpoint,
          production.name,
          line.name,
          request.params.username
        );

        if (sdpOffer) {
          console.log(sdpOffer);
          reply.code(200).send({ sdp: sdpOffer });
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
    Params: { name: string; lineName: string; username: string };
    Body: string;
  }>(
    '/productions/:name/lines/:lineName/:username',
    {
      schema: {
        //description: 'Join a Production line.',
        response: {
          200: Type.Object({})
        }
      }
    },
    async (request, reply) => {
      try {
        const production: Production = getProduction(request.params.name);
        const line: Line = getLine(production.lines, request.params.lineName);

        const connectionEndpointDescription =
          line.connections[request.params.username];

        if (!connectionEndpointDescription) {
          throw new Error('Could not get connection endpoint description');
        }

        await handleAnswerRequest(
          smb,
          smbServerUrl,
          line.id,
          request.params.username,
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

  next();
};

export default apiProductions;
