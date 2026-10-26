/**
 * REED'S SYSTEM, VERBATIM. Reed Grenager's November 2025 hackathon version of "the tutor draws on
 * the kid's board" (commit 6457c296: src/app/api/generate-solution/route.ts and the voice tutor's
 * draw_on_canvas tool), as the drawing bake-off kept it (eval/drawing-bakeoff,
 * src/__eval__/drawing/edit/reed.ts). Every string below is Reed's, character for character: do not
 * reword, reflow or "fix" them. The faster system (src/lib/server/boardDraw/run.ts) changes only who
 * decides and the models: one tutor call decides and writes the instructions (./prompts.ts), and the
 * painter gets Reed's prompt in its voice form plus those instructions.
 *
 * NOT copied on purpose: the old route's fallback that scanned the reply TEXT for an image URL. It
 * once laid imgur's "image does not exist" picture over a kid's board. `pictureUrlOf` below accepts
 * only `message.images[0].image_url.url` or an image part in `message.content`.
 */

export type ReedMode = "feedback" | "suggest" | "answer";
export type ReedSource = "auto" | "voice";

/** `getModePrompt` from 6457c296 generate-solution/route.ts, character for character. */
export function getModePrompt(mode: string, source: ReedSource = "auto"): string {
  const effectiveSource = source === "voice" ? "voice" : "auto";

  const baseAnalysis = "Analyze the user's writing in the image carefully. Look for incomplete work or any indication that the user is working through something challenging and might benefit from some form of assistance.";

  const noHelpInstruction = "\n\nIf the user does NOT seem to need help:\n- Simply respond concisely with text explaining why help isn't needed. Do not generate an image.\n\nBe thoughtful about when to offer help - look for clear signs of incomplete problems or questions.";

  // For voice-triggered generations, we always want an updated image,
  // not a text-only answer.
  const alwaysImageRule = effectiveSource === "voice" ? "\n- ALWAYS generate an updated image of the canvas; do not respond with text-only." : "";

  const coreRules =
    "\n\n**CRITICAL:**\n- DO NOT remove, modify, move, transform, edit, or touch ANY of the image's existing content. Leave EVERYTHING in the image EXACTLY as it is in its current state, and *only* add to it.\n- Write EVERYTHING you add by hand, as the user would: copy their letter and digit shapes, their size, their slant and their pen thickness, so it looks like the same person kept writing. NEVER use a typed, printed, italic or textbook font, not even for equations, exponents or graph labels.\n- Write every digit clearly and fully formed (an 8 is two closed loops, a 0 is one closed loop), never touching another character.\n- NEVER update the background color of the image. Keep it white, unless directed otherwise." +
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

/** The prompt the route sends: the mode prompt, plus the tutor's instructions when given. */
export function reedPrompt(mode: ReedMode, source: ReedSource, instructions?: string | null): string {
  const basePrompt = getModePrompt(mode, source);
  return instructions ? `${basePrompt}\n\nAdditional drawing instructions from the tutor:\n${instructions}` : basePrompt;
}

/** The route's chat-completions body, with only the model swapped (Reed's exact fields and order). */
export function reedChatBody(model: string, imageDataUrl: string, prompt: string, reasoningEffort = "minimal"): Record<string, unknown> {
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl } },
          { type: "text", text: prompt },
        ],
      },
    ],
    modalities: ["image", "text"],
    reasoning_effort: reasoningEffort,
  };
}

/** The voice tutor's session instructions and its draw_on_canvas tool, from 6457c296. */
export const REED_VOICE_INSTRUCTIONS =
  "You are a realtime voice tutor for a handwritten whiteboard canvas. Speak clearly and briefly. Use tools when you need to inspect the canvas or add visual help. Prefer gentle hints before full solutions.";
export const REED_DRAW_TOOL_DESCRIPTION = "Use the Gemini 3 Pro canvas solver to add feedback, hints, or full solutions directly onto the whiteboard image.";
export const REED_DRAW_INSTRUCTIONS_PARAM = "Optional instructions about what to draw, which problem to focus on, or style preferences.";

/**
 * The picture in a painter reply: `message.images[0].image_url.url`, else the first image part of
 * `message.content` (`image_url` / `output_image`). Never a URL found in the reply's text (see the
 * header). Only a base64 data URL is taken: the route never fetches a URL a model wrote.
 */
export function pictureUrlOf(message: unknown): string | null {
  const m = message as { images?: Array<{ image_url?: { url?: unknown } }>; content?: unknown } | null | undefined;
  const candidates: unknown[] = [];
  if (Array.isArray(m?.images) && m.images.length > 0) candidates.push(m.images[0]?.image_url?.url);
  if (Array.isArray(m?.content)) {
    for (const part of m.content as Array<{ type?: unknown; url?: unknown; image_url?: { url?: unknown } }>) {
      if (part?.type === "image_url") candidates.push(part.image_url?.url);
      else if (part?.type === "output_image") candidates.push(part.image_url?.url ?? part.url);
    }
  }
  for (const url of candidates) if (typeof url === "string" && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(url)) return url;
  return null;
}
