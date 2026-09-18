import { z } from "zod";
import type { ChatMessage } from "@/lib/server/openrouter";

/** Vision-fallback transcription prompt for POST /api/live/recognize (spec §5.2). */
export const RECOGNIZE_VISION_PROMPT =
  "Transcribe the handwriting exactly as written, even if mathematically wrong. " +
  'Return JSON {"latex": string, "text": string, "confidence": number (0..1), "isMath": boolean}. ' +
  "Do not solve or correct. KaTeX-renderable LaTeX only, with no $ delimiters. " +
  "If the image contains no legible writing, return an empty latex and text with confidence 0.";

export const VisionTranscriptionSchema = z.object({
  latex: z.string().max(2000).default(""),
  text: z.string().max(2000).default(""),
  confidence: z.coerce.number().min(0).max(1).default(0.5),
  isMath: z.boolean().default(true),
});
export type VisionTranscription = z.infer<typeof VisionTranscriptionSchema>;

/** Build the multimodal chat messages for one crop. */
export function buildVisionMessages(cropDataUrl: string, hint?: "math" | "chem" | "physics"): ChatMessage[] {
  const hintText = hint ? ` The content is expected to be ${hint}.` : "";
  return [
    { role: "system", content: RECOGNIZE_VISION_PROMPT + hintText },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: cropDataUrl } },
        { type: "text", text: "Transcribe this handwritten line. JSON only." },
      ],
    },
  ];
}
