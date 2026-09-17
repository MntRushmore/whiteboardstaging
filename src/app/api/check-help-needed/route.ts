import { z } from "zod";
import { helpCheckLogger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { enforceCredits } from "@/lib/server/billing";
import { LIMITS, checkRateLimit, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";
import { TEXT_MODELS, openrouterChat } from "@/lib/server/openrouter";
import { errorResponse, imageDataUrlSchema, parseJsonBody, textSchema } from "@/lib/server/request";

const bodySchema = z
  .object({
    text: textSchema.nullish(),
    image: imageDataUrlSchema.nullish(),
  })
  .refine((b) => Boolean(b.text?.trim()) || Boolean(b.image), {
    message: "Provide at least one of `text` or `image`.",
    path: ["body"],
  });

const RESPONSE_FORMAT_INSTRUCTIONS =
  'Respond with a JSON object containing:\n- "needsHelp": true or false\n- "confidence": a number between 0 and 1 indicating your confidence\n- "reason": a brief explanation of your decision\n\nExample: {"needsHelp": true, "confidence": 0.85, "reason": "User has written an incomplete math problem with no solution"}';

export async function POST(req: Request) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const log = helpCheckLogger.child({ requestId, userId: user.id });

  const rl = checkRateLimit(rateLimitKey(user.id, "checkHelp"), LIMITS.checkHelp);
  if (!rl.ok) {
    log.warn({ retryAfterMs: rl.retryAfterMs }, "Help check rate limited");
    return rateLimitedResponse(rl.retryAfterMs);
  }

  const parsed = await parseJsonBody(req, bodySchema);
  if ("response" in parsed) {
    log.warn("Invalid help check request");
    return parsed.response;
  }
  const { text, image } = parsed.data;

  // Charge credits before the provider call (see src/lib/server/billing.ts).
  const billing = await enforceCredits({ token, route: "check-help-needed", requestId, model: TEXT_MODELS.helpCheck }, log);
  if ("response" in billing) return billing.response;

  log.info({ hasText: !!text, textLength: text?.length || 0, hasImage: !!image }, "Help check request started");

  try {
    // Build the message content
    const content: Array<Record<string, unknown>> = [];

    if (image) {
      content.push({ type: "image_url", image_url: { url: image } });
    }

    const promptText = text
      ? `Here is the extracted text from the user's canvas:\n\n${text}\n\nBased on this text and/or the image, does this user appear to need help with a problem? Look for incomplete work, questions, stuck points, math problems, coding problems, or any indication that they're working through something challenging and might benefit from a solution or hint.\n\n${RESPONSE_FORMAT_INSTRUCTIONS}`
      : `Based on the image, does this user appear to need help with a problem? Look for incomplete work, questions, stuck points, math problems, coding problems, or any indication that they're working through something challenging and might benefit from a solution or hint.\n\n${RESPONSE_FORMAT_INSTRUCTIONS}`;

    content.push({ type: "text", text: promptText });

    log.info({ model: TEXT_MODELS.helpCheck }, "Calling OpenRouter for help check");

    const data = await openrouterChat(
      {
        model: TEXT_MODELS.helpCheck,
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
      },
      { requestId, signal: req.signal },
    );

    const rawContent = data.choices?.[0]?.message?.content;
    const responseText = typeof rawContent === "string" && rawContent ? rawContent : "{}";

    let decision: { needsHelp?: unknown; confidence?: unknown; reason?: unknown } = {};
    try {
      decision = JSON.parse(responseText);
    } catch {
      log.warn({ responseText: responseText.slice(0, 500) }, "Help check model returned non-JSON");
    }

    const needsHelp = decision.needsHelp === true;
    const confidence = typeof decision.confidence === "number" ? decision.confidence : 0;
    const reason = typeof decision.reason === "string" ? decision.reason : "";

    const duration = Date.now() - startTime;
    log.info({ duration, needsHelp, confidence, reason, tokensUsed: data.usage?.total_tokens }, "Help check completed");

    return Response.json({ success: true, needsHelp, confidence, reason });
  } catch (error) {
    return errorResponse(error, log, { duration: Date.now() - startTime });
  }
}
