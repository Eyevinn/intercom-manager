import {
  MediaDescription,
  SessionDescription,
  parse,
  write
} from 'sdp-transform';
import { v4 as uuidv4 } from 'uuid';
import { Connection } from './connection';
import { ConnectionQueue } from './connection_queue';
import {
  Fmtp,
  MediaStreamsInfoSsrc,
  RtcpFb,
  RtpCodec,
  RtpHeaderExt
} from './media_streams_info';
import { Log } from './log';
import { LineResponse, Production, SmbEndpointDescription } from './models';
import { ProductionManager } from './production_manager';
import {
  NORMALIZED_VIDEO_PT_MAIN,
  NORMALIZED_VIDEO_PT_RTX
} from './sfu/constants';
import { ISmbProtocol } from './smb';

/**
 * Video codecs this pipeline fully supports, in preference order. Only H264
 * and VP8 have the codec normalization, profile-level-id pinning and FID/RTX
 * handling that the rest of the pipeline assumes.
 */
const SUPPORTED_VIDEO_CODECS = ['H264', 'VP8'];

/**
 * The video codec names SMB advertised for this endpoint (RTX excluded).
 *
 * This is the authority on what the bridge can actually carry: SMB reports it
 * from its own configuration, so a bridge left on the compiled default
 * advertises VP8 only. Returns [] when the allocation carried no video
 * `payload-types`, in which case callers must not narrow the negotiation.
 */
export function smbAdvertisedVideoCodecs(
  endpoint: SmbEndpointDescription
): string[] {
  return (endpoint.video?.['payload-types'] ?? [])
    .map((pt) => pt.name?.toUpperCase())
    .filter((name): name is string => !!name && name !== 'RTX');
}

/**
 * Pick the video codec to negotiate: the most preferred codec that BOTH the
 * client offered AND SMB advertised.
 *
 * Selecting purely from the offer is a silent trap. Every browser, OBS and
 * whip-mpegts offers H264, so an offer-only preference answers H264 even to a
 * VP8-only bridge. The publisher then encodes H264 that SMB cannot forward,
 * and every receiver gets working audio with permanently black video — no
 * error on any code path, because each side is individually self-consistent.
 *
 * When SMB advertised nothing (`smbCodecs` empty) the pipeline preference
 * order is used unchanged; there is no capability information to narrow by.
 */
export function selectVideoCodec(
  offered: RtpCodec[],
  smbCodecs: string[]
): RtpCodec | undefined {
  const allowed =
    smbCodecs.length > 0
      ? SUPPORTED_VIDEO_CODECS.filter((codec) => smbCodecs.includes(codec))
      : SUPPORTED_VIDEO_CODECS;

  for (const name of allowed) {
    const match = offered.find(
      (rtp: RtpCodec) => rtp.codec.toUpperCase() === name
    );
    if (match) return match;
  }
  return undefined;
}

export class CoreFunctions {
  private productionManager: ProductionManager;
  private connectionQueue: ConnectionQueue;

  constructor(
    productionManager: ProductionManager,
    connectionQueue: ConnectionQueue
  ) {
    this.productionManager = productionManager;
    this.connectionQueue = connectionQueue;
  }

  async createConnection(
    smbConferenceId: string,
    productionId: string,
    lineId: string,
    endpoint: SmbEndpointDescription,
    username: string,
    endpointId: string,
    sessionId: string,
    videoEnabled = false
  ): Promise<string> {
    if (!endpoint.audio) {
      throw new Error('Missing audio when creating offer');
    }

    const ssrcs: MediaStreamsInfoSsrc[] = [];
    endpoint.audio.ssrcs.forEach((ssrcsNr) => {
      ssrcs.push({
        ssrc: ssrcsNr.toString(),
        cname: uuidv4(),
        mslabel: uuidv4(),
        label: uuidv4()
      });
    });

    const videoSsrcs: MediaStreamsInfoSsrc[] =
      videoEnabled && endpoint.video?.ssrcs?.length
        ? endpoint.video.ssrcs.map((ssrcNr) => ({
            ssrc: ssrcNr.toString(),
            cname: uuidv4(),
            mslabel: uuidv4(),
            label: uuidv4()
          }))
        : [];

    const endpointMediaStreamInfo = {
      audio: {
        ssrcs: ssrcs
      },
      ...(videoEnabled && endpoint.video && { video: { ssrcs: videoSsrcs } })
    };

    const connection = new Connection(
      username,
      endpointMediaStreamInfo,
      endpoint as any, // Type assertion to bypass type error temporarily
      endpointId
    );

    const offer: SessionDescription = connection.createOffer();
    const sdpOffer: string = write(offer);

    if (sdpOffer) {
      await this.productionManager.createUserSession(
        smbConferenceId,
        productionId,
        lineId,
        sessionId,
        username,
        false
      );
      await this.productionManager.updateUserEndpoint(
        sessionId,
        endpointId,
        endpoint
      );
    }
    return sdpOffer;
  }

