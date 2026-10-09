/**
 * The progress card (2026-10-09, Phase 2 "parents recommend it"): one picture of a student's week —
 * "Maya's week · 42 problems this week · 5 days in a row · Times tables ✓" — that a parent posts or
 * texts to another parent. Parents recommend what they can show; this is the thing they show.
 *
 * This module is the card's LAYOUT, pure: the data and a text measurer in, a list of drawing
 * operations out (`CardOp`). No canvas, no DOM, no fonts: `renderCard.ts` measures with a real
 * canvas and draws the ops, and the tests measure with a fake. Every line of text is measured, so
 * a long name wraps or shrinks, a long skill is cut with an ellipsis, and nothing ever runs off the
 * card (`__tests__/card.test.ts` checks every op stays inside it).
 *
 * The look is the app's: a white board on Arc's flat grey, Geist for the numbers and
 * headings, Inter for the small words, and the tutor's own blue tick (`markStrokes`, the very mark
 * the board draws after a right line) beside the big number and each skill mastered.
 *
 * PRIVACY. The card shows a first name at most (`firstName`: one word, letters, never an address),
 * or none at all with `hideName`. It has no field for an email, a school or a surname, so none can
 * reach it.
 */
import { markStrokes } from "@/lib/live/marks";
import { firstName } from "@/lib/learning/progressView";
import { CARD_COPY } from "./copy";

// ------------------------------------------------------------------ the data

/** What the card says. `input.ts` builds it from looser page data (avatar ids, skill ids). */
export interface ShareCardData {
  /** the student's display name: only its first word is ever drawn, and never an email */
  name: string | null;
  /** the student's picture, an emoji (an AVATARS face); null draws their initial or a tick */
  avatar: string | null;
  /** "3rd grade", "Algebra 1"; null leaves it out */
  gradeLabel: string | null;
  /** problems worked on this week */
  problems: number;
  /** of those, solved without help */
  independent: number;
  /** days in a row with practice, ending today or yesterday */
  streak: number;
  /** names of skills mastered, newest first: the first 3 are drawn */
  mastered: string[];
  /** a line at the foot, e.g. a referral link; null shows the site's name */
  link: string | null;
}

export interface CardOptions {
  /** leave the name off the card (the grown-up's choice in the share sheet) */
  hideName?: boolean;
}

// ------------------------------------------------------------------ type and colour

export type CardFace = "display" | "body";

export interface CardFont {
  /** display: Geist (numbers, headings); body: Inter (small words) */
  face: CardFace;
  weight: number;
  /** px */
  size: number;
  /** letter spacing in em; negative tightens */
  tracking: number;
}

/** Width of `text` set in `font`, px. The renderer measures with its canvas; tests with a fake. */
export type MeasureText = (text: string, font: CardFont) => number;

/** Cap height as a share of the font size (Geist 0.71, Inter 0.727): how the layout places baselines. */
export const CAP_HEIGHT: Readonly<Record<CardFace, number>> = { display: 0.71, body: 0.727 };
/** Room under the baseline for descenders, as a share of the font size. */
const DESCENT = 0.22;

/** Arc's tokens as sRGB (src/registry/foundation.css), and the tutor's ink (palette blue, `TUTOR_INK_COLOR`). */
export const CARD_COLORS = {
  /** the frame round the board: --neutral-3 */
  ground: "#f1f1f1",
  board: "#ffffff",
  /** --foreground, --text-secondary, --text-muted */
  ink: "#0b0b0b",
  secondary: "#585858",
  muted: "#7d7d7d",
  /** a hairline: --border */
  rule: "#e9e9e9",
  /** the avatar's disc: --neutral-3 */
  disc: "#f1f1f1",
  /** the tutor's writing on the board (#4465e9) */
  tutor: "#4465e9",
} as const;

export const CARD_SIZE = { width: 1080, height: 1350 } as const;

// ------------------------------------------------------------------ the ops

export interface Point {
  x: number;
  y: number;
}

