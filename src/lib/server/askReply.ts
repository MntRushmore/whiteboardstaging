/**
 * Ask's reply when every action it proposed for the board was dropped (POST /api/live/ask). The old
 * chat replaced the whole reply with why: its replies were a sentence about the board. Ask's are a
 * tutor's explanation, already streamed, with a sentence about the board at the end. Throwing the
 * explanation away for "Sorry, I couldn't check those problems" loses what the student came for, so
 * only the sentences that claim board work go, and the gate's line about what failed follows.
 */

/** A sentence that claims board work ("I put 5 problems on your board", "I wrote the steps"). */
export const BOARD_TALK = /\b(board|wrote|written|put (them|it|these|those)|on your screen)\b/i;

/** Less than this left after the board talk is not an explanation worth keeping: the failure line alone. */
export const MIN_EXPLANATION_CHARS = 40;

export interface ReplySentence {
  text: string;
  /** the whitespace after it (a line break keeps paragraphs and lists apart) */
  gap: string;
}

const CLOSERS = new Set(['"', "'", ")", "*", "_", "”", "’"]);

/**
 * The reply's sentences, in order, each with the whitespace after it: joined back, they are the
 * reply (less any whitespace it started with). A sentence ends at `.`, `!` or `?` before whitespace (closing quotes, brackets and bold
 * marks go with it) and at a line break, never inside `$…$` or `$$…$$` maths. An ordered list's
 * `1.` is no sentence end. Inline maths ends at a line break, so a lone `$` (a price) cannot swallow
 * the rest of the reply.
 */
export function replySentences(text: string): ReplySentence[] {
  const out: ReplySentence[] = [];
  let start = 0;
  let lineStart = 0;
  let math: "" | "$" | "$$" = "";
  let i = 0;
  const cut = (end: number) => {
    let next = end;
    while (next < text.length && /\s/.test(text[next])) next++;
    if (end > start) out.push({ text: text.slice(start, end), gap: text.slice(end, next) });
    else if (out.length > 0) out[out.length - 1].gap += text.slice(end, next);
    for (let k = end; k < next; k++) if (text[k] === "\n") lineStart = k + 1;
    start = next;
    i = next;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "$") {
      const two = text[i + 1] === "$";
      if (math === "$") {
        math = "";
        i++;
      } else if (math === "$$") {
        if (two) math = "";
        i += two ? 2 : 1;
      } else {
        math = two ? "$$" : "$";
        i += two ? 2 : 1;
      }
      continue;
    }
    if (c === "\n") {
      if (math === "$$") {
        i++;
        continue;
      }
      math = "";
      cut(i);
      continue;
    }
    if (!math && (c === "." || c === "!" || c === "?")) {
      // "1. " starting a line is a list marker, not the end of a sentence
      if (c === "." && /^\s*\d+$/.test(text.slice(lineStart, i))) {
        i++;
        continue;
      }
      let end = i + 1;
      while (end < text.length && CLOSERS.has(text[end])) end++;
      if (end >= text.length || /\s/.test(text[end])) {
        cut(end);
        continue;
      }
    }
    i++;
  }
  if (start < text.length) out.push({ text: text.slice(start), gap: "" });
  return out;
}

const breaks = (s: string) => (s.match(/\n/g) ?? []).length;
const withoutMaths = (s: string) => s.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, " ");

/**
 * The reply with every sentence that claims board work taken out (BOARD_TALK, read outside its
 * maths), trimmed: what is left of the explanation when the board part failed. Pure.
 */
export function explanationOf(reply: string): string {
  let kept = "";
  for (const s of replySentences(reply)) {
    if (BOARD_TALK.test(withoutMaths(s.text))) {
      // the sentence goes, but a paragraph or line break it stood before still separates
      const trail = /\s*$/.exec(kept)?.[0] ?? "";
      if (kept && breaks(s.gap) > breaks(trail)) kept = kept.slice(0, kept.length - trail.length) + s.gap;
      continue;
    }
    kept += s.text + s.gap;
  }
  return kept.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Whether a real explanation stays once the board talk is gone (at least MIN_EXPLANATION_CHARS):
 * the student got an answer for the ink even with nothing on the board, so Ask keeps the charge
 * (`chatGate`'s `refundWhen`). Without one they see only the failure line, and the ink comes back.
 */
export function explains(reply: string): boolean {
  return explanationOf(reply).length >= MIN_EXPLANATION_CHARS;
}

/**
 * The reply with every sentence that claims board work taken out (`explanationOf`), then
 * `failureLine` as its own paragraph. With less than MIN_EXPLANATION_CHARS left ("Here you go —
 * check your board!"), the failure line alone. Pure.
 */
export function keepExplanation(reply: string, failureLine: string): string {
  const explanation = explanationOf(reply);
  if (explanation.length < MIN_EXPLANATION_CHARS) return failureLine;
  return `${explanation}\n\n${failureLine}`;
}