  async createEndpoint(
    smb: ISmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string,
    lineId: string,
    endpointId: string,
    audio: boolean,
    video: boolean,
    data: boolean,
    iceControlling: boolean,
    relayType: 'ssrc-rewrite' | 'forwarder' | 'mixed',
    endpointIdleTimeout: number,
    videoRelayType?: 'ssrc-rewrite' | 'forwarder' | 'mixed'
  ): Promise<SmbEndpointDescription> {
    const endpoint: SmbEndpointDescription = await smb.allocateEndpoint(
      smbServerUrl,
      lineId,
      endpointId,
      audio,
      video,
      data,
      iceControlling,
      relayType,
      endpointIdleTimeout,
      smbServerApiKey,
      videoRelayType
    );

    // Normalize video payload type numbers to stable values so the SDP offer,
    // browser answer, and SMB configure body all agree. Both H264 and VP8
    // normalize to PT 96/97 — they are mutually exclusive. Using PT 96 matches
    // whip-mpegts's native H264 PT so forwarder-mode receivers see a consistent PT.
    // Also corrects SMB's RTX apt which may point to the wrong PT.
    const pts = endpoint.video?.['payload-types'];
    if (pts) {
      const h264 = pts.find((pt) => pt.name.toUpperCase() === 'H264');
      const vp8 = pts.find((pt) => pt.name.toUpperCase() === 'VP8');
      const preferred = h264 ?? vp8;
      if (preferred) {
        const mainPt = NORMALIZED_VIDEO_PT_MAIN;
        const rtxPt = NORMALIZED_VIDEO_PT_RTX;
        preferred.id = mainPt;
        const rtx = pts.find((pt) => pt.name.toLowerCase() === 'rtx');
        if (rtx) {
          rtx.id = rtxPt;
          if (rtx.parameters?.['apt'] !== undefined)
            rtx.parameters['apt'] = String(mainPt);
        }
      }
      // Force H264 profile-level-id to Constrained Baseline (42e01f). SMB
      // reports pure Baseline (42001f) which Safari's WebRTC stack rejects,
      // collapsing the video m-line to port 0 in the answer. CBP is the only
      // H264 profile WebRTC mandates (RFC 7742) and is universally decodable.
      if (h264?.parameters) {
        h264.parameters['profile-level-id'] = '42e01f';
      }
    }

    return endpoint;
  }