/** One thing to draw, in order. Text `y` is the baseline. */
export type CardOp =
  | { kind: "ground"; color: string }
  | { kind: "board"; x: number; y: number; w: number; h: number; radius: number; fill: string }
  | { kind: "disc"; cx: number; cy: number; r: number; color: string }
  | { kind: "emoji"; text: string; cx: number; cy: number; size: number }
  | { kind: "text"; text: string; x: number; y: number; font: CardFont; color: string; align: "left" | "right" | "center"; width: number }
  | { kind: "tick"; points: Point[]; lineWidth: number; color: string; x: number; y: number; w: number; h: number }
  | { kind: "rule"; x: number; y: number; w: number; color: string };

export interface CardLayout {
  width: number;
  height: number;
  ops: CardOp[];
  /** the name drawn on the card (null when hidden or unusable) */
  name: string | null;
  /** the card in one sentence: the preview's alt text and the share message */
  sentence: string;
}

// ------------------------------------------------------------------ text fitting

const chars = (text: string): string[] => Array.from(text);

/** `text` cut to fit `maxWidth`, with an ellipsis when anything was cut. */
export function ellipsize(text: string, maxWidth: number, font: CardFont, measure: MeasureText): string {
  if (measure(text, font) <= maxWidth) return text;
  const cs = chars(text);
  let lo = 0;
  let hi = cs.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${cs.slice(0, mid).join("").trimEnd()}…`, font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${cs.slice(0, lo).join("").trimEnd()}…`;
}

export interface Wrapped {
  lines: string[];
  /** a word longer than the line had to be broken */
  broken: boolean;
}

/**
 * Greedy word wrap; a word wider than the line is broken between characters. A "\n" in the text is
 * a line break the copy asks for ("Ready for\na new week").
 */
export function wrapText(text: string, maxWidth: number, font: CardFont, measure: MeasureText): Wrapped {
  const paragraphs = text.split("\n");
  if (paragraphs.length > 1) {
    const parts = paragraphs.map((p) => wrapText(p, maxWidth, font, measure));
    return { lines: parts.flatMap((p) => p.lines), broken: parts.some((p) => p.broken) };
  }
  const lines: string[] = [];
  let broken = false;
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, font) <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    if (measure(word, font) <= maxWidth) {
      line = word;
      continue;
    }
    broken = true;
    for (const ch of chars(word)) {
      if (!line || measure(line + ch, font) <= maxWidth) line += ch;
      else {
        lines.push(line);
        line = ch;
      }
    }
  }
  if (line) lines.push(line);
  return { lines, broken };
}

export interface Fitted {
  font: CardFont;
  lines: string[];
}

/**
 * The biggest size (of `sizes`, largest first) at which `text` fits `maxWidth` in the fewest lines,
 * up to `maxLines`, without breaking a word: one line at a smaller size beats two at a bigger one
 * (a name), unless `prefer` is "size" (a slogan set big over two lines). When nothing fits, the
 * smallest size, words broken, the last line cut with an ellipsis.
 */
export function fitText(
  text: string,
  base: Omit<CardFont, "size">,
  sizes: readonly number[],
  maxWidth: number,
  maxLines: number,
  measure: MeasureText,
  prefer: "lines" | "size" = "lines",
): Fitted {
  for (let n = prefer === "size" ? maxLines : 1; n <= maxLines; n++) {
    for (const size of sizes) {
      const font = { ...base, size };
      const { lines, broken } = wrapText(text, maxWidth, font, measure);
      if (!broken && lines.length <= n) return { font, lines };
    }
  }
  const font = { ...base, size: sizes[sizes.length - 1] };
  const { lines } = wrapText(text, maxWidth, font, measure);
  if (lines.length <= maxLines) return { font, lines };
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(lines.slice(maxLines - 1).join(" "), maxWidth, font, measure);
  return { font, lines: kept };
}

// ------------------------------------------------------------------ the tick

/**
 * The tutor's tick (`markStrokes("check")`, the board's own mark with its seeded wobble), fitted
 * into a box `w` × `h` at (`x`, `y`).
 */
