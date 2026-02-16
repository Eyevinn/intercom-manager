import fastifyCookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import fastifyWebsocket from '@fastify/websocket';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import fastify from 'fastify';
import path from 'path';
import fs from 'fs';
import { getApiCalls } from './api_calls';
import { getApiIngests } from './api_ingests';
import { getApiClients } from './api_clients';
import { getApiStatus } from './api_status';
import { ApiProductionsOptions, getApiProductions } from './api_productions';
import apiReAuth from './api_re_auth';
import apiShare from './api_share';
import apiWhip, { ApiWhipOptions } from './api_whip';
import apiWhep, { ApiWhepOptions } from './api_whep';
import { CallManager } from './call_manager';
import { ClientRegistry } from './client_registry';
import { DbManager } from './db/interface';
import { IngestManager } from './ingest_manager';
import { ProductionManager } from './production_manager';
import { StatusManager } from './websocket/status_manager';
import { TalkManager } from './talk_manager';


export interface ApiGeneralOptions {
  title: string;
  smbServerBaseUrl: string;
  endpointIdleTimeout: string;
  smbServerApiKey?: string;
  publicHost: string;
  dbManager: DbManager;
  productionManager: ProductionManager;
  ingestManager: IngestManager;
  clientRegistry?: ClientRegistry;
  statusManager?: StatusManager;
  callManager?: CallManager;
  talkManager?: TalkManager;
}

export type ApiOptions = ApiGeneralOptions &
  ApiProductionsOptions &
  ApiWhipOptions &
  ApiWhepOptions;

export default async (opts: ApiOptions) => {
  const api = fastify({
    ignoreTrailingSlash: true
  }).withTypeProvider<TypeBoxTypeProvider>();

  // register the cookie plugin
  api.register(fastifyCookie);

  // register the cors plugin, configure it for better security
  api.register(cors, {
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Type']
  });

  await api.register(fastifyRateLimit, {
    global: false // Only apply to specific routes
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

  // Register WebSocket support
  await api.register(fastifyWebsocket);

  // Register client registry routes (M1)
  if (opts.clientRegistry) {
    api.register(getApiClients(), {
      prefix: 'api/v1',
      clientRegistry: opts.clientRegistry
    });
  }

  // Register call routes (M2)
  if (opts.callManager && opts.statusManager && opts.clientRegistry) {
    api.register(getApiCalls(), {
      prefix: 'api/v1',
      callManager: opts.callManager,
      statusManager: opts.statusManager,
      clientRegistry: opts.clientRegistry
    });
  }

  // Register status routes (M3)
  if (opts.talkManager) {
    api.register(getApiStatus(), {
      prefix: 'api/v1',
      talkManager: opts.talkManager
    });
  }

  // Register WebSocket status endpoint (M1)
  if (opts.statusManager) {
    opts.statusManager.registerRoutes(api);
  }

  // register other API routes here
  api.register(getApiProductions(), {
    prefix: 'api/v1',
    smbServerBaseUrl: opts.smbServerBaseUrl,
    endpointIdleTimeout: opts.endpointIdleTimeout,
    smbServerApiKey: opts.smbServerApiKey,
    dbManager: opts.dbManager,
    productionManager: opts.productionManager,
    coreFunctions: opts.coreFunctions
  });
  api.register(apiWhip, {
    prefix: 'api/v1',
    smbServerApiKey: opts.smbServerApiKey,
    endpointIdleTimeout: opts.endpointIdleTimeout,
    smbServerBaseUrl: opts.smbServerBaseUrl,
    coreFunctions: opts.coreFunctions,
    productionManager: opts.productionManager,
    dbManager: opts.dbManager,
    whipAuthKey: opts.whipAuthKey
  });
  api.register(apiWhep, {
    prefix: 'api/v1',
    smbServerApiKey: opts.smbServerApiKey,
    endpointIdleTimeout: opts.endpointIdleTimeout,
    smbServerBaseUrl: opts.smbServerBaseUrl,
    coreFunctions: opts.coreFunctions,
    productionManager: opts.productionManager,
    dbManager: opts.dbManager
  });
  api.register(apiShare, { publicHost: opts.publicHost, prefix: 'api/v1' });
  api.register(apiReAuth, { prefix: 'api/v1' });

  api.all('/whip/:productionId/:lineId', async (request, reply) => {
    if (request.method !== 'POST' && request.method !== 'OPTIONS') {
      return reply
        .code(405)
        .header('Allow', 'POST, OPTIONS')
        .send({ error: 'Method Not Allowed' });
    }
  });

  api.all('/whip/:productionId/:lineId/:sessionId', async (request, reply) => {
    if (request.method !== 'PATCH' && request.method !== 'DELETE') {
      return reply
        .code(405)
        .header('Allow', 'PATCH, DELETE')
        .send({ error: 'Method Not Allowed' });
    }
  });
  api.register(getApiIngests(), {
    prefix: 'api/v1',
    dbManager: opts.dbManager,
    ingestManager: opts.ingestManager
  });

  // Serve frontend static files from public/ directory
  const publicDir = path.join(__dirname, '..', 'public');
  if (fs.existsSync(publicDir)) {
    api.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      wildcard: false
    });

    // SPA fallback: serve index.html for non-API routes that don't match a static file
    api.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return api;
};
