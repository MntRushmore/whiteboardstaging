/**
 * Ask's replies cut into what the voice says, as they stream (docs/ASK-V2.md, part "voice").
 *
 * A reply is Markdown-lite (paragraphs, `**bold**`, `-` and `1.` lists, `$…$` and `$$…$$` maths)
 * and arrives a few words at a time. A sentence is said as soon as it is whole, so a sentence ends
 * only where the text says so for sure:
 *  - `.`, `!` or `?` (with any closing quote, bracket or `**` after it) followed by a space or a new
 *    line. Not "3.5" (no space after the point), not "e.g." or "Mr." (a short list of
 *    abbreviations), not a list's "1." at the start of a line, and not at the very end of the
 *    streamed text: "3." may yet become "3.5".
 *  - a new line (a paragraph, a list item), outside display maths.
 *  - never inside `$…$` or `$$…$$`: "$3.5 + 1.2$" is one piece of maths, and a `$` still open means
 *    the sentence is not done. Inline maths never spans a line, so a lone `$` (money) is let go at
 *    the line's end, and at the reply's end.
 * The reply's board block (`<board>…`) is never said.
 *
 * Pure: strings in, strings out (`__tests__/speechChunks.test.ts`).
 */
import { ASK_BOARD_OPEN } from "@/lib/live/ask/contracts";
import { capSpoken, spokenText } from "@/lib/speech/spoken";

export const ASK_SPEECH = {
  /**
   * The most characters said of one reply (the words sent to the voice, maths already in words).
   * ElevenLabs bills by the character and the account's balance is small; a reply longer than this
   * is on the screen, and its speaker button says it again from the start.
   */
  maxReplyChars: 700,
  /**
   * One phrase sent to the voice at most: several short sentences go as one request (fewer calls,
   * fewer pauses), and it stays under the speak route's SPEAK_MAX_CHARS (280).
   */
  phraseChars: 240,
} as const;

/** Words before a full stop that do not end a sentence. */
const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "st", "jr", "sr", "approx", "no", "fig", "cf", "ex", "eg", "ie"]);
/** What may follow a sentence's last mark and still belong to it: closing quotes, brackets, bold. */
const CLOSERS = new Set([".", "!", "?", '"', "'", "”", "’", ")", "]", "*", "_"]);
const isSpace = (ch: string | undefined) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

