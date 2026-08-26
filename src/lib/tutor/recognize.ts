import { logger } from "@/lib/logger";
import type { StrokeSample } from "./types";

/** Client: strokes → Mathpix. Empty string if keys are missing or ink is unreadable. */
export async function recognizeStrokes(
  strokes: StrokeSample[],
  signal?: AbortSignal,
): Promise<string> {
  if (strokes.length === 0) {
    logger.info({ strokeCount: 0 }, "Mathpix miss; stay quiet");
    return "";
  }
  try {
    const response = await fetch("/api/recognize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ strokes }),
    });
    if (!response.ok) return "";
    const data = (await response.json()) as { latex?: unknown };
    return typeof data.latex === "string" ? data.latex.trim() : "";
  } catch {
    return "";
  }
}
