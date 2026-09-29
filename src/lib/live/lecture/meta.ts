/**
 * The meta keys lecture mode puts on the board, apart from the rest of the contract
 * (`contracts.ts`, which re-exports them): the live loop needs them on every board, and the
 * contract's schemas are loaded only with a lecture (docs/BUNDLE.md).
 */

/** shape meta: the kind of lecture block (`heading`, `note`, `chart`, `diagram`) */
export const LECTURE_BLOCK_META = "lectureBlock";
/** shape meta: the block's one-line summary (`describeLectureAction`) */
export const LECTURE_WHAT_META = "lectureWhat";
/** page (screen) meta: `LecturePageMeta` */
export const LECTURE_PAGE_META = "lecture";
/** shape meta: the id of the chart or diagram a stroke belongs to (stable across its updates) */
export const LECTURE_ID_META = "lectureId";

/** Transcript kept on each screen's page meta: older text is dropped from the front, at a word. */
export const LECTURE_TRANSCRIPT_CHARS = 12_000;

/**
 * A screen's transcript with `heard` added at the end (spaces collapsed), capped at
 * `LECTURE_TRANSCRIPT_CHARS` from the front at a word boundary.
 */
export function appendHeard(transcript: string, heard: string): string {
  const add = heard.replace(/\s+/g, " ").trim();
  const cur = transcript.trim();
  if (!add) return cur;
  const text = cur ? `${cur} ${add}` : add;
  const max = LECTURE_TRANSCRIPT_CHARS;
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  if (/\s/.test(text[text.length - max - 1] ?? "")) return cut.trimStart();
  const at = cut.search(/\s/);
  return at === -1 ? cut : cut.slice(at + 1).trimStart();
}
