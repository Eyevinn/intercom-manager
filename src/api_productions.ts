import { Type } from '@sinclair/typebox';
import { FastifyPluginCallback, FastifyRequest } from 'fastify';
import { NewProduction, Production, SdpOffer, SdpAnswer } from './models';

const apiProductions: FastifyPluginCallback = (fastify, opts, next) => {
  fastify.post<{
    Body: typeof NewProduction;
    Reply: typeof Production;
  }>(
    '/production',
    {
      schema: {
        description: 'Create a new Production resource.',
        body: NewProduction,
        response: {
          200: Production
        }
      }
    },
    async (request, reply) => {
      try {
        //prod = new Production(name, [line1, line2, line3])
        //Production construction will make calls to smb and set up each line.
      } catch (err) {
        //error handling
      }
    }
  );

  fastify.get<{
    Params: { id: string };
    Reply: any;
  }>(
    '/production',
    {
      schema: {
        description: 'Retrieves all Production resource.',
        response: {
          200: Type.Array(Production)
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

  fastify.get<{
    Params: { id: string };
    Reply: any;
  }>(
    '/productions/:id',
    {
      schema: {
        description: 'Retrieves a Production resource.',
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
        description: 'Delete a Production resource.',
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
    Body: typeof SdpOffer;
    Reply: typeof SdpAnswer;
  }>(
    '/productions/:id/lines/:name',
    {
      schema: {
        description: 'Join a Production line.',
        body: SdpOffer,
        response: {
          200: SdpAnswer
        }
      }
    },
    async (request, reply) => {
      try {
        //Generate SDP, and anything other information required to set up a connection.
      } catch (err) {
        //error handling
      }
    }
  );

  next();
};
