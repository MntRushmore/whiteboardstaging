import { z } from "zod";
import { ocrLogger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { enforceCredits, runCharged } from "@/lib/server/billing";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { TEXT_MODELS, openrouterChat } from "@/lib/server/openrouter";
import { errorResponse, imageDataUrlSchema, parseJsonBody } from "@/lib/server/request";

const bodySchema = z.object({
  image: imageDataUrlSchema,
});

const OCR_PROMPT =
  "Extract all handwritten and typed text from this image. Return only the extracted text, preserving the structure and layout as much as possible. If there are mathematical equations, preserve them in a readable format.";

/**
 * OCR via a fast vision model on OpenRouter.
 * (Mistral retired pixtral-12b-2409, which this route used to call directly.)
 */
export async function POST(req: Request) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const log = ocrLogger.child({ requestId, userId: user.id });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "ocr" });
  if (!rl.ok) {
    log.warn({ retryAfterMs: rl.retryAfterMs, backend: rl.backend }, "OCR rate limited");
    return rateLimitedResponse(rl.retryAfterMs, rl.backend);
  }

  const parsed = await parseJsonBody(req, bodySchema);
  if ("response" in parsed) {
    log.warn("Invalid OCR request");
    return parsed.response;
  }
  const { image } = parsed.data;

  // Charge credits before the provider call; runCharged refunds them on any non-2xx (see src/lib/server/billing.ts).
  const billing = await enforceCredits({ token, route: "ocr", requestId, model: TEXT_MODELS.fast }, log);
  if ("response" in billing) return billing.response;

  log.info({ imageSize: image.length, model: TEXT_MODELS.fast }, "OCR request started");

  return runCharged({ token, requestId }, log, async () => {
    const data = await openrouterChat(
      {
        model: TEXT_MODELS.fast,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: image } },
              { type: "text", text: OCR_PROMPT },
            ],
          },
        ],
        max_tokens: 1000,
      },
      { requestId, signal: req.signal, title: "Agathon Classroom Staging - OCR" },
    );

    const rawContent = data.choices?.[0]?.message?.content;
    const extractedText = typeof rawContent === "string" ? rawContent : "";

    const duration = Date.now() - startTime;
    log.info({ duration, textLength: extractedText.length, tokensUsed: data.usage?.total_tokens }, "OCR completed successfully");

    return Response.json({ success: true, text: extractedText });
  }, (error) => errorResponse(error, log, { duration: Date.now() - startTime }));
}
