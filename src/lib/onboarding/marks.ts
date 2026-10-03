/**
 * Reading the tutor's work off the board, from a shape's meta: its marks (tick, ring, question
 * mark) and its writing. Shared by the board's cheers (`Celebrations`, on the board's first load)
 * and the guided board's tour (lazy), so it is its own tiny, import-free module: the tour's state
 * machine (`state.ts`) must not ride along on every board.
 */

export type MarkKind = "check" | "circle" | "question";

/** Why the tutor put a question mark on a line (`meta.markWhy`, written by `LiveLoop.syncMark`). */
export type QuestionWhy = "unread" | "unjudged";

/**
 * The tutor's mark on a shape, from its meta (`meta.mark = "check:<x>,<y>,<w>,<h>"`, written by
 * `LiveLoop.syncMark` on the tutor's own ink): null for anything else.
 */
export function markKindOf(meta: unknown): MarkKind | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  if (m.live !== true || m.source !== "ai" || typeof m.mark !== "string") return null;
  const kind = m.mark.split(":")[0];
  return kind === "check" || kind === "circle" || kind === "question" ? kind : null;
}

/**
 * Why the tutor put a question mark there (`meta.markWhy`), for a question mark only: `unjudged`
 * when it read the line but there was nothing in it to check, else `unread` (also a question mark
 * from before the reason was recorded).
 */
export function questionWhyOf(meta: unknown): QuestionWhy | null {
  if (markKindOf(meta) !== "question") return null;
  return (meta as Record<string, unknown>).markWhy === "unjudged" ? "unjudged" : "unread";
}

/**
 * The tutor's writing on the board — a step, a solution, a graph — from a shape's meta: the Live
 * layer's own (`live`, `source: "ai"`), and neither a mark (`mark`, `markKindOf`) nor a problem the
 * chat wrote (`chatProblem`, `CHAT_PROBLEM_META` in src/lib/live/chat/cells.ts; spelled out here so
 * this file stays import-free, and pinned equal in the tests).
 */
export function isTutorWork(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  return m.live === true && m.source === "ai" && m.mark === undefined && m.chatProblem === undefined;
}
