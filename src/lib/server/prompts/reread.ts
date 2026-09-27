import { z } from "zod";
import type { RereadRequest } from "@/lib/live/contracts";
import type { ChatMessage } from "@/lib/server/openrouter";

/**
 * System prompt for POST /api/live/reread, the second reader for messy ink. Adapted from the
 * model benchmark's job-3 prompt (`REPAIR_SYSTEM_PROMPT` in src/__eval__/models/misreads.ts,
 * docs/eval/models.md), where Gemini 3.1 Flash Lite fixed 14 of 18 real Mathpix misreads and
 * changed none of 20 correct reads. The one change: the column's lines BELOW the line are sent
 * too when the student rewrote a line in the middle of their work.
 */
export const REREAD_SYSTEM_PROMPT = [
  "You proofread a handwriting recognizer. You get an image of ONE handwritten line of a student's maths, the recognizer's LaTeX for that line, and the other lines of the same column on the page (as the recognizer read them).",
  "Compare the LaTeX with the image symbol by symbol.",
  "- If it matches what is written, return it unchanged.",
  "- If the recognizer misread something (a letter read as a look-alike digit or Greek letter, the wrong case, bars or brackets misread or dropped, lost limits, subscripts or superscripts), return the corrected LaTeX.",
  "The other lines only tell you which letters and notation the student uses; they may contain misreads themselves.",
  "Transcribe exactly what is written, even if the maths is wrong: never solve, simplify or fix the student's maths.",
  'Return JSON only: {"latex": string, "changed": boolean}. KaTeX-renderable LaTeX, no $ delimiters.',
].join("\n");

export const RereadReplySchema = z.object({
  latex: z.string().max(2000),
  changed: z.boolean().catch(false).default(false),
});
export type RereadReply = z.infer<typeof RereadReplySchema>;

function numbered(lines: readonly string[]): string {
  return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
}

/** Build the multimodal chat messages for one line (image first, as the benchmark sent it). */
export function buildRereadMessages(req: Pick<RereadRequest, "crop" | "latex" | "above" | "below">): ChatMessage[] {
  const above = (req.above ?? []).map((l) => l.trim()).filter(Boolean);
  const below = (req.below ?? []).map((l) => l.trim()).filter(Boolean);
  const text = [
    `Recognizer's LaTeX for the line in the image: ${req.latex}`,
    above.length > 0 ? `Lines above, top to bottom:\n${numbered(above)}` : "Lines above: none",
    below.length > 0 ? `Lines below, top to bottom:\n${numbered(below)}` : null,
    "JSON only.",
  ]
    .filter((s): s is string => s !== null)
    .join("\n");
  return [
    { role: "system", content: REREAD_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: req.crop } },
        { type: "text", text },
      ],
    },
  ];
}

/** The model's LaTeX as the board receives it: `$` delimiters and surrounding space off. */
export function cleanRereadLatex(latex: string): string {
  return latex.replace(/^\s*\$+|\$+\s*$/g, "").trim();
}

/** Minimal reasoning for the models that take it; Anthropic's thinking is off by default and a budget is ≥ 1024 tokens. */
export function rereadReasoning(model: string): "minimal" | undefined {
  return model.startsWith("anthropic/") ? undefined : "minimal";
}
