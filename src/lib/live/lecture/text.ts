import { INK, LECTURE_PACE, Sketch, innerBox, inside, partSeed, type LectureSketch } from "./chart/sketch";
import { fitWords, hyphenating, type WordsLayout } from "./words";

/**
 * The words of a lecture in the tutor's hand: a heading (the topic, large, underlined) and a
 * note (one key point, with a bullet). Pure geometry in plan-local px, ink from (0, 0).
 */

export const LECTURE_WORDS = {
  /** a heading is written this large, shrinking to fit its width; a second line only below `min` */
  heading: { size: 54, min: 38, twoLine: { size: 42, min: 32 } },
  /** the underline: its gap under the writing line (× size) and how far it runs past the words */
  underline: { drop: 0.3, gap: 3, before: 4, after: 12 },
  /** a note: hand size, the smallest it may shrink to, and its most lines */
  note: { size: 34, min: 28, maxLines: 4 },
  /** the bullet: its radius and the hanging indent of the text (× size) */
  bullet: { r: 0.12, indent: 0.95 },
} as const;

/** A heading laid out: one line when it fits, shrinking first, two lines as a last resort. */
function headingLayout(text: string, maxW: number): WordsLayout | null {
  const H = LECTURE_WORDS.heading;
  const U = LECTURE_WORDS.underline;
  const room = maxW - U.before - U.after;
  const two = () => fitWords(text, { maxWidth: room, maxLines: 2, maxSize: H.twoLine.size, minSize: H.twoLine.min, balance: true });
  return fitWords(text, { maxWidth: room, maxLines: 1, maxSize: H.size, minSize: H.min }) ?? two() ?? hyphenating(true, two);
}

/** The heading's sketch (and where its words are), or null when it cannot be written in `maxW`. */
export function sketchHeading(text: string, opts: { seed: number; maxW: number }): LectureSketch | null {
  const room = innerBox({ w: opts.maxW, h: 0 }).w;
  const layout = headingLayout(text, room);
  if (!layout) return null;
  const U = LECTURE_WORDS.underline;
  const s = new Sketch(opts.seed);
  const w = s.write("heading", layout, { x: U.before, y: 0 }, "left", "top");
  // underlined with one stroke of the pen, under the descenders, a touch off level
  const last = w.lines[w.lines.length - 1];
  const y = Math.max(last.baseline + layout.size * U.drop, w.rect.y + w.rect.h) + U.gap;
  const tilt = ((partSeed(opts.seed, "underline:tilt") % 1000) / 1000 - 0.5) * 3;
  s.draw("underline", (pen) => pen.line({ x: 0, y: y + tilt / 2 }, { x: U.before + layout.w + U.after, y: y - tilt / 2 }), { color: INK.line });
  const out = s.finish({ w: room, h: Infinity }, LECTURE_PACE.heading, layout.size);
  return out && inside(out.plan.bounds, { w: opts.maxW, h: Infinity }) ? out : null;
}

/** A note laid out beside its bullet: the largest size at which it wraps into `maxLines` lines. */
function noteLayout(text: string, maxW: number): WordsLayout | null {
  const N = LECTURE_WORDS.note;
  const at = () => {
    for (let size = N.size; size >= N.min; size--) {
      const indent = size * LECTURE_WORDS.bullet.indent;
      const m = fitWords(text, { maxWidth: maxW - indent, maxLines: N.maxLines, maxSize: size, minSize: size });
      if (m) return m;
    }
    return null;
  };
  return at() ?? hyphenating(true, at);
}

/** The note's sketch: a filled dot, then the words with a hanging indent. */
export function sketchNote(text: string, opts: { seed: number; maxW: number }): LectureSketch | null {
  const room = innerBox({ w: opts.maxW, h: 0 }).w;
  const layout = noteLayout(text, room);
  if (!layout) return null;
  const B = LECTURE_WORDS.bullet;
  const s = new Sketch(opts.seed);
  const indent = layout.size * B.indent;
  const w = s.words("note", layout, { x: indent, y: 0 }, "left", "top");
  const first = w.lines[0];
  // the bullet sits level with the middle of the small letters of the first line
  s.draw("bullet", (pen) => pen.dot({ x: layout.size * 0.3, y: first.baseline - layout.size * 0.17 }, Math.max(3, layout.size * B.r)), { color: INK.line });
  s.add("note", w);
  const out = s.finish({ w: room, h: Infinity }, LECTURE_PACE.note, layout.size);
  return out && inside(out.plan.bounds, { w: opts.maxW, h: Infinity }) ? out : null;
}
