/**
 * Which words on the board are the tutor's, to be read aloud — and never the student's own work.
 *
 *  - A note on a line's readback (`props.note` of a math echo): the hint the check model wrote
 *    about a ringed line ("Check the sign when you move the 3"). Only a model's note on a ringed
 *    line (status `warn`, `meta.aiNote`: `AI_NOTE_META` in src/lib/live/liveLoop.ts), only when it
 *    is new or changed, never the line's own LaTeX (that is what the student wrote).
 *  - A hint card (`OpenHint`): its message, then its Socratic question.
 *
 * Pure: plain records in, words out (`__tests__/tutorWords.test.ts`).
 */

/** The echo meta key the live loop stamps on a model-written note (liveLoop.ts `AI_NOTE_META`). */
const AI_NOTE_META = "aiNote";

interface MathRecordLike {
  typeName?: unknown;
  type?: unknown;
  meta?: unknown;
  props?: { status?: unknown; note?: unknown };
}

function mathRecord(rec: unknown): MathRecordLike | null {
  if (!rec || typeof rec !== "object") return null;
  const r = rec as MathRecordLike;
  return r.typeName === "shape" && r.type === "math" && r.props && typeof r.props === "object" ? r : null;
}

/** The note a math record carries, trimmed ("" for none). */
function noteOf(rec: MathRecordLike | null): string {
  const note = rec?.props?.note;
  return typeof note === "string" ? note.trim() : "";
}

/**
 * The tutor's new words on a line's readback: the model's note on a ringed line, when `to` has one
 * that `from` (the record before the change; null for a new record) did not. null otherwise.
 */
export function newTutorNote(from: unknown, to: unknown): string | null {
  const next = mathRecord(to);
  if (!next || next.props?.status !== "warn") return null;
  const meta = next.meta;
  if (!meta || typeof meta !== "object" || (meta as Record<string, unknown>)[AI_NOTE_META] !== true) return null;
  const note = noteOf(next);
  if (!note) return null;
  return noteOf(mathRecord(from)) === note ? null : note;
}

/** A hint card as one thing to say: the hint, then its question. */
export function hintSpeech(hint: { message?: string; question?: string }): string {
  return [hint.message, hint.question]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

/** A coach mark as one thing to say: its title, then the line under it. */
export function coachSpeech(title: string, body?: string | null): string {
  return [title, body ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}
