import type { VisualModel } from "../contracts";
import { counter, fillRect, handRect, measureLabel, MODEL_INK, MODEL_TEXT, ModelInk, numLatex, solid, type LabelSize, type ModelSketch } from "./kit";
import { decimalsOf } from "./maths";

/**
 * A place-value chart as a teacher draws one: the number written big above it (`3,405.27`), then a
 * table — a header row naming each place, lightly coloured in (the whole places one colour, the
 * decimal places another), and under each name the number's digit in that place, worked out by the
 * board. A decimal number has a narrow column for its point. The places shown are the number's own
 * (at least tens and ones for a whole number, ones for a decimal); a header too long for the board
 * is shortened (Thousands → Th; tenths → 1/10).
 */

type PlaceValue = Extract<VisualModel, { kind: "place_value" }>;

export const PLACE_VALUE = {
  /** a digit in its cell (written big: the digits are the point) */
  digit: 44,
  digitMin: 30,
  /** the number above the chart, and the gap under it */
  number: 44,
  numberGap: 18,
  /** px round a header's words and a digit inside their cells, across and down */
  padX: 11,
  padY: 14,
  /** the decimal point's own column */
  pointW: 26,
  inset: 4,
} as const;

const WHOLE = ["Ones", "Tens", "Hundreds", "Thousands", "Ten Thousands", "Hundred Thousands", "Millions"];
const WHOLE_SHORT = ["O", "T", "H", "Th", "TTh", "HTh", "M"];
const DECIMAL = ["Tenths", "Hundredths", "Thousandths"];
const DECIMAL_SHORT = ["\\frac{1}{10}", "\\frac{1}{100}", "\\frac{1}{1000}"];

interface Column {
  header: string;
  /** a header in two lines ("Ten / Thousands") when it is two words */
  lines: string[];
  digit: string;
  decimal: boolean;
}

function columnsOf(value: number, short: boolean): Column[] {
  const decimals = Math.min(3, decimalsOf(value));
  const fixed = value.toFixed(decimals);
  const [int, dec = ""] = fixed.split(".");
  const wholeCols = Math.max(int.length, decimals > 0 ? 1 : 2);
  const digits = int.padStart(wholeCols, " ");
  const out: Column[] = [];
  for (let i = 0; i < wholeCols; i++) {
    const place = wholeCols - 1 - i;
    const header = short ? WHOLE_SHORT[place] : WHOLE[place];
    out.push({ header, lines: short ? [header] : header.split(" "), digit: digits[i].trim(), decimal: false });
  }
  for (let i = 0; i < decimals; i++) out.push({ header: short ? DECIMAL_SHORT[i] : DECIMAL[i], lines: [short ? DECIMAL_SHORT[i] : DECIMAL[i]], digit: dec[i], decimal: true });
  return out;
}

function attempt(spec: PlaceValue, box: { w: number; h: number }, seed: number, short: boolean, headSize: number, digitSize: number): ModelSketch | null {
  const P = PLACE_VALUE;
  const cols = columnsOf(spec.value, short);
  const decimals = cols.filter((c) => c.decimal).length;
  const heads: LabelSize[][] = [];
  for (const c of cols) {
    const ls = c.lines.map((l) => measureLabel(l, headSize));
    if (ls.some((l) => !l)) return null;
    heads.push(ls as LabelSize[]);
  }
  const digitM = measureLabel("8", digitSize);
  const numberText = numLatex(spec.value).replace(/\.(\d*)$/, (_, d: string) => `.${d.padEnd(decimals, "0")}`);
  const numberM = measureLabel(numberText, Math.min(P.number, digitSize));
  if (!digitM || !numberM) return null;
  const colW = Math.max(...heads.map((ls) => Math.max(...ls.map((l) => l.w))), digitM.w) + 2 * P.padX;
  const headH = Math.max(...heads.map((ls) => ls.reduce((a, l) => a + l.h, 0) + (ls.length - 1) * 8)) + 2 * P.padY;
  const rowH = digitM.h + 2 * P.padY + 8;
  const width = cols.length * colW + (decimals > 0 ? P.pointW : 0);
  const top = numberM.h + P.numberGap;
  if (width > box.w - 8 || top + headH + rowH > box.h - 8) return null;

  const ink = new ModelInk(seed);
  // the number itself, above the chart
  ink.label("number", numberText, { x: width / 2, y: 0 }, "center", "top", Math.min(P.number, digitSize));
  // each column's left edge (the point's own narrow column after the ones)
  const xs: number[] = [];
  let x = 0;
  cols.forEach((c, i) => {
    if (c.decimal && (i === 0 || !cols[i - 1].decimal)) x += P.pointW;
    xs.push(x);
    x += colW;
  });
  const y0 = top;
  ink.draw("table", (pen) => handRect(pen, { x: 0, y: y0, w: width, h: headH + rowH }));
  ink.draw("table:rule", (pen) => pen.line({ x: 0, y: y0 + headH }, { x: width, y: y0 + headH }));
  ink.draw("table:columns", (pen) => {
    const edges: number[] = [];
    xs.forEach((cx, i) => {
      if (i > 0) edges.push(cx);
      if (cols[i].decimal && i > 0 && !cols[i - 1].decimal) edges.push(cx - P.pointW);
    });
    return edges.flatMap((ex) => pen.line({ x: ex, y: y0 }, { x: ex, y: y0 + headH + rowH }));
  });
  cols.forEach((c, i) => {
    const cell = { x: xs[i], y: y0, w: colW, h: headH };
    ink.fill(`head:${i}:fill`, (pen) => fillRect(pen, cell, P.inset), c.decimal ? "orange" : "light-blue");
    const ls = heads[i];
    const total = ls.reduce((a, l) => a + l.h, 0) + (ls.length - 1) * 8;
    let ly = y0 + (headH - total) / 2;
    c.lines.forEach((line, k) => {
      ink.label(`head:${i}:${k}`, line, { x: xs[i] + colW / 2, y: ly }, "center", "top", headSize);
      ly += ls[k].h + 8;
    });
  });
  if (decimals > 0) {
    const ones = cols.findIndex((c) => c.decimal);
    const px = xs[ones] - P.pointW / 2;
    const baseline = y0 + headH + rowH / 2 + digitM.h / 2 - 3;
    ink.draw("point", (pen) => counter(pen, { x: px, y: baseline }, 4.5), solid(MODEL_INK));
  }
  cols.forEach((c, i) => {
    if (!c.digit) return;
    ink.label(`digit:${i}`, c.digit, { x: xs[i] + colW / 2, y: y0 + headH + rowH / 2 }, "center", "middle", digitSize);
  });
  const expected = 1 + cols.reduce((a, c) => a + c.lines.length + (c.digit ? 1 : 0), 0);
  if (ink.texts.length !== expected) return null;
  return ink.finish(box);
}

export function planPlaceValue(spec: PlaceValue, box: { w: number; h: number }, seed: number): ModelSketch | null {
  const P = PLACE_VALUE;
  for (const short of [false, true]) {
    for (let k = 0; k <= 3; k++) {
      const head = Math.max(MODEL_TEXT.wordsMin, (short ? MODEL_TEXT.label : 30) - 2 * k);
      const digit = Math.max(P.digitMin, P.digit - 4 * k);
      const s = attempt(spec, box, seed, short, head, digit);
      if (s) return s;
    }
  }
  return null;
}
