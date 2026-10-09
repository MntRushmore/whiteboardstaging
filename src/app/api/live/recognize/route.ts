import {
  CapabilitiesResponseSchema,
  LIVE_KILL_SWITCH,
  LIVE_TIMING,
  RecognizeRequestSchema,
  RecognizeResponseSchema,
  type CapabilitiesResponse,
  type RecognizeResponse,
  type StrokePayload,
} from "@/lib/live/contracts";
import { getLiveModels } from "@/lib/env";
import { json, requireUser } from "@/lib/server/auth";
import { enforceInk, runCharged } from "@/lib/server/billing";
import { errorResponse, recordRouteEvent } from "@/lib/server/request";
import { isMathpixConfigured, recognizeStrokes, type MathpixFailure } from "@/lib/server/mathpix";
import { recognizeFailureHints } from "@/lib/server/recognizeHints";
import { chatJson, UpstreamError } from "@/lib/server/openrouter";
import { buildVisionMessages, VisionTranscriptionSchema } from "@/lib/server/prompts/recognizeVision";
import { liveDebugEnabled, liveLogger, livePreamble, withRequestId } from "@/lib/server/live-route";
import { classifyKind } from "@/lib/server/live-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The vision reader's deadline, counted from the start of the request. The client gives a read
 * `LIVE_TIMING.recognizeTimeoutMs` (6 s) and then aborts without a word, which the server sees as a
 * client that went away: no event, and the student's "Reading took too long" had no server row.
 * Timing out a second before it makes a slow vision read an UpstreamError(504) instead, which
 * `errorResponse` records (`route.live.recognize`, code `timeout`) and the client answers with its
 * one blip retry. At least `VISION_MIN_MS`, so a slow Mathpix miss still leaves vision a chance.
 */
const VISION_DEADLINE_MS = LIVE_TIMING.recognizeTimeoutMs - 1_000;
const VISION_MIN_MS = 1_500;
/**
 * A read the client abandoned this late is almost always its own 6 s timeout — the student's
 * "Reading took too long" — rather than newer ink on the line superseding it (that comes within
 * the quiet gate's moments). Its client report has no request id (the client never got a
 * response), so the route says it saw it: an info event `client_timeout`.
 */
const CLIENT_GAVE_UP_MS = LIVE_TIMING.recognizeTimeoutMs - 2_000;

/* ------------------------------------------------------------------------- */
/* GET: capabilities + warmup                                                 */
/* ------------------------------------------------------------------------- */

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return withRequestId(auth.response, requestId);

  try {
    const models = getLiveModels();
    const body: CapabilitiesResponse = CapabilitiesResponseSchema.parse({
      recognizer: isMathpixConfigured() ? "mathpix" : "vision",
      liveEnabled: !LIVE_KILL_SWITCH,
      models: { check: models.check, solve: models.solve, vision: models.vision },
    });
    return withRequestId(Response.json(body, { headers: { "Cache-Control": "no-store" } }), requestId);
  } catch (err) {
    return withRequestId(errorResponse(err, liveLogger.child({ requestId, route: "recognize.GET" })), requestId);
  }
}

/* ------------------------------------------------------------------------- */
/* POST: strokes -> latex                                                     */
/* ------------------------------------------------------------------------- */

