import {
  CapabilitiesResponseSchema,
  LIVE_KILL_SWITCH,
  RecognizeRequestSchema,
  RecognizeResponseSchema,
  type CapabilitiesResponse,
  type RecognizeResponse,
  type StrokePayload,
} from "@/lib/live/contracts";
import { getLiveModels } from "@/lib/env";
import { json, requireUser } from "@/lib/server/auth";
import { enforceCredits, runCharged } from "@/lib/server/billing";
import { errorResponse } from "@/lib/server/request";
import { isMathpixAuthFailure, isMathpixConfigured, recognizeStrokes, type MathpixFailure } from "@/lib/server/mathpix";
import { chatJson } from "@/lib/server/openrouter";
import { buildVisionMessages, VisionTranscriptionSchema } from "@/lib/server/prompts/recognizeVision";
import { liveLogger, livePreamble, withRequestId } from "@/lib/server/live-route";
import { classifyKind } from "@/lib/server/live-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

/**
 * Additive fields on the existing `recognizer_failed` 502 body (the response schema in
 * src/lib/live/contracts.ts is frozen and describes success only). Both are hints, never
 * requirements: an old client that ignores them behaves exactly as before.
 *
 *  - `needsCrop`      we had no crop to fall back on; send one and this line can still be
 *                     read by the vision recognizer. The client retries the line once.
 *  - `recognizerDown` Mathpix rejected our credentials, so every line will fail the same
 *                     way: the client flips to the vision recognizer for the rest of the
 *                     session instead of paying a failed round-trip per line.
 */
export type RecognizeFailureHints = { needsCrop?: true; recognizerDown?: true };

export function recognizeFailureHints(
  hadCrop: boolean,
  mathpixFailure: MathpixFailure | null,
): RecognizeFailureHints {
  return {
    ...(hadCrop ? {} : { needsCrop: true as const }),
    ...(mathpixFailure && isMathpixAuthFailure(mathpixFailure) ? { recognizerDown: true as const } : {}),
  };
}

export async function POST(req: Request) {
  const ctx = await livePreamble(req, "recognize", "liveRecognize", RecognizeRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, log, data, startedAt } = ctx;

  // Charge credits before any recognizer call; runCharged refunds them on any non-2xx
  // (recognizer_failed, upstream error, timeout). GET is free. See src/lib/server/billing.ts.
  const billing = await enforceCredits(
    { token, route: "live/recognize", requestId, model: isMathpixConfigured() ? "mathpix" : getLiveModels().vision },
    log,
  );
  if ("response" in billing) return withRequestId(billing.response, requestId);

  const payload: StrokePayload = { x: data.strokes.x, y: data.strokes.y, w: data.bounds.w, h: data.bounds.h };

  return runCharged({ token, requestId }, log, async () => {
    let result: RecognizeResponse | null = null;
    /** set when Mathpix ran and produced nothing; drives the vision-fallback hints below */
    let mathpixFailure: MathpixFailure | null = null;

    if (isMathpixConfigured()) {
      const mp = await recognizeStrokes(payload, req.signal, { requestId, log });
      if (mp.ok) {
        result = {
          latex: mp.latex,
          text: mp.text,
          kind: classifyKind(mp.latex),
          confidence: mp.confidence,
          provider: "mathpix",
          ms: Date.now() - startedAt,
        };
      } else {
        mathpixFailure = mp;
        log.warn({ reason: mp.reason, status: mp.status, hadCrop: Boolean(data.crop) }, "mathpix returned nothing; trying vision fallback");
      }
    }

    if (!result && data.crop) {
      const models = getLiveModels();
      const vision = await chatJson({
        model: models.vision,
        messages: buildVisionMessages(data.crop, data.hint),
        schema: VisionTranscriptionSchema,
        signal: req.signal,
        requestId,
        maxTokens: 400,
        title: "Agathon Live - recognize",
      });
      const latex = vision.latex.replace(/^\$+|\$+$/g, "").trim();
      result = {
        latex,
        text: vision.text || latex,
        kind: classifyKind(latex, vision.isMath),
        confidence: vision.confidence,
        provider: "vision",
        ms: Date.now() - startedAt,
      };
    }

    if (!result) {
      const hints = recognizeFailureHints(Boolean(data.crop), mathpixFailure);
      log.warn(
        {
          ms: Date.now() - startedAt,
          hadCrop: Boolean(data.crop),
          mathpix: mathpixFailure ? { reason: mathpixFailure.reason, status: mathpixFailure.status } : null,
          ...hints,
        },
        "recognizer failed",
      );
      // Status and `error` are unchanged; `needsCrop` / `recognizerDown` are additive hints
      // that let the client reach the vision fallback instead of giving the student nothing.
      return withRequestId(
        json(502, "recognizer_failed", "Couldn't read this line right now.", { provider: null, ...hints }),
        requestId,
      );
    }

    const body = RecognizeResponseSchema.parse(result);
    log.info({ provider: body.provider, ms: body.ms, confidence: body.confidence, kind: body.kind }, "recognized");
    return withRequestId(Response.json(body), requestId);
  }, (err) => withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt }), requestId));
}
