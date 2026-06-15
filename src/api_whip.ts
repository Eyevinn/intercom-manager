import { timingSafeEqual } from 'crypto';
import { Static, Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import sdpTransform, { parse } from 'sdp-transform';
import { v4 as uuidv4 } from 'uuid';
import { CoreFunctions } from './api_productions_core_functions';
import { Log } from './log';
import { Line, WhipWhepRequest, WhipWhepResponse } from './models';
import { ProductionManager } from './production_manager';
import { ISmbProtocol, SmbProtocol } from './smb';
import { getIceServers } from './utils';
import { DbManager } from './db/interface';

export interface ApiWhipOptions {
  smbServerBaseUrl: string;
  endpointIdleTimeout: string;
  smbServerApiKey?: string;
  coreFunctions: CoreFunctions;
  productionManager: ProductionManager;
  dbManager: DbManager;
  whipAuthKey?: string;
  smb?: ISmbProtocol;
}

export const apiWhip: FastifyPluginCallback<ApiWhipOptions> = (
  fastify,
  opts,
  next
) => {
  const productionManager = opts.productionManager;

  fastify.addContentTypeParser(
    'application/sdp',
    { parseAs: 'string' },
    (req, body, done) => {
      done(null, body);
    }
  );

  fastify.addContentTypeParser(
    'application/trickle-ice-sdpfrag',
    { parseAs: 'string' },
    (req, body, done) => {
      done(null, body);
    }
  );

  const smbServerUrl = new URL(
    '/conferences/',
    opts.smbServerBaseUrl
  ).toString();

  const smb = opts.smb || new SmbProtocol();
  const smbServerApiKey = opts.smbServerApiKey || '';
  const coreFunctions = opts.coreFunctions;
  const whipAuthKey = opts.whipAuthKey?.trim();

  async function requireWhipAuth(request: any, reply: any): Promise<boolean> {
    if (!whipAuthKey) {
      return true; // auth disabled
    }

    const authHeader =
      request.headers['authorization'] || request.headers['Authorization'];
    const prefix = 'Bearer ';

    const token = authHeader?.startsWith?.(prefix)
      ? authHeader.slice(prefix.length).trim()
      : '';
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(whipAuthKey);
    const isValid =
      tokenBuf.length === keyBuf.length && timingSafeEqual(tokenBuf, keyBuf);

    if (!authHeader || typeof authHeader !== 'string' || !isValid) {
      reply
        .header('WWW-Authenticate', 'Bearer realm="whip", charset="UTF-8"')
        .code(401)
        .send({ error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  fastify.post<{
    Params: { productionId: string; lineId: string; username: string };
    Body: Static<typeof WhipWhepRequest>;
    Reply: Static<typeof WhipWhepResponse> | { error: string };
  }>(
    '/whip/:productionId/:lineId/:username',
    {
      schema: {
        description: 'WHIP endpoint for ingesting WebRTC streams',
        params: Type.Object({
          productionId: Type.String({ maxLength: 200 }),
          lineId: Type.String({ maxLength: 200 }),
          username: Type.String({ maxLength: 200 })
        }),
        body: WhipWhepRequest,
        response: {
          201: WhipWhepResponse,
          400: Type.Object({ error: Type.String() }),
          406: Type.Object({ error: Type.String() }),
          415: Type.Object({ error: Type.String() }),
          429: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          hook: 'onRequest',
          errorResponseBuilder: (_req, context) => {
            return {
              statusCode: 429,
              error: 'Too Many Requests',
              message: 'Too many requests, please try again later',
              expiresIn: context.after
            };
          }
        }
      }
    },
    async (request, reply) => {
      if (!(await requireWhipAuth(request, reply))) return;
      try {
        const { productionId, lineId, username } = request.params;

        Log().info(
          `Received WHIP request - username: ${username}, production: ${productionId}, line: ${lineId}, IP: ${request.ip}`
        );

        if (request.headers['content-type'] !== 'application/sdp') {
          return reply.code(415).send({ error: 'Unsupported Media Type' });
        }

        const sdpOffer = parse(request.body);

        const offerHasVideo = sdpOffer.media.some((m) => m.type === 'video');

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

        // Allocate endpoint with audio (and video, when the offer includes a
        // video m= section). SMB requires video to be allocated before a
        // configure call can send a video block
        const endpoint = await coreFunctions.createEndpoint(
          smb,
          smbServerUrl,
          smbServerApiKey,
          smbConferenceId,
          endpointId,
          true, // audio
          offerHasVideo, // video
          false, // no data channel needed for WHIP
          true, // iceControlling
          'ssrc-rewrite', // audio relay type
          parseInt(opts.endpointIdleTimeout, 10),
          // Video relay type. 'ssrc-rewrite', matching every other endpoint in
          // the system. This path originally used 'forwarder' on the grounds
          // that keeping the publisher's original SSRCs is what makes a
          // receiver's ssrc-whitelist meaningful — but that rationale was
          // measured on the WHEP *egress* side, where a consumer cannot tell
          // senders apart, and it does not carry over to a publisher, which
          // does not consume video. Pinning a WHIP publisher works under
          // ssrc-rewrite, so original SSRCs are not required for the
          // whitelist. Being the sole non-ssrc-rewrite endpoint also made WHIP
          // publishers the only ones untested by every other code path, and
          // SMB's automatic keyframe request on a source switch lives in its
          // rewrite send job — so a forwarder-relayed publisher may never be
          // asked for one, leaving a receiver to wait for the publisher's next
          // natural IDR.
          'ssrc-rewrite'
        );

        await coreFunctions.configureEndpointForWhipWhep(
          sdpOffer,
          endpoint,
          smb,
          smbServerUrl,
          smbServerApiKey,
          smbConferenceId,
          endpointId
        );

        if (offerHasVideo) {
          const videoMedia = sdpOffer.media.find((m) => m.type === 'video');
          const fidGroup = videoMedia?.ssrcGroups?.find(
            (g) => g.semantics === 'FID'
          );
          // Store BOTH main and RTX SSRCs from the FID group. Receivers
          // pinned to this publisher use these to build their
          // ssrc-whitelist; without the RTX SSRC, SMB drops retransmission
          // packets and any network jitter freezes the receiver's video.
          const ssrcs: number[] = [];
          if (fidGroup) {
            for (const part of fidGroup.ssrcs.split(' ')) {
              const n = parseInt(part, 10);
              if (Number.isFinite(n)) ssrcs.push(n);
            }
          } else {
            const fallback = Number(videoMedia?.ssrcs?.[0]?.id);
            if (Number.isFinite(fallback)) ssrcs.push(fallback);
          }
          if (ssrcs.length > 0) {
            if (!endpoint.video) endpoint.video = {};
            endpoint.video.ssrcs = ssrcs;
          }
        }

        const sdpAnswer = await coreFunctions.createWhipWhepAnswer(
          sdpOffer,
          endpoint
        );

        // Check if any m= sections from the offer were rejected
        try {
          const offerParsed = sdpOffer;
          const answerParsed = sdpTransform.parse(sdpAnswer);

          const offerMids = offerParsed.media.map((m) => m.mid).filter(Boolean);
          const answerMids = answerParsed.media
            .map((m) => m.mid)
            .filter(Boolean);

          const missingMids = offerMids.filter(
            (mid) => !answerMids.includes(mid)
          );

          if (missingMids.length > 0) {
            return reply.code(406).send({
              error: `One or more m= sections could not be negotiated: ${missingMids.join(
                ', '
              )}`
            });
          }
        } catch (err) {
          Log().error('Malformed SDP:', err);
          return reply.code(400).send({ error: 'Malformed SDP' });
        }

        // Create user session in production manager (await to guarantee DB state)
        Log().debug(
          `Creating WHIP user session - username: ${username}, sessionId: ${sessionId}, production: ${productionId}, line: ${lineId}`
        );
        // Defer hasVideo:true until after the endpoint (with video.ssrcs) is
        // persisted. Setting hasVideo first makes this session match the
        // WHEP auto-pin query `{hasVideo:true}` while video.ssrcs is not yet
        // in the DB — receivers joining in that window resolve a pin to this
        // publisher but get an empty whitelist and fall back to default
        // rotation, intermittently losing video.
        await productionManager.createUserSession(
          smbConferenceId,
          productionId,
          lineId,
          sessionId,
          username,
          true, // isWhip
          false, // isWhepReceiver
          false // hasVideo flipped below once video.ssrcs is persisted
        );

        // Update user endpoint info and store a stable smbPresenceKey.
        // The endpoint object now carries the publisher's video SSRCs
        // (stamped from the offer above) so WHEP recipients pinned to
        // this publisher can resolve them for the ssrc-whitelist.
        await productionManager.updateUserEndpoint(
          sessionId,
          endpointId,
          endpoint
        );

        // Now that video.ssrcs is persisted, flip hasVideo so receivers'
        // auto-pin lookup finds this publisher with a usable whitelist.
        if (offerHasVideo) {
          await productionManager.updateSessionHasVideo(sessionId, true);
        }

        // Create the Location URL for the WHIP resource
        // Location URL can be relative to Request URL, so this is OK.
        const locationUrl = `/api/v1/whip/${productionId}/${lineId}/${sessionId}`;

        // Set response headers
        reply.headers({
          'Content-Type': 'application/sdp',
          Location: locationUrl,
          ETag: sessionId,
          Link: getIceServers().join(',')
        });

        reply.code(201).send(sdpAnswer);
      } catch (err) {
        Log().error(err);
        reply.code(500).send({ error: 'Failed to process WHIP request' });
      }
    }
  );

  fastify.delete<{
    Params: { productionId: string; lineId: string; sessionId: string };
  }>(
    '/whip/:productionId/:lineId/:sessionId',
    {
      schema: {
        description: 'Terminate a WHIP connection',
        params: Type.Object({
          productionId: Type.String({ maxLength: 200 }),
          lineId: Type.String({ maxLength: 200 }),
          sessionId: Type.String({ maxLength: 200 })
        }),
        response: {
          200: Type.String({ description: 'OK' }),
          404: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      if (!(await requireWhipAuth(request, reply))) return;
      const { sessionId } = request.params;
      try {
        Log().info(
          `Received WHIP DELETE request - sessionId: ${sessionId}, IP: ${request.ip}`
        );

        const doc = await opts.dbManager.getSession(sessionId);
        if (!doc) {
          Log().warn(
            `WHIP session not found for deletion - sessionId: ${sessionId}`
          );
          reply.code(404).send({ error: 'WHIP session not found' });
          return;
        }

        // Clear the line's WHEP source pin if this WHIP publisher was
        // the pinned source. Must run BEFORE deleteUserSession so we can
        // still resolve the session's productionId/lineId via the DB.
        await productionManager.clearWhepSourceIfPinned(sessionId);

        await opts.dbManager.deleteUserSession(sessionId);
        productionManager.removeUserSession(sessionId);
        productionManager.emit('users:change');

        Log().info(
          `WHIP session deleted successfully - sessionId: ${sessionId}`
        );
        reply.code(200).send('OK');
      } catch (err) {
        Log().error(
          `Failed to delete WHIP session - sessionId: ${sessionId}:`,
          err
        );
        reply.code(500).send({ error: 'Failed to terminate WHIP connection' });
      }
    }
  );

  fastify.patch<{
    Params: { productionId: string; lineId: string; sessionId: string };
    Body: string;
  }>('/whip/:productionId/:lineId/:sessionId', {}, async (request, reply) => {
    reply.code(405).send('Method not allowed');
  });

  fastify.options<{
    Params: { productionId: string; lineId: string };
  }>(
    '/whip/:productionId/:lineId',
    {
      schema: {
        description: 'CORS preflight and WHIP discovery endpoint',
        response: {
          200: Type.String({ description: 'OK' })
        }
      }
    },
    async (request, reply) => {
      try {
        const { productionId, lineId } = request.params;

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

        const line = production.lines.find((l: Line) => l.id === lineId);
        if (!line) {
          reply.code(404).send({ error: 'Line not found' });
          return;
        }

        reply.headers({
          'Accept-Post': 'application/sdp'
        });

        reply.code(200).send('OK');
      } catch (err) {
        Log().error(err);
        reply.code(500).send({ error: 'Failed to process OPTIONS request' });
      }
    }
  );

  next();
};

export default apiWhip;
