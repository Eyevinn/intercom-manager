import { FastifyPluginCallback } from 'fastify';
import { Type } from '@sinclair/typebox';
import { requireAuth } from './auth/middleware';
import { TalkManager } from './talk_manager';
import { ActiveTalksResponse } from './models/talk';
import { Log } from './log';

export interface ApiStatusOptions {
  talkManager: TalkManager;
}

/**
 * REST endpoint for querying current talk state (M3).
 * Intended for external monitoring systems and dashboards.
 *
 * GET /api/v1/status/talks — Current active talks snapshot
 */
export const getApiStatus = (): FastifyPluginCallback<ApiStatusOptions> => {
  return (fastify, opts, next) => {
    const { talkManager } = opts;

    // GET /health — System health check (no auth)
    fastify.get(
      '/health',
      {
        schema: {
          description: 'System health check',
          response: {
            200: Type.Object({
              status: Type.String(),
              uptime: Type.Number(),
              timestamp: Type.String(),
              components: Type.Object({
                talkManager: Type.String()
              })
            })
          }
        }
      },
      async (_request, reply) => {
        try {
          // Basic health: verify talkManager is accessible
          const talks = talkManager.getActiveTalks();
          reply.send({
            status: 'ok',
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            components: {
              talkManager: 'ok'
            }
          });
        } catch (err: any) {
          reply.code(503).send({
            status: 'degraded',
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            components: {
              talkManager: 'error'
            }
          });
        }
      }
    );

    // GET /status/talks — Current active talks snapshot
    fastify.get<{
      Reply: typeof ActiveTalksResponse.static;
    }>(
      '/status/talks',
      {
        preHandler: requireAuth,
        schema: {
          description: 'Get current active talks snapshot',
          response: { 200: ActiveTalksResponse }
        }
      },
      async (request, reply) => {
        try {
          const talks = talkManager.getActiveTalks();
          reply.send({
            talks,
            timestamp: new Date().toISOString()
          });
        } catch (err: any) {
          Log().error(`Failed to get active talks: ${err.message}`);
          reply.code(500).send({ message: 'Internal server error' } as any);
        }
      }
    );

    next();
  };
};
