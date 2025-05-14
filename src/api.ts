import fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import cookie from '@fastify/cookie';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Static, Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import { getApiProductions } from './api_productions';
import apiShare from './api_share';
import apiReAuth from './api_re_auth';
import fastifyCookie from '@fastify/cookie';
import { getApiIngests } from './api_ingests';
import { DbManager } from './db/interface';
import { ProductionManager } from './production_manager';
import { IngestManager } from './ingest_manager';

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

export interface ApiOptions {
  title: string;
  smbServerBaseUrl: string;
  endpointIdleTimeout: string;
  smbServerApiKey?: string;
  publicHost: string;
  dbManager: DbManager;
  productionManager: ProductionManager;
  ingestManager: IngestManager;
}

export default async (opts: ApiOptions) => {
  const api = fastify({
    ignoreTrailingSlash: true
  }).withTypeProvider<TypeBoxTypeProvider>();

  // register the cookie plugin
  api.register(fastifyCookie);

  // register the cors plugin, configure it for better security
  api.register(cors, {
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  });

  // register cookie plugin
  api.register(cookie);

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
  api.register(getApiProductions(), {
    prefix: 'api/v1',
    smbServerBaseUrl: opts.smbServerBaseUrl,
    endpointIdleTimeout: opts.endpointIdleTimeout,
    smbServerApiKey: opts.smbServerApiKey,
    dbManager: opts.dbManager,
    productionManager: opts.productionManager
  });
  api.register(apiShare, { publicHost: opts.publicHost, prefix: 'api/v1' });
  api.register(apiReAuth, { prefix: 'api/v1' });
  api.register(getApiIngests(), {
    prefix: 'api/v1',
    dbManager: opts.dbManager,
    ingestManager: opts.ingestManager
  });
  return api;
};
