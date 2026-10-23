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
import { getCropReader, getLiveModels, getSecondOpinion } from "@/lib/env";
import { json, requireUser } from "@/lib/server/auth";
import { enforceInk, runCharged } from "@/lib/server/billing";
import { errorResponse, recordRouteEvent } from "@/lib/server/request";
import { isMathpixConfigured, MATHPIX_TEXT_TIMEOUT_MS, recognizeImage, recognizeStrokes, type MathpixFailure } from "@/lib/server/mathpix";
import { RECOGNIZER_FAILED_STATUS, recognizeFailureHints } from "@/lib/server/recognizeHints";
import { chatJson, UpstreamError } from "@/lib/server/openrouter";
import { buildVisionMessages, VisionTranscriptionSchema } from "@/lib/server/prompts/recognizeVision";
import { liveDebugEnabled, liveLogger, livePreamble, withRequestId } from "@/lib/server/live-route";
import { classifyKind } from "@/lib/server/live-rules";
import { sameRead } from "@/lib/live/sameRead";

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
/** Less time than this left for Mathpix v3/text (after the vision reader's own minimum): straight to vision. */
const TEXT_MIN_MS = 500;
/**
 * The second opinion's own deadline. It runs beside the strokes read (≈0.45 s; v3/text ≈0.2 s), so
 * it seldom adds anything; a slow one holds a good strokes read back at most this long.
 */
const SECOND_OPINION_MS = 1_500;

/**
 * The strokes read failed in a way that says Mathpix itself (or the way to it) is in trouble, not
 * the ink: its image reader shares the credentials and the servers, so it is not asked either.
 */