/** Is the `.` at `dot` part of a word rather than a sentence's end ("e.g.", "Dr.", a list's "2.")? */
function dotIsNotAnEnd(text: string, dot: number): boolean {
  let start = dot;
  while (start > 0 && !isSpace(text[start - 1])) start--;
  const word = text
    .slice(start, dot)
    .replace(/^[("'*_[]+/, "")
    .toLowerCase();
  if (ABBREVIATIONS.has(word)) return true;
  if (/^\d{1,3}$/.test(word)) {
    // a numbered list's marker: only spaces between the line's start and the number
    let before = start;
    while (before > 0 && (text[before - 1] === " " || text[before - 1] === "\t")) before--;
    return before === 0 || text[before - 1] === "\n";
  }
  return false;
}

/** An inline maths' closing `$`: no space before it, no digit after it ("$5 and $3" is money). */
function inlineCloser(text: string, at: number): boolean {
  return !isSpace(text[at - 1]) && !/\d/.test(text[at + 1] ?? "");
}

/** Does the maths opened at `at` close before its line ends (inline) or before `limit` (display)? */
function closesOnItsLine(text: string, at: number, limit: number, display: boolean): boolean {
  if (display) {
    const close = text.indexOf("$$", at + 2);
    return close >= 0 && close < limit;
  }
  for (let j = at + 1; j < limit; j++) {
    if (text[j] === "\n") return false;
    if (text[j] === "\\") j++;
    else if (text[j] === "$" && inlineCloser(text, j)) return true;
  }
  return false;
}

/**
 * The whole sentences of `text` from index `from`, and where the next one starts (pass it back as
 * `from` when more text has come). `final`: the text is complete, so what is left is a sentence too.
 */
export function takeSentences(text: string, from: number, final: boolean): { sentences: string[]; next: number } {
  let limit = text.length;
  const board = text.indexOf(ASK_BOARD_OPEN, from);
  if (board >= 0) {
    // the board block follows the reply: everything before it is the reply's end
    limit = board;
    final = true;
  }
  const sentences: string[] = [];
  const push = (end: number) => {
    const s = text.slice(start, end).trim();
    if (s) sentences.push(s);
    start = end;
  };

  let start = from;
  let math: "$" | "$$" | null = null;
  let mathOpenedAt = -1;
  let i = from;
  while (i < limit) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "$") {
      i += 2; // an escaped dollar is a dollar
      continue;
    }
    if (ch === "$") {
      const display = text[i + 1] === "$";
      if (math === null) {
        // Inline maths opens on a `$` with no space after it ("$5", "$x"); at the reply's end, only
        // when its closing `$` is on the same line: else it is money ("costs $5.")
        const opens = display || (i + 1 < limit ? !isSpace(text[i + 1]) : !final);
        if (opens && (!final || closesOnItsLine(text, i, limit, display))) {
          math = display ? "$$" : "$";
          mathOpenedAt = i;
        }
      } else if (math === "$$" ? display : !display && inlineCloser(text, i)) {
        math = null;
      }
      i += display && math !== "$" ? 2 : 1;
      continue;
    }
    if (math === "$" && ch === "\n") {
      // inline maths never spans a line: that `$` was a dollar
      math = null;
      i = mathOpenedAt + 1;
      continue;
    }
    if (math) {
      i++;
      continue;
    }
    if (ch === "\n") {
      push(i);
      i++;
      continue;
    }
    if (ch === "." || ch === "!" || ch === "?") {
      let j = i + 1;
      while (j < limit && CLOSERS.has(text[j])) j++;
      if (j >= limit) {
        // the stream's very end: "3." may become "3.5", "Great!" may be followed by "**"
        if (final) push(limit);
        i = limit;
        break;
      }
      if (isSpace(text[j]) && !(ch === "." && j === i + 1 && dotIsNotAnEnd(text, i))) {
        push(j);
        i = j;
        continue;
      }
      i = j;
      continue;
    }
    i++;
  }
  if (final && start < limit) push(limit);
  // a final text has nothing left to take (its board block included)
  return { sentences, next: final ? text.length : start };
}

/** List markers and headings at a line's start, which are layout and no words. */
const LAYOUT = /^\s*(?:#{1,6}\s+|[-*•+]\s+|\d{1,3}[.)]\s+)+/;
/** Emoji: a voice reads them out by name ("party popper"), or stumbles. */
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/** One sentence as the words to say (layout, markup and emoji gone, `$…$` maths in words); "" for none. */
export function sentenceWords(sentence: string): string {
  return spokenText(sentence.replace(LAYOUT, "").replace(EMOJI, " "), 4_000);
}

/** Words longer than `max` cut where a voice can breathe: a clause's comma first, else a space. */
export function splitLong(words: string, max: number = ASK_SPEECH.phraseChars): string[] {
  const parts: string[] = [];
  let rest = words.trim();
  while (rest.length > max) {
    const head = rest.slice(0, max + 1);
    let cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(": "));
    if (cut < max / 3) cut = head.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    else cut += 1; // keep the comma with its clause
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * What two versions of one sentence share (as streamed, and in the final reply after cleaning):
 * its spoken words in lower case, letters and digits only. "" for a sentence with nothing to say.
 */
export function sentenceKey(sentence: string): string {
  return sentenceWords(sentence)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Words that fit what is left of a reply's characters: whole when they fit, else cut on a sentence
 * or a word (`capSpoken`), or "" when too little is left to say anything worth hearing.
 */
export function fitWords(words: string, left: number): string {
  if (words.length <= left) return words;
  if (left < 40) return "";
  return capSpoken(words, left);
}
