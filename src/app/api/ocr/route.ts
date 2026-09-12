import { z } from "zod";
import { ocrLogger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { LIMITS, checkRateLimit, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";
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
  const { user } = auth;

  const log = ocrLogger.child({ requestId, userId: user.id });

  const rl = checkRateLimit(rateLimitKey(user.id, "ocr"), LIMITS.ocr);
  if (!rl.ok) {
    log.warn({ retryAfterMs: rl.retryAfterMs }, "OCR rate limited");
    return rateLimitedResponse(rl.retryAfterMs);
  }

  const parsed = await parseJsonBody(req, bodySchema);
  if ("response" in parsed) {
    log.warn("Invalid OCR request");
    return parsed.response;
  }
  const { image } = parsed.data;

  log.info({ imageSize: image.length, model: TEXT_MODELS.fast }, "OCR request started");

  try {
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
  } catch (error) {
    return errorResponse(error, log, { duration: Date.now() - startTime });
  }
}