function mathpixInTrouble(f: MathpixFailure | null): boolean {
  return f !== null && (f.reason === "auth" || f.reason === "http" || f.reason === "timeout" || f.reason === "network");
}

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
    { token, route: "live/recognize", requestId, model: isMathpixConfigured() ? "mathpix" : getLiveModels().vision, satQuestionId: ctx.satQuestionId, training: ctx.training },
    log,
  );
  if ("response" in billing) return withRequestId(billing.response, requestId);

  const payload: StrokePayload = { x: data.strokes.x, y: data.strokes.y, w: data.bounds.w, h: data.bounds.h };
  /** what the read had done when the client left (for `clientGone`) */
  let stage: "mathpix" | "mathpix-text" | "vision" = "mathpix";
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

  return runCharged({ userId: user.id, requestId, training: ctx.training }, log, async () => {
    let result: RecognizeResponse | null = null;
    /** set when Mathpix ran and produced nothing; drives the vision-fallback hints below */
    let mathpixFailure: MathpixFailure | null = null;

    // The crop retry (`cropOnly`): Mathpix already read nothing from these very strokes.
    const skipStrokes = Boolean(data.cropOnly && data.crop);

    // The second opinion (RECOGNIZE_SECOND_OPINION=mathpix-text, off by default; docs/PROBLEM-PAGES.md):
    // when the board asks, Mathpix v3/text reads the line's crop beside the strokes read. Whether
    // the two agree is the board's best reason to ask the kid "Is this right?" (docs/eval/mpx-supernet.md);
    // the second read never becomes the line's reading.
    const secondRead =
      data.secondOpinion && data.crop && !skipStrokes && getSecondOpinion() === "mathpix-text" && isMathpixConfigured()
        ? recognizeImage(data.crop, req.signal, { requestId, log, timeoutMs: SECOND_OPINION_MS }).catch(() => null)
        : null;

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
        const second = secondRead ? await secondRead : null;
        if (second?.ok && second.latex) {
          result.second = { latex: second.latex, confidence: Math.min(1, Math.max(0, second.confidence)) };
          result.agree = sameRead(mp.latex, second.latex);
        }
      } else {
        mathpixFailure = mp;
        log.warn({ reason: mp.reason, status: mp.status, hadCrop: Boolean(data.crop) }, "mathpix returned nothing; trying vision fallback");
      }
    }

    // RECOGNIZE_CROP_READER=mathpix-text (a prototype, off by default; docs/eval/mpx-supernet.md):
    // Mathpix v3/text reads the crop first — 6x faster than the vision model, and on the eval's
    // stacked sums and long divisions it gave the LaTeX the board's parsers take. Never when Mathpix
    // is the trouble (the vision model is the other vendor), and any miss of its own goes on to
    // vision as before: the vision read stays the floor. A `cropOnly` retry does not say why the
    // strokes read failed, so after a Mathpix timeout this can spend its 2 s before vision (≥ 3 s left).
    let cropText: { reason: string; status?: number } | null = null;
    if (!result && data.crop && getCropReader() === "mathpix-text" && isMathpixConfigured() && !mathpixInTrouble(mathpixFailure)) {
      const textMs = Math.min(MATHPIX_TEXT_TIMEOUT_MS, VISION_DEADLINE_MS - (Date.now() - startedAt) - VISION_MIN_MS);
      if (textMs >= TEXT_MIN_MS) {
        stage = "mathpix-text";
        // the second opinion already asked v3/text about this crop: its answer, not a second call
        const mt = (secondRead ? await secondRead : null) ?? (await recognizeImage(data.crop, req.signal, { requestId, log, timeoutMs: textMs }));
        if (mt.ok && mt.latex) {
          result = {
            latex: mt.latex,
            text: mt.text,
            kind: classifyKind(mt.latex),
            confidence: mt.confidence,
            // a Mathpix read: the board's second reader looks at it as at a strokes read
            provider: "mathpix",
            ms: Date.now() - startedAt,
            ...(liveDebugEnabled() ? { debug: { mathpixText: mt.raw, mathpixFailure } } : {}),
          };
        } else {
          cropText = mt.ok ? { reason: "empty" } : { reason: mt.reason, status: mt.status };
          if (req.signal.aborted) throw new DOMException("The client went away", "AbortError");
          log.warn({ reason: cropText.reason, status: cropText.status }, "mathpix v3/text read nothing from the crop; trying vision");
        }
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
        ...(liveDebugEnabled() ? { debug: { vision, mathpixFailure, ...(cropText ? { mathpixText: cropText } : {}) } } : {}),
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
      // Not a thrown error, so `errorResponse` never saw it: before, this answer left no server row,
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
            status: RECOGNIZER_FAILED_STATUS,
            ms,
            reason,
            ...(mathpixFailure?.status ? { mathpixStatus: mathpixFailure.status } : {}),
            ...(mathpixFailure?.detail ? { detail: mathpixFailure.detail.slice(0, 120) } : {}),
            hadCrop: Boolean(data.crop),
            ...hints,
          },
        });
      }
      // `error` is unchanged and the hints (recognizeHints.ts) are additive: they let the client reach
      // the vision fallback, and tell an unreadable line from a recognizer outage. A 503, not the 502
      // it was: Cloudflare, in front of the site, swapped the 502 for its own page, hints and all
      // (`RECOGNIZER_FAILED_STATUS`).
      return withRequestId(
        json(RECOGNIZER_FAILED_STATUS, "recognizer_failed", "Couldn't read this line right now.", { provider: null, ...hints }),
        requestId,
      );
    }

    const body = RecognizeResponseSchema.parse(result);
    log.info(
      {
        provider: body.provider,
        ms: body.ms,
        confidence: body.confidence,
        kind: body.kind,
        ...(stage === "mathpix-text" ? { cropReader: "mathpix-text" } : {}),
        ...(body.agree !== undefined ? { agree: body.agree } : {}),
      },
      "recognized",
    );
    return withRequestId(Response.json(body), requestId);
  }, (err) => {
    if (req.signal.aborted) clientGone();
    // whether it was the crop retry, on the route's own row: the board's report of it may carry no id to join
    return withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt, hadCrop: Boolean(data.crop), cropOnly: Boolean(data.cropOnly) }), requestId);
  });
}
