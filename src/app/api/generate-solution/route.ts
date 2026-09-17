import { z } from "zod";
import { solutionLogger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { enforceCredits } from "@/lib/server/billing";
import { LIMITS, checkRateLimit, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";
import { IMAGE_MODELS, extractImageUrl, openrouterChat } from "@/lib/server/openrouter";
import {
  errorResponse,
  imageDataUrlSchema,
  modeSchema,
  modelSchema,
  parseJsonBody,
  promptSchema,
  sourceSchema,
} from "@/lib/server/request";

const bodySchema = z.object({
  image: imageDataUrlSchema,
  prompt: promptSchema.nullish(),
  mode: modeSchema.default("suggest"),
  source: sourceSchema.default("auto"),
  model: modelSchema.default("gemini"),
  hasWorksheet: z.boolean().default(false),
});

// Generate mode-specific prompt.
// The `source` controls whether this was triggered automatically ("auto")
// or explicitly by the voice tutor ("voice").
function getModePrompt(mode: string, source: "auto" | "voice" = "auto"): string {
  const effectiveSource = source === "voice" ? "voice" : "auto";

  const baseAnalysis =
    "Analyze the user's writing in the image carefully. Look for incomplete work or any indication that the user is working through something challenging and might benefit from some form of assistance.";

  const noHelpInstruction =
    "\n\nIf the user does NOT seem to need help:\n- Simply respond concisely with text explaining why help isn't needed. Do not generate an image.\n\nBe thoughtful about when to offer help - look for clear signs of incomplete problems or questions.";

  // For voice-triggered generations, we always want an updated image,
  // not a text-only answer.
  const alwaysImageRule =
    effectiveSource === "voice"
      ? "\n- ALWAYS generate an updated image of the canvas; do not respond with text-only."
      : "";

  const coreRules =
    "\n\n**CRITICAL:**\n- DO NOT remove, modify, move, transform, edit, or touch ANY of the image's existing content. Leave EVERYTHING in the image EXACTLY as it is in its current state, and *only* add to it.\n- Try to match the user's exact handwriting style.\n- NEVER update the background color of the image. Keep it white, unless directed otherwise." +
    alwaysImageRule;

  // For automatic generations, allow the model to decide no help is needed
  // and respond with text only. For voice, we omit this escape hatch.
  const noHelpBlock = effectiveSource === "auto" ? noHelpInstruction : "";

  switch (mode) {
    case "feedback":
      return `${baseAnalysis}\n\nIf the user needs help:\n- Provide the least intrusive assistance - think of adding visual annotations\n- Add visual feedback elements: highlighting, underlining, arrows, circles, light margin notes, etc.\n- Try to use colors that stand out but complement the work\n- Write in a natural style that matches the user's handwriting${coreRules}${noHelpBlock}`;

    case "suggest":
      return `${baseAnalysis}\n\nIf the user needs help:\n- Provide a HELPFUL HINT or guide them to the next step - don't give them the end solution.\n- Add suggestions for what to try next, guiding questions, etc.\n- Point out which direction to go without giving the full answer${coreRules}${noHelpBlock}`;

    case "answer":
      return `${baseAnalysis}\n\nIf the user needs help:\n- Provide COMPLETE, DETAILED assistance - fully solve the problem or answer the question\n- Try to make it comprehensive and educational${coreRules}${noHelpBlock}`;

    default:
      return `${baseAnalysis}\n\nIf the user needs help:\n- Provide a helpful hint or guide them to the next step${coreRules}${noHelpBlock}`;
  }
}

export async function POST(req: Request) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const log = solutionLogger.child({ requestId, userId: user.id });

  const rl = checkRateLimit(rateLimitKey(user.id, "generateSolution"), LIMITS.generateSolution);
  if (!rl.ok) {
    log.warn({ retryAfterMs: rl.retryAfterMs }, "Solution generation rate limited");
    return rateLimitedResponse(rl.retryAfterMs);
  }

  const parsed = await parseJsonBody(req, bodySchema);
  if ("response" in parsed) {
    log.warn("Invalid solution generation request");
    return parsed.response;
  }
  const { image, prompt, mode, source, model, hasWorksheet } = parsed.data;

  // Charge credits before the provider call (see src/lib/server/billing.ts).
  const billing = await enforceCredits({ token, route: "generate-solution", requestId, model: IMAGE_MODELS[model] }, log);
  if ("response" in billing) return billing.response;

  log.info({ mode, source, model, hasWorksheet, imageSize: image.length }, "Solution generation request started");

  try {
    const selectedModel = IMAGE_MODELS[model];
    const effectiveSource: "auto" | "voice" = source === "voice" ? "voice" : "auto";
    const basePrompt = getModePrompt(mode, effectiveSource);

    // When the canvas has a printed worksheet attached (uploaded PDF, generated
    // worksheet, or sticker scaffold), the image we send the model has those
    // elements REMOVED — only student strokes are visible. The model must not
    // try to reconstruct the worksheet itself; it should only draw additions.
    const worksheetPreamble = hasWorksheet
      ? "\n\nIMPORTANT WORKSHEET CONTEXT:\n" +
        "- A printed worksheet exists on the user's canvas, but it has been removed from the image you see; you are looking only at the student's handwritten work, in isolation, on a white background.\n" +
        "- DO NOT redraw, recreate, or reference any printed worksheet content — you cannot see it. Only respond to the handwritten work that IS visible.\n" +
        "- Your output image will be composited behind the printed worksheet, so keep your annotations near the student's strokes (do not draw across the whole canvas)."
      : "";

    const finalPrompt = prompt
      ? `${basePrompt}${worksheetPreamble}\n\nAdditional drawing instructions from the tutor:\n${prompt}`
      : `${basePrompt}${worksheetPreamble}`;

    log.info({ mode, selectedModel }, "Calling OpenRouter API for image generation");

    const data = await openrouterChat(
      {
        model: selectedModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: image } },
              { type: "text", text: finalPrompt },
            ],
          },
        ],
        modalities: ["image", "text"], // Required for image generation
        reasoning_effort: "minimal",
      },
      { requestId, signal: req.signal },
    );

    const message = data.choices?.[0]?.message;
    const imageUrl = extractImageUrl(message);
    const duration = Date.now() - startTime;

    if (!imageUrl) {
      // This is an expected path in auto mode: Gemini may decide that no help is needed
      // and return only text. In voice mode we strongly discouraged this in the prompt,
      // but still handle it gracefully.
      const textContent = message?.content || "";

      log.info(
        {
          duration,
          generatedImageSize: 0,
          hasTextContent: !!textContent,
          tokensUsed: data.usage?.total_tokens,
          rawResponseSnippet: JSON.stringify(data).slice(0, 2000),
        },
        effectiveSource === "voice"
          ? "Solution generation completed without image in voice mode (model returned text-only response)"
          : "Solution generation completed without image (model returned text-only response)",
      );

      return Response.json({
        success: false,
        imageUrl: null,
        textContent,
        reason: "Model did not return an image (likely decided help was not needed).",
      });
    }

    log.info(
      {
        duration,
        generatedImageSize: imageUrl.length,
        hasTextContent: !!message?.content,
        tokensUsed: data.usage?.total_tokens,
      },
      "Solution generation completed successfully",
    );

    return Response.json({
      success: true,
      imageUrl,
      textContent: message?.content || "",
    });
  } catch (error) {
    return errorResponse(error, log, { duration: Date.now() - startTime });
  }
}
