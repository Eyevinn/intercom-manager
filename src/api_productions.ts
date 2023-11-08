import { Type, Static } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import { NewProduction, Production, Line } from './models';
import { SmbProtocol, SmbEndpointDescription } from './smb';
import { Participant } from './participant';
import { write, parse } from 'sdp-transform';

type NewProduction = Static<typeof NewProduction>;
type Production = Static<typeof Production>;
type Line = Static<typeof Line>;

let participants: { [id: string]: SmbEndpointDescription } = {};

async function createProduction(
  smb: SmbProtocol,
  smbServerUrl: string,
  newProduction: NewProduction
): Promise<Production | undefined> {
  let production: Production;
  let newProductionLines = [];

  for (const line of newProduction.lines) {
    const id = await smb.allocateConference(smbServerUrl);
    let newProductionLine: Line = { name: line.name, id: id };
    newProductionLines.push(newProductionLine);
  }
  production = {
    name: newProduction.name,
    lines: newProductionLines,
    id: 'MyProductionId'
  };
  if (production) {
    return production;
  } else {
    return;
  }
}

function generateOffer(endpoint: SmbEndpointDescription, name: string): string {
  if (!endpoint.audio) {
    throw new Error('Missing audio when creating offer');
  }

  let ssrcs: any = [];
  endpoint.audio.ssrcs.forEach((ssrcsNr) => {
    ssrcs.push({
      ssrc: ssrcsNr,
      cname: `${name}_audioCName`,
      mslabel: `${name}_audioMSLabel`,
      label: `${name}_audioLabel`
    });
  });

  let endpointMediaStreamInfo = {
    audio: {
      ssrcs: ssrcs
    }
  };

  const participant = new Participant(name, endpointMediaStreamInfo, endpoint);
  participants[name] = endpoint;

  let offer = participant.createOffer();
  //participant.emit("connect");
  const sdp = write(offer);
  return sdp;
}

async function createEndpoint(
  smb: SmbProtocol,
  smbServerUrl: string,
  lineId: string,
  clientName: string,
  audio: boolean,
  data: boolean
): Promise<SmbEndpointDescription> {
  const endpoint: SmbEndpointDescription = await smb.allocateEndpoint(
    smbServerUrl,
    lineId,
    clientName,
    audio,
    data,
    6000
  );
  return endpoint;
}

async function handleAnswerRequest(
  smb: SmbProtocol,
  smbServerUrl: string,
  lineId: string,
  name: string,
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

  let transport = endpointDescription['bundle-transport'];
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
    name,
    endpointDescription
  );
}

async function getProductions(
  smb: SmbProtocol,
  smbServerUrl: string
): Promise<string[]> {
  const productions: string[] = await smb.getConferences(smbServerUrl);
  return productions;
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
        const production: Production | undefined = await createProduction(
          smb,
          smbServerUrl,
          request.body
        );
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
    Reply: any;
  }>(
    '/productions',
    {
      schema: {
        // description: 'Retrieves all Production resources.',
        response: {
          200: Type.Array(Production)
        }
      }
    },
    async (request, reply) => {
      try {
        const productions = await getProductions(smb, smbServerUrl);
        if (productions) {
          console.log(productions);
          reply.code(200).send(productions);
        }
      } catch (err) {
        //error handling
      }
    }
  );

  fastify.get<{
    Params: { id: string };
    Reply: any;
  }>(
    '/productions/:id',
    {
      schema: {
        // description: 'Retrieves a Production resource.',
        response: {
          200: Production
        }
      }
    },
    async (request, reply) => {
      try {
        //request logic
      } catch (err) {
        //error handling
      }
    }
  );

  fastify.delete<{
    Params: { id: string };
    Reply: string;
  }>(
    '/productions/:id',
    {
      schema: {
        // description: 'Delete a Production resource.',
        response: {
          200: Type.Object({
            message: Type.Literal('removed')
          })
        }
      }
    },
    async (request, reply) => {
      try {
        //request logic
      } catch (err) {
        //error handling
      }
    }
  );

  fastify.post<{
    Params: { id: string; name: string };
    Reply: { [key: string]: any } | string;
  }>(
    '/productions/:id/lines/:name',
    {
      schema: {
        // description: 'Join a Production line.',
        response: {
          200: Type.Object({
            sdp: Type.String(),
            participants: Type.Array(Type.String())
          })
        }
      }
    },
    async (request, reply) => {
      try {
        const endpoint = await createEndpoint(
          smb,
          smbServerUrl,
          request.params.id,
          request.params.name,
          true,
          false
        );
        if (!endpoint.audio) {
          throw new Error('Missing audio when creating sdp offer for endpoint');
        }
        if (!endpoint.audio.ssrcs) {
          throw new Error('Missing ssrcs when creating sdp offer for endpoint');
        }
        if (request.params.name in participants) {
          throw new Error(`Participant ${request.params.name} already exists`);
        }
        let sdpOffer = generateOffer(endpoint, request.params.name); //should respond with current participants

        if (sdpOffer) {
          console.log(sdpOffer);
          reply
            .code(200)
            .send({ sdp: sdpOffer, participants: ['name1', 'name2'] });
        } else {
          reply.code(500).send('Failed to generate sdp offer for endpoint');
        }
      } catch (err) {
        reply
          .code(500)
          .send('Exception thrown when trying to create production: ' + err);
      }
    }
  );

  fastify.patch<{
    Params: { id: string; name: string };
    Body: string;
    Reply: any;
  }>(
    '/productions/:id/lines/:name',
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
        const participantEndpointDescription =
          participants[request.params.name];
        await handleAnswerRequest(
          smb,
          smbServerUrl,
          request.params.id,
          request.params.name,
          participantEndpointDescription,
          request.body
        );
        reply.code(200).send({});
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
