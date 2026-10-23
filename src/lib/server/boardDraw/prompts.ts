/**
 * The picture tutor's ONE decision call (src/lib/server/boardDraw/run.ts): does the kid need help,
 * and if so, what exactly should the painter add, and where. This is the wording of the measured
 * run (2026-10-23, the drawing bake-off's fast chain: gemini-3.8-flash then Nano Banana 2 Lite,
 * ~6 s, ~$0.036), kept in this one file on purpose: a parallel eval is testing a spacing fix
 * ("place additions in the empty space, sized like the kid's writing"), and its winning wording is
 * dropped in HERE, nowhere else. Change the text only with an eval behind it.
 *
 * The system prompt is Reed's voice tutor's (`REED_VOICE_INSTRUCTIONS`), and the tool the
 * instructions are written for is his `draw_on_canvas` (`REED_DRAW_TOOL_DESCRIPTION`), verbatim.
 */
import type { ChatMessage } from "@/lib/server/openrouter";
import { REED_DRAW_TOOL_DESCRIPTION, REED_VOICE_INSTRUCTIONS, type ReedMode } from "./reed";

/** What each mode lets the drawing say. */
export const MODE_RULE: Record<ReedMode, string> = {
  feedback: "Mode feedback: point out the mistake and where it is; do not write the corrected answer.",
  suggest: "Mode suggest: give a hint for the next step only; never write the answer.",
  answer: "Mode answer (Solve): write the complete worked solution, every step, ending with the final answer.",
};

/** The tutor's text, after the board image (lines joined with "\n"). */
export function tutorText(mode: ReedMode): string {
  return [
    `The picture is the student's whiteboard. The board's assistance mode is "${mode}".`,
    "First decide whether the student needs help: a mistake, unfinished work, a question, or being stuck. Finished correct work, doodles and a word still being written do not need help.",
    `If they need help, write the instructions for your tool draw_on_canvas (${REED_DRAW_TOOL_DESCRIPTION}) with mode "${mode}": exactly what to add to the board and where — the words, numbers, marks and arrows, each next to the part of the student's work it is about. Be exactly right about the maths. Under 50 words.`,
    MODE_RULE[mode],
    'Reply with only this JSON, nothing before or after it: {"needsHelp": true or false, "instructions": "..."}',
  ].join("\n");
}

/** The tutor call's messages: Reed's voice-tutor instructions as the system, then the board, then the text. */
export function tutorMessages(mode: ReedMode, imageDataUrl: string): ChatMessage[] {
  return [
    { role: "system", content: REED_VOICE_INSTRUCTIONS },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageDataUrl } },
        { type: "text", text: tutorText(mode) },
      ],
    },
  ];
}

export type TutorDecision = { needsHelp: boolean; instructions: string };

/**
 * The tutor's reply, read from the first "{" to the last "}". Null when that is not JSON with a
 * boolean `needsHelp` (the caller answers a retryable error). `instructions` is trimmed and capped.
 */
export function parseTutorReply(text: string, maxInstructions: number): TutorDecision | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const d = parsed as { needsHelp?: unknown; instructions?: unknown };
  if (typeof d.needsHelp !== "boolean") return null;
  const instructions = typeof d.instructions === "string" ? d.instructions.trim().slice(0, maxInstructions) : "";
  return { needsHelp: d.needsHelp, instructions };
}