export async function POST(req: Request) {
  const ctx = await livePreamble(req, "recognize", "liveRecognize", RecognizeRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, user, log, data, startedAt } = ctx;

  // Charge ink before any recognizer call; runCharged refunds them on any non-2xx
  // (recognizer_failed, upstream error, timeout). GET is free. See src/lib/server/billing.ts.
  const billing = await enforceInk(
    { token, route: "live/recognize", requestId, model: isMathpixConfigured() ? "mathpix" : getLiveModels().vision },
    log,
  );
  if ("response" in billing) return withRequestId(billing.response, requestId);

  const payload: StrokePayload = { x: data.strokes.x, y: data.strokes.y, w: data.bounds.w, h: data.bounds.h };
  /** what the read had done when the client left (for `clientGone`) */
  let stage: "mathpix" | "vision" = "mathpix";
  const clientGone = () => {
    const ms = Date.now() - startedAt;
    if (ms < CLIENT_GAVE_UP_MS) return;
    recordRouteEvent(log, {
      level: "info",
      code: "client_timeout",
      message: `The client stopped waiting after ${Math.round(ms / 100) / 10} s (${stage})`,
      meta: { ms, stage, hadCrop: Boolean(data.crop), cropOnly: Boolean(data.cropOnly) },
    });
  };

  return runCharged({ userId: user.id, requestId }, log, async () => {
    let result: RecognizeResponse | null = null;
    /** set when Mathpix ran and produced nothing; drives the vision-fallback hints below */
    let mathpixFailure: MathpixFailure | null = null;

    // The crop retry (`cropOnly`): Mathpix already read nothing from these very strokes.
    const skipStrokes = Boolean(data.cropOnly && data.crop);
    if (isMathpixConfigured() && !skipStrokes) {
      const mp = await recognizeStrokes(payload, req.signal, { requestId, log });
      if (mp.ok) {
        result = {
          latex: mp.latex,
          text: mp.text,
          kind: classifyKind(mp.latex),
          confidence: mp.confidence,
          provider: "mathpix",
          ms: Date.now() - startedAt,
          ...(liveDebugEnabled() ? { debug: { mathpix: mp.raw } } : {}),
        };
      } else {
        mathpixFailure = mp;
        log.warn({ reason: mp.reason, status: mp.status, hadCrop: Boolean(data.crop) }, "mathpix returned nothing; trying vision fallback");
      }
    }

    if (!result && data.crop) {
      stage = "vision";
      const models = getLiveModels();
      const visionMs = Math.max(VISION_MIN_MS, VISION_DEADLINE_MS - (Date.now() - startedAt));
      const deadline = AbortSignal.timeout(visionMs);
      let vision;
      try {
        vision = await chatJson({
          model: models.vision,
          messages: buildVisionMessages(data.crop, data.hint),
          schema: VisionTranscriptionSchema,
          signal: AbortSignal.any([req.signal, deadline]),
          requestId,
          maxTokens: 400,
          title: "Agathon Live - recognize",
        });
      } catch (err) {
        // our own deadline is the provider being slow (a 504 the client retries), not the client leaving
        if (deadline.aborted && !req.signal.aborted) throw new UpstreamError(504, `${models.vision} did not read the crop within ${visionMs} ms`);
        throw err;
      }
      const latex = vision.latex.replace(/^\$+|\$+$/g, "").trim();
      result = {
        latex,
        text: vision.text || latex,
        kind: classifyKind(latex, vision.isMath),
        confidence: vision.confidence,
        provider: "vision",
        ms: Date.now() - startedAt,
        ...(liveDebugEnabled() ? { debug: { vision, mathpixFailure } } : {}),
      };
    }

    if (!result) {
      const hints = recognizeFailureHints(Boolean(data.crop), mathpixFailure);
      const ms = Date.now() - startedAt;
      log.warn(
        {
          ms,
          hadCrop: Boolean(data.crop),
          mathpix: mathpixFailure ? { reason: mathpixFailure.reason, status: mathpixFailure.status } : null,
          ...hints,
        },
        "recognizer failed",
      );
      // Not a thrown error, so `errorResponse` never saw it: before, this 502 left no server row,
      // and the student's error card (when no crop could be sent) had nothing to join. Mathpix
      // answering that it could not read the ink is `unreadable` (info: a scribble, not an
      // outage); anything else is the recognizer failing (warn: the client retries with a crop,
      // and Mathpix's own failure is already a `mathpix` event). Nothing when the client left.
      if (req.signal.aborted) clientGone();
      else {
        const reason = mathpixFailure?.reason ?? (isMathpixConfigured() ? "none" : "unconfigured");
        recordRouteEvent(log, {
          level: hints.unreadable ? "info" : "warn",
          code: hints.unreadable ? "unreadable" : "recognizer_failed",
          message: hints.unreadable ? "Mathpix could not read the ink" : `The stroke recognizer read nothing (${reason})`,
          meta: {
            status: 502,
            ms,
            reason,
            ...(mathpixFailure?.status ? { mathpixStatus: mathpixFailure.status } : {}),
            ...(mathpixFailure?.detail ? { detail: mathpixFailure.detail.slice(0, 120) } : {}),
            hadCrop: Boolean(data.crop),
            ...hints,
          },
        });
      }
      // Status and `error` are unchanged; the hints (recognizeHints.ts) are additive: they let the
      // client reach the vision fallback, and tell an unreadable line from a recognizer outage.
      return withRequestId(
        json(502, "recognizer_failed", "Couldn't read this line right now.", { provider: null, ...hints }),
        requestId,
      );
    }

    const body = RecognizeResponseSchema.parse(result);
    log.info({ provider: body.provider, ms: body.ms, confidence: body.confidence, kind: body.kind }, "recognized");
    return withRequestId(Response.json(body), requestId);
  }, (err) => {
    if (req.signal.aborted) clientGone();
    return withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt }), requestId);
  });
}