export function tickPoints(x: number, y: number, w: number, h: number, seed: number): Point[] {
  const [stroke] = markStrokes("check", { x: 0, y: 0, w: 0, h: 50 }, seed);
  const pts = stroke?.points ?? [];
  if (pts.length === 0) return [];
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const sx = w / Math.max(1e-6, maxX - minX);
  const sy = h / Math.max(1e-6, maxY - minY);
  return pts.map((p) => ({ x: x + (p.x - minX) * sx, y: y + (p.y - minY) * sy }));
}

function tick(x: number, y: number, h: number, seed: number): Extract<CardOp, { kind: "tick" }> {
  const w = h * 0.9;
  return { kind: "tick", points: tickPoints(x, y, w, h, seed), lineWidth: Math.max(3, h * 0.11), color: CARD_COLORS.tutor, x, y, w, h };
}

// ------------------------------------------------------------------ helpers

/** A count as the card shows it: a whole number, never negative, "1,234". */
export function cardCount(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

const formatCount = (n: number) => n.toLocaleString("en-US");

/** The name the card may show: the first word of a display name, or null (hidden, an address, no letters). */
export function cardName(data: Pick<ShareCardData, "name">, opts: CardOptions = {}): string | null {
  return opts.hideName ? null : firstName(data.name);
}

/** "agathon.app/?ref=K7M2QX" from "https://agathon.app/?ref=K7M2QX": the link as a person reads it. */
export function displayLink(link: string): string {
  return link.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The card in one sentence, for the preview's alt text and the share message. */
export function cardSentence(data: ShareCardData, opts: CardOptions = {}): string {
  const name = cardName(data, opts);
  const problems = cardCount(data.problems);
  const independent = Math.min(cardCount(data.independent), problems);
  const streak = cardCount(data.streak);
  const mastered = data.mastered.filter((s) => s.trim()).slice(0, 3);
  const parts: string[] = [problems > 0 ? `${formatCount(problems)} ${CARD_COPY.problems(problems)}` : CARD_COPY.fresh.replace(/\s+/g, " ").toLowerCase()];
  if (problems > 0 && independent > 0) parts.push(`${formatCount(independent)} ${CARD_COPY.independent}`);
  if (streak >= 2) parts.push(`${formatCount(streak)} ${CARD_COPY.streak}`);
  let sentence = `${CARD_COPY.title(name)}: ${parts.join(", ")}.`;
  if (mastered.length > 0) sentence += ` ${CARD_COPY.mastered}: ${listNames(mastered)}.`;
  return sentence;
}

// ------------------------------------------------------------------ the layout

/** The frame round the board, the band under it for the brand, and the board's padding. */
const FRAME = 48;
const FOOT = 132;
const PAD = 80;
const DISC_R = 60;
/** gaps between the sections under the header: at least, and at most */
const GAP_MIN = 60;
const GAP_MAX = 150;
/** the hero's tick, as a share of the number's cap height (the board's is 0.8 of a line; a big number needs less) */
const HERO_TICK = 0.66;
const HERO_SIZES = [300, 280, 260, 240, 220, 200, 180, 160, 140] as const;
/** the "fresh week" line's sizes, when the week has no problem yet */
const FRESH_SIZES = [136, 128, 120, 112, 104, 96, 88, 80, 72] as const;
/** the title's sizes: a 30-letter name still fits a line at the smallest */
const TITLE_SIZES = [64, 60, 56, 52, 48, 44, 40, 36] as const;

interface Block {
  height: number;
  /** draws the block with its top at `top` */
  place: (top: number) => CardOp[];
  /** a hairline above it, in the middle of the gap */
  ruled: boolean;
}

/**
 * The card's drawing operations, for `data` measured with `measure`. 1080 × 1350 (4:5, the portrait
 * size social apps show whole). Top to bottom: the avatar, the name's week and the grade; the week's
 * problems, big, with the tutor's tick; the problems solved without help and the streak; up to three
 * skills mastered, each ticked; and under the board the brand and the link.
 */
export function layoutShareCard(data: ShareCardData, measure: MeasureText, opts: CardOptions = {}): CardLayout {
  const { width, height } = CARD_SIZE;
  const name = cardName(data, opts);
  const problems = cardCount(data.problems);
  const independent = Math.min(cardCount(data.independent), problems);
  const streak = cardCount(data.streak);
  const mastered = data.mastered.map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const C = CARD_COLORS;
  const D = CAP_HEIGHT.display;
  const B = CAP_HEIGHT.body;

  const board = { x: FRAME, y: FRAME, w: width - 2 * FRAME, h: height - FRAME - FOOT };
  const left = board.x + PAD;
  const right = board.x + board.w - PAD;
  const W = right - left;
  const top = board.y + PAD;
  const bottom = board.y + board.h - PAD;

  const ops: CardOp[] = [
    { kind: "ground", color: C.ground },
    { kind: "board", x: board.x, y: board.y, w: board.w, h: board.h, radius: 56, fill: C.board },
  ];

  // ---- header: the avatar's disc, the title and the grade beside it
  const discCx = left + DISC_R;
  const discCy = top + DISC_R;
  ops.push({ kind: "disc", cx: discCx, cy: discCy, r: DISC_R, color: C.disc });
  const avatar = data.avatar?.trim() || null;
  if (avatar) ops.push({ kind: "emoji", text: avatar, cx: discCx, cy: discCy + 2, size: 66 });
  else if (name) {
    const font: CardFont = { face: "display", weight: 600, size: 56, tracking: -0.02 };
    const initial = chars(name)[0].toLocaleUpperCase("en-US");
    ops.push({ kind: "text", text: initial, x: discCx, y: discCy + (D * font.size) / 2, font, color: C.tutor, align: "center", width: measure(initial, font) });
  } else ops.push(tick(discCx - 24, discCy - 26, 52, 7));

  const textX = left + 2 * DISC_R + 32;
  const textW = right - textX;
  const title = fitText(CARD_COPY.title(name), { face: "display", weight: 600, tracking: -0.03 }, TITLE_SIZES, textW, 2, measure);
  const titleLh = title.font.size * 1.1;
  const subFont: CardFont = { face: "body", weight: 500, size: 30, tracking: -0.01 };
  const sub = data.gradeLabel?.trim() ? ellipsize(data.gradeLabel.trim(), textW, subFont, measure) : null;
  const titleBox = (title.lines.length - 1) * titleLh + D * title.font.size;
  const blockH = titleBox + (sub ? 20 + B * subFont.size : 0);
  const blockTop = Math.max(top, discCy - blockH / 2);
  title.lines.forEach((line, i) => {
    ops.push({ kind: "text", text: line, x: textX, y: blockTop + D * title.font.size + i * titleLh, font: title.font, color: C.ink, align: "left", width: measure(line, title.font) });
  });
  if (sub) ops.push({ kind: "text", text: sub, x: textX, y: blockTop + blockH, font: subFont, color: C.secondary, align: "left", width: measure(sub, subFont) });
  const headerBottom = Math.max(discCy + DISC_R, blockTop + blockH + DESCENT * subFont.size);

  // ---- the stats under the hero: solved without help, days in a row
  const cells: { value: string; label: string }[] = [];
  if (problems > 0 && independent > 0) cells.push({ value: formatCount(independent), label: CARD_COPY.independent });
  if (streak >= 2) cells.push({ value: formatCount(streak), label: CARD_COPY.streak });
  const blocks: Block[] = [];
  const statsBlock = (): Block | null => {
    if (cells.length === 0) return null;
    const gutter = 48;
    const cellW = (W - gutter * (cells.length - 1)) / cells.length;
    const valueFonts = cells.map((c) => fitText(c.value, { face: "display", weight: 700, tracking: -0.04 }, [108, 96, 84, 72], cellW, 1, measure));
    const labelFont: CardFont = { face: "body", weight: 500, size: 30, tracking: -0.01 };
    const labels = cells.map((c) => fitText(c.label, labelFont, [30, 28, 26], cellW, 2, measure));
    const valueCap = Math.max(...valueFonts.map((v) => D * v.font.size));
    const labelLh = 38;
    const lines = Math.max(...labels.map((l) => l.lines.length));
    const h = valueCap + 24 + B * labelFont.size + (lines - 1) * labelLh + DESCENT * labelFont.size;
    return {
      height: h,
      ruled: true,
      place: (y) =>
        cells.flatMap((_, i): CardOp[] => {
          const x = left + i * (cellW + gutter);
          const v = valueFonts[i];
          const base = y + valueCap;
          return [
            { kind: "text", text: v.lines[0], x, y: base, font: v.font, color: C.ink, align: "left", width: measure(v.lines[0], v.font) },
            ...labels[i].lines.map((line, j): CardOp => ({ kind: "text", text: line, x, y: base + 24 + B * labels[i].font.size + j * labelLh, font: labels[i].font, color: C.secondary, align: "left", width: measure(line, labels[i].font) })),
          ];
        }),
    };
  };

  // ---- skills mastered: an eyebrow, then each skill as a line the tutor ticked
  const masteredBlock = (): Block | null => {
    if (mastered.length === 0) return null;
    const eyebrow: CardFont = { face: "body", weight: 600, size: 24, tracking: 0.14 };
    const rowFont: CardFont = { face: "display", weight: 500, size: 44, tracking: -0.02 };
    const tickH = 34;
    const tickGap = 22;
    const pitch = 66;
    const rows = mastered.map((skill) => ellipsize(skill, W - tickGap - tickH, rowFont, measure));
    const firstBase = B * eyebrow.size + 36 + D * rowFont.size;
    return {
      height: firstBase + (rows.length - 1) * pitch + DESCENT * rowFont.size,
      ruled: true,
      place: (y) => {
        const label = CARD_COPY.mastered.toUpperCase();
        const out: CardOp[] = [{ kind: "text", text: label, x: left, y: y + B * eyebrow.size, font: eyebrow, color: C.muted, align: "left", width: measure(label, eyebrow) }];
        rows.forEach((row, i) => {
          const base = y + firstBase + i * pitch;
          const w = measure(row, rowFont);
          out.push({ kind: "text", text: row, x: left, y: base, font: rowFont, color: C.ink, align: "left", width: w });
          // centred on the line's capitals, as the board centres a tick on the line it marks
          out.push(tick(left + w + tickGap, base - (D * rowFont.size) / 2 - tickH / 2, tickH, 101 + i));
        });
        return out;
      },
    };
  };

  // ---- the hero: the week's problems, big, ticked; or, with none, a fresh start
  const heroBlock = (size: number): Block => {
    if (problems > 0) {
      const numFont: CardFont = { face: "display", weight: 700, size, tracking: -0.05 };
      const cap = D * size;
      const tickH = cap * HERO_TICK;
      const gap = size * 0.1;
      const numText = formatCount(problems);
      // a number too wide for the line (a big week at a big size) is set smaller by the caller
      const numW = measure(numText, numFont);
      const labelFont: CardFont = { face: "display", weight: 500, size: 54, tracking: -0.025 };
      const label = ellipsize(CARD_COPY.problems(problems), W, labelFont, measure);
      // a thousands comma hangs below the baseline: the label keeps clear of it
      const hang = numText.includes(",") ? size * 0.16 : 0;
      const labelBase = cap + hang + 30 + size * 0.06 + D * labelFont.size;
      return {
        height: labelBase + DESCENT * labelFont.size,
        ruled: false,
        place: (y) => [
          { kind: "text", text: numText, x: left, y: y + cap, font: numFont, color: C.ink, align: "left", width: numW },
          tick(left + numW + gap, y + (cap - tickH) / 2 - cap * 0.04, tickH, 42),
          { kind: "text", text: label, x: left, y: y + labelBase, font: labelFont, color: C.ink, align: "left", width: measure(label, labelFont) },
        ],
      };
    }
    // set big over two lines, with room kept for the tick after the last
    const fitted = fitText(CARD_COPY.fresh, { face: "display", weight: 650, tracking: -0.04 }, FRESH_SIZES, W * 0.78, 2, measure, "size");
    const lh = fitted.font.size * 1.04;
    const cap = D * fitted.font.size;
    const last = fitted.lines[fitted.lines.length - 1];
    const lastW = measure(last, fitted.font);
    // a line's tick, as the board draws one (0.8 of the line's height)
    const tickH = cap * 0.8;
    const tickRoom = lastW + fitted.font.size * 0.18 + tickH * 0.9 <= W;
    return {
      height: (fitted.lines.length - 1) * lh + cap + DESCENT * fitted.font.size,
      ruled: false,
      place: (y) => [
        ...fitted.lines.map((line, i): CardOp => ({ kind: "text", text: line, x: left, y: y + cap + i * lh, font: fitted.font, color: C.ink, align: "left", width: measure(line, fitted.font) })),
        ...(tickRoom ? [tick(left + lastW + fitted.font.size * 0.18, y + (fitted.lines.length - 1) * lh + (cap - tickH) / 2, tickH, 42)] : []),
      ],
    };
  };

  const rest = [statsBlock(), masteredBlock()].filter((b): b is Block => b !== null);
  const space = bottom - headerBottom;
  // the biggest hero whose number fits the line beside its tick, and whose page fits the board
  let hero = heroBlock(HERO_SIZES[HERO_SIZES.length - 1]);
  for (const size of HERO_SIZES) {
    const candidate = heroBlock(size);
    const numFits = problems === 0 || measure(formatCount(problems), { face: "display", weight: 700, size, tracking: -0.05 }) + size * 0.1 + D * size * HERO_TICK * 0.9 <= W;
    const total = candidate.height + rest.reduce((n, b) => n + b.height, 0) + GAP_MIN * (rest.length + 1);
    if (numFits && total <= space) {
      hero = candidate;
      break;
    }
  }
  blocks.push(hero, ...rest);

  // a gap above each section, growing with the room (up to GAP_MAX), so the last one ends at the
  // board's padding; a short card shares what is left over above and below
  const used = blocks.reduce((n, b) => n + b.height, 0);
  const gap = Math.max(GAP_MIN, Math.min(GAP_MAX, (space - used) / blocks.length));
  const extra = Math.max(0, space - used - gap * blocks.length);
  let y = headerBottom + gap + extra / 2;
  for (const block of blocks) {
    if (block.ruled) ops.push({ kind: "rule", x: left, y: Math.round(y - gap / 2), w: W, color: C.rule });
    ops.push(...block.place(y));
    y += block.height + gap;
  }

  // ---- under the board: the brand, and the link (or the site)
  const footY = board.y + board.h + FOOT / 2;
  const brandFont: CardFont = { face: "display", weight: 600, size: 40, tracking: -0.03 };
  const brandTickH = 28;
  ops.push(tick(left, footY - brandTickH / 2 - 2, brandTickH, 5));
  const brandX = left + brandTickH * 0.9 + 14;
  const brandW = measure(CARD_COPY.brand, brandFont);
  ops.push({ kind: "text", text: CARD_COPY.brand, x: brandX, y: footY + (D * brandFont.size) / 2, font: brandFont, color: C.ink, align: "left", width: brandW });
  const linkText = data.link?.trim() ? displayLink(data.link) : CARD_COPY.site;
  const linkRoom = right - (brandX + brandW + 40);
  const link = fitText(linkText, { face: "body", weight: 500, tracking: -0.01 }, [28, 26, 24, 22], linkRoom, 1, measure);
  const linkLine = ellipsize(link.lines.join(" "), linkRoom, link.font, measure);
  ops.push({ kind: "text", text: linkLine, x: right, y: footY + (B * link.font.size) / 2, font: link.font, color: C.secondary, align: "right", width: measure(linkLine, link.font) });

  return { width, height, ops, name, sentence: cardSentence(data, opts) };
}
