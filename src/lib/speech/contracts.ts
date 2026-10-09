/**
 * Read aloud (2026-10-09, Phase 3): the tutor says its hints and questions out loud, for children
 * who can't read well yet. A friendly ElevenLabs voice through POST /api/live/speak (the server
 * holds ELEVENLABS_API_KEY), and the browser's own speech when that route is unavailable.
 *
 * Shared contract for Phase 3 (docs/KIDS-COME-BACK.md).
 */

/** POST /api/live/speak: the text to say. Plain words only (no LaTeX), at most SPEAK_MAX_CHARS. */
export interface SpeakRequest {
  text: string;
}

/** Longer text is refused: hints and questions are a sentence or two. */
export const SPEAK_MAX_CHARS = 280;

/** On by default for the youngest (Kindergarten to 2nd grade); anyone can switch it on or off. */
export function readAloudByDefault(grade: number | null | undefined): boolean {
  return typeof grade === "number" && grade <= 2;
}

/** Device setting key: "on" | "off" (absent: the grade's default). */
export const READ_ALOUD_KEY = "agathon.readAloud";
