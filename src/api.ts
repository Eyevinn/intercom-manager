import fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Static, Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import apiProductions, { ApiProductionsOptions } from './api_productions';
import apiWhip, { ApiWhipOptions } from './api_whip';
import { ProductionManager } from './production_manager';
import { CoreFunctions } from './api_productions_core_functions';

const HelloWorld = Type.String({
  description: 'The magical words!'
});

export interface HealthcheckOptions {
  title: string;
}

const healthcheck: FastifyPluginCallback<HealthcheckOptions> = (
  fastify,
  opts,
  next
) => {
  fastify.get<{ Reply: Static<typeof HelloWorld> }>(
    '/',
    {
      schema: {
        description: 'Say hello',
        response: {
          200: HelloWorld
        }
      }
    },
    async (_, reply) => {
      reply.send('Hello, world! I am ' + opts.title);
    }
  );
  next();
};

export interface ApiGeneralOptions {
  title: string;
}
export type ApiOptions = ApiGeneralOptions &
  ApiProductionsOptions &
  ApiWhipOptions;

export default async (opts: ApiOptions) => {
  const api = fastify({
    ignoreTrailingSlash: true
  }).withTypeProvider<TypeBoxTypeProvider>();

  // register the cors plugin, configure it for better security
  api.register(cors, {
    methods: ['OPTIONS', 'GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-jwt'],
    exposedHeaders: ['Content-Type', 'Location']
  });

  // register the swagger plugins, it will automagically do magic
  api.register(swagger, {
    swagger: {
      info: {
        title: opts.title,
        description: 'Intercom Manager API',
        version: 'v1'
      }
    }
  });
  api.register(swaggerUI, {
    routePrefix: '/api/docs'
  });

  api.register(healthcheck, { title: opts.title });
  // register other API routes here
  api.register(apiProductions, {
    prefix: 'api/v1',
    smbServerBaseUrl: opts.smbServerBaseUrl,
    endpointIdleTimeout: opts.endpointIdleTimeout,
    smbServerApiKey: opts.smbServerApiKey,
    productionManager: opts.productionManager,
    coreFunctions: opts.coreFunctions
  });
  api.register(apiWhip, {
    prefix: 'whip',
    whipApiKey: opts.whipApiKey,
    smbServerBaseUrl: opts.smbServerBaseUrl,
    endpointIdleTimeout: opts.endpointIdleTimeout,
    smbServerApiKey: opts.smbServerApiKey,
    coreFunctions: opts.coreFunctions
  });

  return api;
};
