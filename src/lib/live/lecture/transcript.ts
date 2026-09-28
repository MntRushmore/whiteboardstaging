import { LECTURE_LIMITS, LECTURE_TIMING, type TranscriptSegment } from "./contracts";

/**
 * The lecture as heard: the recognizer's finished segments, in order, and the windows the
 * director is sent from them. Pure (no timers, no DOM); the session owns one and moves its mark.
 *
 *  - `window(mark)`: what is new since the director was last asked (`fresh`, its newest
 *    `freshChars`) and what came just before it (`context`, its newest `contextChars`), so the
 *    director sees the thread of the lecture without being sent all of it again.
 *  - `forcedWindow()`: "Draw that" — the last `forceWindowMs` of speech as fresh, whether or not
 *    the director has seen it, since the student is asking about what was just said.
 *  - `wordsSince(mark)`: the words heard since a mark (the tick rule's threshold).
 *
 * A mark is where the director's reading stopped: the next segment's sequence number and the
 * words heard before it, so counting survives old segments being dropped.
 */

export interface TranscriptMark {
  /** sequence number of the first segment after the mark */
  seq: number;
  /** words heard before the mark */
  words: number;
}

export interface TranscriptWindow {
  context: string;
  fresh: string;
}

interface Stored extends TranscriptSegment {
  seq: number;
}

/** Old segments beyond this are dropped: every window only ever reads the last few thousand characters. */
const MAX_SEGMENTS = 400;

/** Scripts written without spaces between words: each character carries about half a word. */
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;

/**
 * Words in a piece of speech. Spaces separate words in most languages; in Chinese, Japanese, Thai
 * and the like they do not, so there two characters count as a word — otherwise a lecture in those
 * languages would never reach the tick rule's word threshold.
 */
export function countWords(text: string): number {
  let n = 0;
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;
    const dense = token.match(NO_SPACE_SCRIPT)?.length ?? 0;
    n += dense > 0 ? Math.max(1, Math.round(dense / 2)) : 1;
  }
  return n;
}

/** One line of speech: whitespace collapsed. */
export function cleanSpeech(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The last `max` characters of `text`, starting at a word (a cut word at the front is dropped when
 * a space is near). Always at most `max` characters.
 */
export function tailChars(text: string, max: number): string {
  const t = cleanSpeech(text);
  if (t.length <= max) return t;
  const cut = t.slice(t.length - max);
  // the cut fell between two words: nothing to drop
  if (cut[0] === " " || t[t.length - max - 1] === " ") return cut.trimStart();
  const space = cut.indexOf(" ");
  // only drop a partial word, never most of the window (a very long "word" is kept as it is)
  return space > 0 && space < 24 ? cut.slice(space + 1) : cut;
}

export class TranscriptBuffer {
  private segments: Stored[] = [];
  private nextSeq = 0;
  private words = 0;

  /** Adds a finished segment; empty ones are ignored. Returns true when it was kept. */
  add(segment: TranscriptSegment): boolean {
    const text = cleanSpeech(segment.text);
    if (!text) return false;
    this.segments.push({ text, atMs: segment.atMs, seq: this.nextSeq++ });
    this.words += countWords(text);
    if (this.segments.length > MAX_SEGMENTS) this.segments.splice(0, this.segments.length - MAX_SEGMENTS);
    return true;
  }

  /** Where the director's reading stops now (after everything heard so far). */
  mark(): TranscriptMark {
    return { seq: this.nextSeq, words: this.words };
  }

  /** The start of the lecture: nothing read yet. */
  static readonly START: TranscriptMark = { seq: 0, words: 0 };

  get totalWords(): number {
    return this.words;
  }

  get isEmpty(): boolean {
    return this.segments.length === 0;
  }

  wordsSince(mark: TranscriptMark): number {
    return Math.max(0, this.words - mark.words);
  }

  /** What is new since `mark` (its newest `freshChars`), without the context: cheap enough for every segment. */
  textSince(mark: TranscriptMark): string {
    const i = this.indexOf(mark.seq);
    return tailChars(this.segments.slice(i).map((s) => s.text).join(" "), LECTURE_LIMITS.freshChars);
  }

  /** What is new since `mark` (its newest `freshChars`) and what came before it (its newest `contextChars`). */
  window(mark: TranscriptMark): TranscriptWindow {
    const i = this.indexOf(mark.seq);
    return this.split(i);
  }

  /**
   * "Draw that": the last `windowMs` of speech, measured back from the newest segment (so after a
   * silence it is still the last thing said), as fresh; what came before it as context.
   */
  forcedWindow(windowMs: number = LECTURE_TIMING.forceWindowMs): TranscriptWindow {
    const last = this.segments[this.segments.length - 1];
    if (!last) return { context: "", fresh: "" };
    const from = last.atMs - windowMs;
    let i = this.segments.length - 1;
    while (i > 0 && this.segments[i - 1].atMs >= from) i--;
    return this.split(i);
  }

  /** The newest `n` segments' text, oldest first (the panel's ticker). */
  lastLines(n: number): string[] {
    return n <= 0 ? [] : this.segments.slice(-n).map((s) => s.text);
  }

  /** The newest segment's time, or null before anything was heard. */
  get lastAtMs(): number | null {
    return this.segments[this.segments.length - 1]?.atMs ?? null;
  }

  private indexOf(seq: number): number {
    // segments are in seq order; a mark older than what is kept starts at the oldest kept
    const first = this.segments[0]?.seq ?? this.nextSeq;
    return Math.min(this.segments.length, Math.max(0, seq - first));
  }

  private split(i: number): TranscriptWindow {
    const join = (from: number, to: number) => this.segments.slice(from, to).map((s) => s.text).join(" ");
    return {
      context: tailChars(join(0, i), LECTURE_LIMITS.contextChars),
      fresh: tailChars(join(i, this.segments.length), LECTURE_LIMITS.freshChars),
    };
  }
}