  async configureEndpointForWhipWhep(
    sdpOffer: SessionDescription,
    endpointDescription: SmbEndpointDescription,
    smb: ISmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string,
    smbConferenceId: string,
    endpointId: string,
    receiveOnly = false,
    /**
     * When set on a receive-only (WHEP) endpoint, declare to SMB that this
     * endpoint subscribes to the named publisher's video stream — limiting
     * forwarding to that one source instead of the SFU-default forward-all.
     *
     * Ignored when `receiveOnly` is false.
     */
    subscribeToVideo?: {
      streams: any[];
      ssrcs: number[];
      endpointId: string;
    }
  ): Promise<void> {
    const offer: SessionDescription = JSON.parse(JSON.stringify(sdpOffer));
    const endpoint: SmbEndpointDescription = JSON.parse(
      JSON.stringify(endpointDescription)
    );

    const transport = endpoint['bundle-transport'];

    if (!transport) {
      throw new Error('Missing bundle-transport in endpointDescription');
    }
    if (!transport.dtls) {
      throw new Error('Missing dtls in endpointDescription');
    }
    if (!transport.ice) {
      throw new Error('Missing ice in endpointDescription');
    }

    // The bundle-transport (ICE/DTLS) is carried on whichever m-line has
    // fingerprint/iceUfrag — usually audio, but a port-0 audio reject or
    // a data-first ordering can shift it. Original code used
    // `{...find(...)}` which spreads to `{}` (always truthy) so the
    // short-circuit incorrectly fell through to offer.media[0] (data
    // m-line) and emptied transport. Find by attribute presence instead.
    const transportMedia =
      (offer.media.find((m) => m.fingerprint || m.iceUfrag) as
        | MediaDescription
        | undefined) ?? (offer.media[0] as MediaDescription | undefined);

    transport.ice.ufrag = offer.iceUfrag ?? transportMedia?.iceUfrag ?? '';
    transport.ice.pwd = offer.icePwd ?? transportMedia?.icePwd ?? '';
    transport.dtls.hash =
      offer.fingerprint?.hash ?? transportMedia?.fingerprint?.hash ?? '';
    transport.dtls.type =
      offer.fingerprint?.type ?? transportMedia?.fingerprint?.type ?? '';
    transport.dtls.setup = offer.setup ?? transportMedia?.setup ?? '';

    if (!transport.dtls.hash || !transport.dtls.type) {
      throw new Error(
        `Missing DTLS fingerprint in offer (would result in null cipher). ` +
          `offer.fingerprint=${JSON.stringify(offer.fingerprint)}, ` +
          `mediaFingerprints=${JSON.stringify(
            offer.media.map((m) => m.fingerprint)
          )}`
      );
    }

    if (!transport.ice.candidates || transport.ice.candidates.length === 0) {
      throw new Error('ICE candidates missing in transport');
    }

    transport.ice.candidates = !transportMedia?.candidates
      ? []
      : transportMedia.candidates.flatMap((element) => {
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

    const videoStreams: any[] = [];
    const streamsMap = new Map();

    for (const media of offer.media) {
      if (media.type === 'audio') {
        endpoint.audio.ssrcs = [];
        media.ssrcs
          ?.filter((ssrc) => ssrc.attribute === 'msid')
          .forEach((ssrc) => endpoint.audio.ssrcs.push(parseInt(`${ssrc.id}`)));
        if (!media.rtp?.[0]) {
          throw new Error(
            'Audio m-line in offer has no rtp payload entries — rejected ' +
              'or malformed audio m-line cannot be configured.'
          );
        }
        endpoint.audio['payload-type'].id = media.rtp[0].payload;
        endpoint.audio['rtp-hdrexts'] = [];
        media.ext?.forEach((ext: RtpHeaderExt) =>
          endpoint.audio['rtp-hdrexts'].push({
            id: ext.value,
            uri: ext.uri
          })
        );
      } else if (media.type === 'video') {
        media.ssrcs
          ?.filter((ssrc) => ssrc.attribute === 'msid' && ssrc.value)
          .forEach((ssrc) => {
            const mediaStreamId = ssrc.value?.split(' ')[0];
            let smbVideoStream = streamsMap.get(mediaStreamId);
            if (!smbVideoStream) {
              smbVideoStream = {
                sources: [],
                id: receiveOnly ? mediaStreamId : endpointId,
                content: 'video'
              };
              streamsMap.set(mediaStreamId, smbVideoStream);
            }

            const feedbackGroup = media.ssrcGroups
              ?.filter((element) => element.semantics === 'FID')
              .filter((element) => element.ssrcs.indexOf(`${ssrc.id}`) !== -1)
              .pop();

            if (feedbackGroup) {
              const ssrcsSplit = feedbackGroup.ssrcs.split(' ');
              if (`${ssrc.id}` === ssrcsSplit[0]) {
                const main = parseInt(ssrcsSplit[0]);
                // Skip feedback when the FID group has only one SSRC —
                // otherwise parseInt(undefined) ships feedback: NaN to SMB.
                smbVideoStream.sources = [
                  ssrcsSplit.length >= 2
                    ? { main, feedback: parseInt(ssrcsSplit[1]) }
                    : { main }
                ];
              }
            } else {
              smbVideoStream.sources = [
                {
                  main: parseInt(`${ssrc.id}`)
                }
              ];
            }
          });

        // Only collect sender SSRCs into videoStreams for WHIP endpoints.
        // WHEP offers may include a=ssrc: lines (Chrome UA hints for receive
        // tracks) that must not be treated as sender streams.
        if (!receiveOnly) {
          // Fallback for publishers whose offer has no `a=ssrc:N msid:...`
          // lines (common with hardware/native WHIP encoders, some OBS
          // configurations). Without the msid loop populating streamsMap,
          // SMB never gets a `streams` declaration and receivers' SDPs
          // end up with no usable msid — so the frontend can't match the
          // tile to a participant. Synthesize one stream entry tagged with
          // the publisher's endpointId, gathering all video ssrcs from the
          // offer (deduped, primary SSRCs of FID groups preferred).
          if (streamsMap.size === 0) {
            const allVideoSsrcs = (media.ssrcs ?? []).map((s) =>
              parseInt(`${s.id}`, 10)
            );
            const dedupedSsrcs = Array.from(new Set(allVideoSsrcs));
            // If FID groups are present, take the first ssrc of each as
            // main and the second as feedback. Otherwise treat each ssrc
            // as a primary with no feedback pair.
            const fidGroups = (media.ssrcGroups ?? []).filter(
              (g) => g.semantics === 'FID'
            );
            const sources =
              fidGroups.length > 0
                ? fidGroups.map((g) => {
                    const [mainStr, feedbackStr] = g.ssrcs.split(' ');
                    return {
                      main: parseInt(mainStr, 10),
                      ...(feedbackStr
                        ? { feedback: parseInt(feedbackStr, 10) }
                        : {})
                    };
                  })
                : dedupedSsrcs.map((id) => ({ main: id }));
            if (sources.length > 0) {
              streamsMap.set(endpointId, {
                sources,
                id: endpointId,
                content: 'video'
              });
            }
          }
          streamsMap.forEach((value) => videoStreams.push(value));
        }
        // Only H264 and VP8 are fully supported through the pipeline (codec
        // normalization, profile-level-id pinning, FID/RTX handling). VP9
        // used to be in this list but the downstream code never grew
        // VP9-specific paths, so it would silently fall through
        // misconfigured.
        const supportedCodecs = ['VP8', 'H264'];
        const matchingCodecs =
          media.rtp?.filter((rtp: RtpCodec) =>
            supportedCodecs.includes(rtp.codec.toUpperCase())
          ) || [];

        if (matchingCodecs.length > 0) {
          media.rtp = matchingCodecs;
        }

        const seenPayloads = new Set<number>();
        media.rtp = media.rtp.filter((rtp: RtpCodec) => {
          if (seenPayloads.has(rtp.payload)) return false;
          seenPayloads.add(rtp.payload);
          return true;
        });

        media.fmtp =
          media.fmtp?.filter((fmtp: Fmtp) =>
            media.rtp.some((rtp: RtpCodec) => rtp.payload === fmtp.payload)
          ) ?? [];

        media.rtcpFb =
          media.rtcpFb?.filter((fb: RtcpFb) =>
            media.rtp.some((rtp: RtpCodec) => rtp.payload === fb.payload)
          ) ?? [];

        media.payloads = media.rtp
          .map((rtp: RtpCodec) => rtp.payload)
          .join(' ');

        media.ext =
          media.ext?.filter(
            (ext: RtpHeaderExt) =>
              ext.uri ===
                'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time' ||
              ext.uri === 'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id'
          ) ?? [];

        media.ssrcGroups = undefined;

        endpoint.video = endpoint.video || {};

        // Negotiate a codec BOTH the client offered and SMB advertised.
        // Preferring H264 straight off the offer (what this used to do) hands
        // an H264 answer to any H264-capable publisher even when the bridge
        // only speaks VP8 — SMB then cannot forward what the publisher sends
        // and every receiver gets audio with permanently black video. Reject
        // explicitly when there is no overlap rather than letting an
        // unsupported codec proceed misconfigured.
        const smbCodecs = smbAdvertisedVideoCodecs(endpoint);
        const selectedCodec = selectVideoCodec(media.rtp, smbCodecs);

        if (!selectedCodec) {
          throw new Error(
            `No video codec in common between the offer and SMB. ` +
              `Offered: ${
                media.rtp.map((r) => r.codec).join(', ') || '(none)'
              }. ` +
              `SMB advertises: ${smbCodecs.join(', ') || '(none)'}.`
          );
        }

        // Log both sides of the negotiation. A codec mismatch across the
        // bridge is otherwise invisible: the pin, whitelist and keyframe paths
        // all succeed and only the video is missing.
        Log().info(
          `[video-codec] endpoint=${endpointId} ` +
            `selected=${selectedCodec.codec}@${selectedCodec.payload} ` +
            `offered=[${media.rtp.map((r) => r.codec).join(', ')}] ` +
            `smb=[${smbCodecs.join(', ') || 'unadvertised'}]`
        );

        if (typeof selectedCodec.rate !== 'number') {
          throw new Error('Selected video codec is missing a valid clockrate');
        }

        // Always use the offer's actual PT for both WHIP publishers and WHEP
        // receivers. whip-mpegts natively offers H264@PT96 so it is unaffected;
        // browser WHIP clients offer H264@PT103 and must configure at PT103 so
        // SMB knows which PT to forward. WHEP receivers keep their native PT.
        const normalizedId = selectedCodec.payload;

        const payload = {
          id: normalizedId,
          name: selectedCodec.codec,
          clockrate: selectedCodec.rate,
          parameters: {},
          'rtcp-fbs': [] as { type: string; subtype?: string }[]
        };

        const fmtp = media.fmtp.find(
          (f) => f.payload === selectedCodec.payload
        );
        if (fmtp?.config) {
          payload.parameters = Object.fromEntries(
            fmtp.config.split(';').map((kv) => {
              const [key, val] = kv.trim().split('=');
              return [key, val ?? ''];
            })
          );
        }

        const rtcpFbs = media.rtcpFb?.filter(
          (f: RtcpFb) => f.payload === selectedCodec.payload
        );
        if (rtcpFbs?.length) {
          payload['rtcp-fbs'] = rtcpFbs.map((fb: RtcpFb) => ({
            type: fb.type,
            subtype: fb.subtype ?? undefined
          }));
        }

        endpoint.video['payload-type'] = payload;
        endpoint.video['rtp-hdrexts'] = media.ext.map((ext: RtpHeaderExt) => ({
          id: ext.value,
          uri: ext.uri
        }));

        // Sync payload-types (plural, from allocation, normalized to PT 96) to
        // match the actual offer PT so both fields in the configure body agree.
        // Applies to all endpoints — WHIP publishers and WHEP receivers alike.
        // whip-mpegts already uses PT 96, so no-op for that path.
        const payloadTypesArr = endpoint.video['payload-types'];
        if (payloadTypesArr && payloadTypesArr.length > 0) {
          const mainEntry = payloadTypesArr.find(
            (pt) => pt.name.toLowerCase() !== 'rtx'
          );
          if (mainEntry) {
            mainEntry.id = normalizedId;
          }
          const rtxEntry = payloadTypesArr.find(
            (pt) => pt.name.toLowerCase() === 'rtx'
          );
          if (rtxEntry?.parameters?.apt !== undefined) {
            rtxEntry.parameters.apt = String(normalizedId);
          }
        }

        if (!receiveOnly && videoStreams.length > 0) {
          // WHIP/camera sender: declare the SSRCs being transmitted and the
          // stream so SMB knows what to forward to other endpoints.
          endpoint.video.ssrcs =
            media.ssrcs?.map((ssrc) => Number(ssrc.id)) ?? [];
          endpoint.video.streams = videoStreams;

          // Block all video EGRESS to this publisher. An empty-but-present
          // ssrc-whitelist is the one setting SMB reads as "forward nothing" —
          // deleting the key instead means last-N, i.e. forward everything.
          //
          // A WHIP publisher such as whip-mpegts negotiates recvonly on SMB's
          // side and builds no video receive path, so any video SMB forwards
          // here arrives at a webrtcbin transport with nothing linked
          // downstream. That is a fatal GST_FLOW_NOT_LINKED: the whole
          // pipeline errors out and the publisher's own outbound video
          // freezes. Triggered by any video sender in the conference — one
          // already present when the publisher connects, or one joining later.
          //
          // Ingress is unaffected: the endpoint is still allocated with video
          // and still declares its own ssrcs/streams above, so SMB keeps
          // receiving this publisher's video and relaying it to subscribers.
          // Egress and ingress are independent here.
          endpoint.video['ssrc-whitelist'] = [];
        } else if (receiveOnly && subscribeToVideo) {
          // Keep the pre-allocated receive SSRCs from the allocation (they
          // define this endpoint's ssrc-rewrite receive pool).
          delete endpoint.video.streams;
          const whitelist = subscribeToVideo.ssrcs.slice(0, 2);
          if (whitelist.length > 0) {
            endpoint.video['ssrc-whitelist'] = whitelist;
          }
        } else {
          // Receive-only WHEP endpoint (ssrc-rewrite mode): keep the pre-
          // allocated receive SSRCs from the allocation — SMB needs them to
          // set up the ssrc-rewrite forwarding path for this subscriber.
          // Only delete 'streams' (this endpoint does not publish video).
          // Old forwarder mode deleted both, but ssrc-rewrite requires the
          // receive pool to be declared so SMB maps publisher SSRCs to it.
          delete endpoint.video.streams;
        }
      }
    }

    endpoint.data = undefined; //this is important! do not remove.

    await smb.configureEndpoint(
      smbServerUrl,
      smbConferenceId,
      endpointId,
      endpoint,
      smbServerApiKey
    );
  }

  async createWhipWhepAnswer(
    offer: SessionDescription,
    endpoint: SmbEndpointDescription
  ): Promise<string> {
    if (!endpoint) {
      throw new Error('Missing endpointDescription when handling sdp offer');
    }
    if (!endpoint.audio) {
      throw new Error(
        'Missing endpointDescription audio when handling sdp offer'
      );
    }
    if (!endpoint.audio.ssrcs || endpoint.audio.ssrcs.length === 0) {
      throw new Error('Missing audio ssrcs in SMB endpoint description');
    }

    if (offer.origin) {
      offer.origin.sessionVersion++;
    }

    if (!offer.msidSemantic) {
      offer.msidSemantic = { semantic: 'WMS', token: '' };
    } else {
      offer.msidSemantic.token = '*';
    }

    const transport = endpoint['bundle-transport'];
    if (!transport)
      throw new Error('Missing bundle-transport in endpointDescription');
    if (!transport.dtls) throw new Error('Missing dtls in endpointDescription');
    if (!transport.ice) throw new Error('Missing ice in endpointDescription');

    let bundleGroupMids = '';
    let candidatesAdded = false;

    for (const media of offer.media) {
      bundleGroupMids =
        bundleGroupMids === ''
          ? `${media.mid}`
          : `${bundleGroupMids} ${media.mid}`;

      (media as any).iceOptions = undefined;
      media.iceUfrag = transport.ice.ufrag;
      media.icePwd = transport.ice.pwd;
      media.fingerprint = {
        type: transport.dtls.type,
        hash: transport.dtls.hash
      };
      media.setup = media.setup === 'actpass' ? 'active' : 'actpass';
      media.ssrcGroups = undefined;
      media.ssrcs = undefined;
      media.msid = undefined;
      media.candidates = undefined;
      media.port = 9;
      media.rtcp = {
        port: 9,
        netType: 'IN',
        ipVer: 4,
        address: '0.0.0.0'
      };
      media.rtcpMux = 'rtcp-mux';

      if (!candidatesAdded) {
        media.candidates = transport.ice!.candidates.map((candidate: any) => ({
          foundation: candidate.foundation,
          component: candidate.component,
          transport: candidate.protocol,
          priority: candidate.priority,
          ip: candidate.ip,
          port: candidate.port,
          type: candidate.type,
          raddr: candidate['rel-addr'],
          rport: candidate['rel-port'],
          generation: candidate.generation,
          'network-id': candidate.network
        }));
        candidatesAdded = true;
      }

      if (media.type === 'audio') {
        media.rtp = media.rtp.filter(
          (rtp: RtpCodec) => rtp.codec.toLowerCase() === 'opus'
        );
        const opusPayloadType = media.rtp.at(0)?.payload;
        if (!opusPayloadType) throw new Error('Missing opus payload type');

        media.fmtp = media.fmtp.filter(
          (fmtp: Fmtp) => fmtp.payload === opusPayloadType
        );
        media.payloads = `${opusPayloadType}`;

        media.ext = media.ext?.filter(
          (ext: RtpHeaderExt) =>
            ext.uri === 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' ||
            ext.uri ===
              'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
        );

        media.direction =
          media.direction === 'recvonly' ? 'sendonly' : 'recvonly';
        media.rtcpFb = undefined;

        const defaultAudioExts = [
          { id: 1, uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' },
          {
            id: 2,
            uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
          }
        ];

        const hasRtpExts =
          Array.isArray(media.ext) &&
          media.ext.some(
            (ext) =>
              ext.uri === 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' ||
              ext.uri ===
                'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
          );

        const audioExts = hasRtpExts
          ? media.ext!.map((ext: RtpHeaderExt) => ({
              id: ext.value,
              uri: ext.uri
            }))
          : defaultAudioExts;

        media.ext = audioExts.map((ext) => ({ value: ext.id, uri: ext.uri }));
      } else if (media.type === 'video') {
        // Same rule as configureEndpointForWhipWhep: the codec must be one
        // SMB advertised, not merely one the client offered. These two sites
        // must agree — the answer decides what the publisher encodes, the
        // configure decides what SMB expects, and a divergence between them is
        // exactly the silent black-video failure.
        const primaryCodec = selectVideoCodec(
          media.rtp,
          smbAdvertisedVideoCodecs(endpoint)
        );

        if (primaryCodec) {
          const primaryPt = primaryCodec.payload;

          const rtxFmtp = media.fmtp.find(
            (fmtp: Fmtp) => fmtp.config === `apt=${primaryPt}`
          );
          const rtxPt = rtxFmtp?.payload;

          media.rtp = media.rtp.filter(
            (rtp: RtpCodec) =>
              rtp.payload === primaryPt || rtp.payload === rtxPt
          );

          media.fmtp = media.fmtp.filter(
            (fmtp: Fmtp) => fmtp.payload === primaryPt || fmtp.payload === rtxPt
          );

          media.payloads = [primaryPt, rtxPt].filter(Boolean).join(' ');
          media.ext =
            media.ext?.filter(
              (ext: RtpHeaderExt) =>
                ext.uri ===
                  'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time' ||
                ext.uri === 'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id'
            ) ?? [];

          // Keep nack (incl. nack pli for keyframe requests), ccm fir, and
          // goog-remb. PLI is what lets a WHEP consumer ask the publisher for
          // an IDR — without it, a consumer that joins mid-stream or loses
          // the reference frame has nothing decodable until the next
          // keyframe.
          media.rtcpFb = media.rtcpFb?.filter(
            (fb: RtcpFb) =>
              fb.payload === primaryPt &&
              (fb.type === 'goog-remb' ||
                fb.type === 'nack' ||
                (fb.type === 'ccm' && fb.subtype === 'fir'))
          );
          Log().debug(
            `[whipwhep-answer] video rtcp-fb negotiated mid=${
              media.mid
            } pt=${primaryPt} fb=${JSON.stringify(media.rtcpFb)}`
          );

          media.setup = 'active';
          media.direction =
            media.direction === 'recvonly' ? 'sendonly' : 'recvonly';
          media.ssrcGroups = undefined;
          // Do not declare a specific a=ssrc: in the WHEP answer. SMB sends
          // two SSRCs (main video + RTX); declaring ssrcs[0] risks picking the
          // RTX SSRC, which causes Chrome to bind the video track to the repair
          // stream (framesDecoded=0) while the actual video arrives on the
          // undeclared main SSRC. Without a=ssrc: Chrome accepts all SSRCs on
          // this m-line and fires ontrack when real video frames arrive.
          media.ssrcs = [];
        } else {
          Log().warn(
            'No H264 or VP8 codec found in offer video media. Skipping video codec filtering.'
          );
          media.setup = 'active';
          media.direction =
            media.direction === 'recvonly' ? 'sendonly' : 'recvonly';
        }
      }
    }

    offer.groups = [
      {
        type: 'BUNDLE',
        mids: bundleGroupMids
      }
    ];

    const sdpAnswer = write(offer);

    const offerMediaDescription = offer.media[0];
    if (!offerMediaDescription) {
      throw new Error('Missing audio media description in offer');
    }

    return sdpAnswer;
  }

  async handleAnswerRequest(
    smb: ISmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string,
    lineId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    answer: string,
    // Optional pin: when provided, the browser endpoint's video receive
    // is gated to packets whose inbound SSRC is in the whitelist.
    // Without it, SMB rotates senders through the single video m-line
    subscribeToVideo?: { ssrcs: number[]; endpointId: string }
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
    if (!answerMediaDescription) {
      throw new Error(
        'Missing audio media description when handling sdp answer from endpoint'
      );
    }

    const audioMedia = parsedAnswer.media.find((m) => m.type === 'audio');
    if (audioMedia?.ssrcs) {
      let parsedSsrcs = audioMedia.ssrcs[0].id;
      if (typeof parsedSsrcs === 'string') {
        parsedSsrcs = parseInt(parsedSsrcs, 10);
      }
      endpointDescription.audio.ssrcs.push(parsedSsrcs);
    }

    if (endpointDescription.audio.ssrcs.length === 0) {
      throw new Error(
        'Missing audio ssrcs in SDP answer — answer had no a=ssrc on the ' +
          'audio m-line (mic muted or track removed before negotiation).'
      );
    }

    const videoMedia =
      parsedAnswer.media.find(
        (m) => m.type === 'video' && (m.ssrcs?.length ?? 0) > 0
      ) ?? parsedAnswer.media.find((m) => m.type === 'video');
    if (endpointDescription.video) {
      const video = endpointDescription.video;
      const videoSsrcs: number[] = [];
      video.ssrcs = videoSsrcs;

      if (videoMedia) {
        // Extract sender SSRCs from the answer (empty for recvonly/no-camera clients)
        if (videoMedia.ssrcs?.length) {
          const seen = new Set<number>();
          videoMedia.ssrcs.forEach((ssrc) => {
            const id =
              typeof ssrc.id === 'string' ? parseInt(ssrc.id, 10) : ssrc.id;
            if (!seen.has(id)) {
              seen.add(id);
              videoSsrcs.push(id);
            }
          });
        }

        const videoPayloadInfo = this.extractVideoPayloadInfo(videoMedia);
        if (videoPayloadInfo) {
          endpointDescription.video['payload-type'] =
            videoPayloadInfo.payloadType;
          endpointDescription.video['rtp-hdrexts'] =
            videoPayloadInfo.rtpHdrexts;
        }
      }

      // Replace the allocate's 'streams' (pre-allocated SSRCs) with the actual
      // SSRCs the client is sending. In forwarder mode SMB routes based on the
      // SSRC reported in 'streams', so it must match what the browser sends.
      // For receive-only (no-camera) clients, streams is empty.
      if (videoSsrcs.length > 0) {
        // Camera client: build a stream entry from the FID group (main + RTX)
        const fidGroup = (videoMedia as any)?.ssrcGroups?.find(
          (g: { semantics: string; ssrcs: string }) => g.semantics === 'FID'
        );
        let sources: { main: number; feedback?: number }[];
        if (fidGroup) {
          const parts = fidGroup.ssrcs.split(' ');
          const main = parseInt(parts[0], 10);
          const feedback =
            parts.length >= 2 ? parseInt(parts[1], 10) : undefined;
          sources = [
            feedback !== undefined && Number.isFinite(feedback)
              ? { main, feedback }
              : { main }
          ];
          // Store BOTH main and RTX SSRCs. Receivers pinned to this
          // publisher build their ssrc-whitelist from this list — if
          // RTX is missing, SMB drops retransmission packets and any
          // network jitter freezes the receiver's video.
          endpointDescription.video.ssrcs =
            feedback !== undefined && Number.isFinite(feedback)
              ? [main, feedback]
              : [main];
        } else {
          sources = [{ main: videoSsrcs[0] }];
        }
        const msidEntry = videoMedia?.ssrcs?.find(
          (s) => Number(s.id) === sources[0].main && s.attribute === 'msid'
        );
        const streamId = msidEntry?.value?.split(' ')[0] ?? 'video';
        video.streams = [{ id: streamId, content: 'video', sources }];
      } else {
        // No-camera client: not sending any video
        video.streams = [];
      }
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
    transport.ice.ufrag = this.toStringIfNumber(
      answerMediaDescription.iceUfrag
    );
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

    Log().debug(
      `[handleAnswer-video] ssrcs=${JSON.stringify(
        endpointDescription.video?.ssrcs
      )} streams=${JSON.stringify(endpointDescription.video?.streams)}`
    );

    // Apply ssrc-whitelist so SMB only forwards the pinned publisher's
    // packets into this browser's single inbound video slot. SMB caps
    // the whitelist at 2 SSRCs (main + RTX), so dedupe and slice.
    if (subscribeToVideo && endpointDescription.video) {
      const whitelist = Array.from(new Set(subscribeToVideo.ssrcs))
        .filter((n) => Number.isFinite(n))
        .slice(0, 2);
      if (whitelist.length > 0) {
        endpointDescription.video['ssrc-whitelist'] = whitelist;
        Log().debug(
          `[handleAnswer-pin] browser endpoint=${endpointId} pinned to ` +
            `source endpointId=${subscribeToVideo.endpointId} ` +
            `whitelist=${JSON.stringify(whitelist)}`
        );
      } else {
        Log().warn(
          `[handleAnswer-pin] browser endpoint=${endpointId} pin requested ` +
            `for source endpointId=${subscribeToVideo.endpointId} but ` +
            `the source has no stored ssrcs to whitelist with — falling ` +
            `back to default rotation`
        );
      }
    }

    return await smb.configureEndpoint(
      smbServerUrl,
      lineId,
      endpointId,
      endpointDescription,
      smbServerApiKey
    );
  }

  /**
   * Create conference for a line if it does not exist, and return conference id
   *
   * This method MUST be queued. Multiple simultaneous calls to this method
   * will result in creating different conferences for each request, overwriting
   * previously created conference IDs, if the function call targets the same line.
   */
  private async createConference(
    smb: ISmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string,
    productionId: string,
    lineId: string
  ): Promise<string> {
    const activeLines: string[] = await smb.getConferences(
      smbServerUrl,
      smbServerApiKey
    );

    const production = await this.productionManager.requireProduction(
      parseInt(productionId, 10)
    );

    const line = this.productionManager.requireLine(production.lines, lineId);

    if (activeLines.includes(line.smbConferenceId)) {
      return line.smbConferenceId;
    }

    // SMB's video receive pool size for ssrc-rewrite endpoints. Each
    // endpoint in this conference gets `last-n + 2` simultaneous video
    // slots (capped at 16 server-side). Default 9 → 11 slots, which is
    // generous enough for our typical conferences while leaving SMB's
    // simulcast headroom intact. Env-tunable for ops without a rebuild.
    // Required for the WHEP single-source pin to work — without it,
    // ssrc-rewrite receivers get zero slots and SMB falls back to last-N
    // forwarding (which is what the dynamic-source bug looked like).
    const parsedLastN = parseInt(process.env.SMB_CONFERENCE_LAST_N ?? '9', 10);
    const lastN =
      Number.isFinite(parsedLastN) && parsedLastN >= 1 ? parsedLastN : 9;
    const newConferenceId = await smb.allocateConference(
      smbServerUrl,
      smbServerApiKey,
      lastN
    );

    if (
      !(await this.productionManager.setLineId(
        production._id,
        line.id,
        newConferenceId
      ))
    ) {
      throw new Error(
        `Failed to set line smb id for line ${line.id} in production ${production._id}`
      );
    }

    return newConferenceId;
  }

  async createConferenceForLine(
    smb: ISmbProtocol,
    smbServerUrl: string,
    smbServerApiKey: string,
    productionId: string,
    lineId: string
  ): Promise<string> {
    const createConf = () =>
      this.createConference(
        smb,
        smbServerUrl,
        smbServerApiKey,
        productionId,
        lineId
      );

    return this.connectionQueue.queueAsync(createConf);
  }

  async getAllLinesResponse(production: Production): Promise<LineResponse[]> {
    const stringifiedProdId = production._id.toString();

    const allLinesResponse = await Promise.all(
      production.lines.map(
        async ({
          name,
          id,
          smbConferenceId,
          programOutputLine,
          videoEnabled
        }) => {
          const participants = await this.productionManager.getUsersForLine(
            stringifiedProdId,
            id
          );

          return {
            name,
            id,
            smbConferenceId,
            participants,
            programOutputLine: programOutputLine ?? false,
            videoEnabled: videoEnabled ?? false
          } as LineResponse;
        }
      )
    );

    return allLinesResponse;
  }

  private toStringIfNumber(value: string | number | undefined): string {
    if (typeof value === 'number') {
      return String(value);
    } else if (typeof value === 'string') {
      return value;
    } else {
      throw new Error(`${value} has incorrect type`);
    }
  }

  private extractVideoPayloadInfo(media: MediaDescription): {
    payloadType: {
      id: number;
      name: string;
      clockrate: number;
      parameters: Record<string, string>;
      'rtcp-fbs': { type: string; subtype?: string }[];
    };
    rtpHdrexts: { id: number; uri: string }[];
  } | null {
    // Match the H264-preferred selection used in configureEndpointForWhipWhep.
    // Previously this function included VP9 and picked
    // matchingRtp[0], so a browser answer listing VP8 before H264 would set
    // the receiver's payload-type to VP8's PT while SMB expected H264 — the
    // exact PT mismatch addVideoMid normalization was preventing.
    if (!media.rtp?.length) return null;
    const selectedCodec =
      media.rtp.find((rtp: RtpCodec) => rtp.codec.toUpperCase() === 'H264') ??
      media.rtp.find((rtp: RtpCodec) => rtp.codec.toUpperCase() === 'VP8');
    if (!selectedCodec) return null;
    if (typeof selectedCodec.rate !== 'number') return null;

    const fmtp = media.fmtp?.find(
      (f: Fmtp) => f.payload === selectedCodec.payload
    );
    const parameters: Record<string, string> = fmtp?.config
      ? Object.fromEntries(
          fmtp.config.split(';').map((kv) => {
            const [key, val] = kv.trim().split('=');
            return [key, val ?? ''];
          })
        )
      : {};

    const rtcpFbs = (
      media.rtcpFb?.filter(
        (f: RtcpFb) => f.payload === selectedCodec.payload
      ) ?? []
    ).map((fb: RtcpFb) => ({
      type: fb.type,
      subtype: fb.subtype ?? undefined
    }));

    const allowedExts = [
      'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
      'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id'
    ];
    const rtpHdrexts = (
      media.ext?.filter((ext: RtpHeaderExt) => allowedExts.includes(ext.uri)) ??
      []
    ).map((ext: RtpHeaderExt) => ({ id: ext.value, uri: ext.uri }));

    return {
      payloadType: {
        id: selectedCodec.payload,
        name: selectedCodec.codec,
        clockrate: selectedCodec.rate,
        parameters,
        'rtcp-fbs': rtcpFbs
      },
      rtpHdrexts
    };
  }
}
