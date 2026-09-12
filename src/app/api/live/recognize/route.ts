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
import { errorResponse } from "@/lib/server/request";
import { isMathpixConfigured, recognizeStrokes } from "@/lib/server/mathpix";
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

export async function POST(req: Request) {
  const ctx = await livePreamble(req, "recognize", "liveRecognize", RecognizeRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, log, data, startedAt } = ctx;

  const payload: StrokePayload = { x: data.strokes.x, y: data.strokes.y, w: data.bounds.w, h: data.bounds.h };

  try {
    let result: RecognizeResponse | null = null;

    if (isMathpixConfigured()) {
      const mp = await recognizeStrokes(payload, req.signal, { requestId });
      if (mp) {
        result = {
          latex: mp.latex,
          text: mp.text,
          kind: classifyKind(mp.latex),
          confidence: mp.confidence,
          provider: "mathpix",
          ms: Date.now() - startedAt,
        };
      } else {
        log.warn("mathpix returned nothing; trying vision fallback");
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
      log.warn({ ms: Date.now() - startedAt, hadCrop: Boolean(data.crop) }, "recognizer failed");
      return withRequestId(
        json(502, "recognizer_failed", "Couldn't read this line right now.", { provider: null }),
        requestId,
      );
    }

    const body = RecognizeResponseSchema.parse(result);
    log.info({ provider: body.provider, ms: body.ms, confidence: body.confidence, kind: body.kind }, "recognized");
    return withRequestId(Response.json(body), requestId);
  } catch (err) {
    return withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt }), requestId);
  }
}
