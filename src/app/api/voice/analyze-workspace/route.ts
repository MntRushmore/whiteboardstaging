import { z } from "zod";
import { voiceLogger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { enforceCredits, runCharged } from "@/lib/server/billing";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { TEXT_MODELS, openrouterChat } from "@/lib/server/openrouter";
import { errorResponse, focusSchema, imageDataUrlSchema, parseJsonBody } from "@/lib/server/request";

const bodySchema = z.object({
  image: imageDataUrlSchema,
  focus: focusSchema.nullish(),
});

const SYSTEM_PROMPT =
  "You are analyzing a student whiteboard canvas. Describe what the user is working on, " +
  "how far along they are, any apparent mistakes or gaps, and where they might need help. " +
  "Be concrete and concise. You are only returning analysis for a voice assistant; " +
  "do not invent actions or drawings.";

/**
 * Uses a fast vision model (via OpenRouter) to analyze the current whiteboard
 * image and return a natural language description / analysis of the workspace.
 */
export async function POST(req: Request) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const log = voiceLogger.child({ requestId, userId: user.id, task: "analyze-workspace" });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "analyzeWorkspace" });
  if (!rl.ok) {
    log.warn({ retryAfterMs: rl.retryAfterMs, backend: rl.backend }, "Workspace analysis rate limited");
    return rateLimitedResponse(rl.retryAfterMs, rl.backend);
  }

  const parsed = await parseJsonBody(req, bodySchema);
  if ("response" in parsed) {
    log.warn("Invalid analyze-workspace request");
    return parsed.response;
  }
  const { image, focus } = parsed.data;

  // Charge credits before the provider call; runCharged refunds them on any non-2xx (see src/lib/server/billing.ts).
  const billing = await enforceCredits({ token, route: "voice/analyze-workspace", requestId, model: TEXT_MODELS.fast }, log);
  if ("response" in billing) return billing.response;

  log.info({ imageSize: image.length, hasFocus: !!focus }, "Workspace analysis request started");

  return runCharged({ token, requestId }, log, async () => {
    const userPrompt = focus
      ? `Here is a snapshot of the user canvas. Focus on: ${focus}`
      : "Here is a snapshot of the user canvas. Describe what they are working on and how you could help.";

    log.info({ model: TEXT_MODELS.fast }, "Calling OpenRouter for workspace analysis");

    const data = await openrouterChat(
      {
        model: TEXT_MODELS.fast,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: image } },
              { type: "text", text: userPrompt },
            ],
          },
        ],
      },
      { requestId, signal: req.signal, title: "Agathon Classroom Staging - Voice Workspace Analysis" },
    );

    const message = data.choices?.[0]?.message;
    const analysis = message?.content ?? message?.text ?? "";

    const duration = Date.now() - startTime;
    log.info(
      {
        duration,
        textLength: typeof analysis === "string" ? analysis.length : 0,
        tokensUsed: data.usage?.total_tokens,
      },
      "Workspace analysis completed successfully",
    );

    return Response.json({ success: true, analysis });
  }, (error) => errorResponse(error, log, { duration: Date.now() - startTime }));
}
