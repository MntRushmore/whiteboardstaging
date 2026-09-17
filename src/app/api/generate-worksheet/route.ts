import { z } from "zod";
import { solutionLogger } from "@/lib/logger";
import { json, requireUser } from "@/lib/server/auth";
import { enforceCredits, runCharged } from "@/lib/server/billing";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { IMAGE_MODELS, extractImageUrl, openrouterChat } from "@/lib/server/openrouter";
import { errorResponse, modelSchema, parseJsonBody, topicSchema } from "@/lib/server/request";

const bodySchema = z.object({
  topic: topicSchema,
  model: modelSchema.default("gemini"),
});

export async function POST(req: Request) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const log = solutionLogger.child({ requestId, userId: user.id, task: "worksheet" });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "generateWorksheet" });
  if (!rl.ok) {
    log.warn({ retryAfterMs: rl.retryAfterMs, backend: rl.backend }, "Worksheet generation rate limited");
    return rateLimitedResponse(rl.retryAfterMs, rl.backend);
  }

  const parsed = await parseJsonBody(req, bodySchema);
  if ("response" in parsed) {
    log.warn("Invalid worksheet generation request");
    return parsed.response;
  }
  const { topic, model } = parsed.data;

  // Charge credits before the provider call; runCharged refunds them on any non-2xx (see src/lib/server/billing.ts).
  const billing = await enforceCredits({ token, route: "generate-worksheet", requestId, model: IMAGE_MODELS[model] }, log);
  if ("response" in billing) return billing.response;

  log.info({ topicLength: topic.length, model }, "Worksheet generation request started");

  return runCharged({ token, requestId }, log, async () => {
    const selectedModel = IMAGE_MODELS[model];

    const prompt = [
      "Generate a clean, printable worksheet image for a student.",
      `Topic: ${topic}`,
      "",
      "Requirements:",
      "- Pure white background.",
      "- Clear printed-text title at the top of the page.",
      "- A name/date row underneath the title.",
      "- Numbered problems or activities laid out neatly with generous spacing.",
      "- Leave blank space under each problem so the student can write the answer by hand.",
      "- Use only black ink for problems and instructions; do not pre-fill any answers.",
      "- No decorative cartoons, mascots, or watermarks.",
      "- Image dimensions roughly 8.5 x 11 (portrait), legible at typical screen sizes.",
      '- Do not include the words "AI generated" anywhere.',
    ].join("\n");

    log.info({ selectedModel }, "Calling OpenRouter for worksheet generation");

    const data = await openrouterChat(
      {
        model: selectedModel,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        modalities: ["image", "text"],
        reasoning_effort: "minimal",
      },
      { requestId, signal: req.signal, title: "Agathon Classroom Staging - Worksheet Generator" },
    );

    const message = data.choices?.[0]?.message;
    const imageUrl = extractImageUrl(message);
    const duration = Date.now() - startTime;

    if (!imageUrl) {
      log.warn({ duration, raw: JSON.stringify(data).slice(0, 1200) }, "Worksheet generation produced no image");
      return json(502, "upstream_error", "The model did not return a worksheet. Try rephrasing your topic.", {
        success: false,
        reason: "no_image",
      });
    }

    log.info({ duration, tokensUsed: data.usage?.total_tokens }, "Worksheet generated successfully");

    return Response.json({ success: true, imageUrl });
  }, (error) => errorResponse(error, log, { duration: Date.now() - startTime }));
}
