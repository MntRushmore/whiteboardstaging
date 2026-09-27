/**
 * Statistics of a list of data (S-ID.2–3), worked the way an Algebra 1 teacher works them. The
 * student writes the data, then asks for a statistic by name:
 *
 *   12, 3, 15, 7, 8        3, 7, 8, 12, 15, 20      3, 7, 8, 12, 15
 *   \text{median} = ?      IQR = ?                  \sigma = ?
 *   3, 7, 8, 12, 15        Q_{1} = 7                \bar{x} = \frac{3 + 7 + 8 + 12 + 15}{5}
 *   \text{median} = 8      Q_{3} = 15               \bar{x} = 9
 *                          IQR = Q_{3} - Q_{1}      \sigma = \sqrt{\frac{(3 - 9)^{2} + … + (15 - 9)^{2}}{5}}
 *                          IQR = 15 - 7             \sigma = \sqrt{\frac{36 + 4 + 1 + 9 + 36}{5}}
 *                          IQR = 8                  \sigma = \sqrt{\frac{86}{5}}
 *                                                   \sigma \approx 4.15
 *
 * The names: the mean (`\bar{x}`, `\mu`, `\text{mean}`), the median (`\text{median}`,
 * `\operatorname{med}`, `Q_{2}`, `\tilde{x}`), the mode, the range, `Q_{1}`, `Q_{3}`, `IQR`, the
 * five-number summary, the standard deviation (`\sigma`, `s`, `\text{SD}`, `\text{standard
 * deviation}`) — asked with `= ?` or `=`, a word also alone on its line, in any case. A word is
 * the student's own label and the answer line repeats it (`\text{median} = 8`); the tutor adds no
 * word of its own, only the standard symbols (`Q_{1}`, `Q_{2}`, `Q_{3}`, `\bar{x}`, `\sigma`, `s`).
 *
 * CONVENTIONS (also in `docs/eval/courses.md`):
 *  - quartiles: the median of each half of the sorted data, the median itself in neither half
 *    when n is odd — the TI-84's 1-Var Stats and most US Algebra 1 texts. A student's quartile by
 *    another common method (the median in both halves; a spreadsheet's interpolation) is left
 *    unmarked, never ringed.
 *  - standard deviation: `\sigma` is the population's (÷ n), `s` the sample's (÷ (n − 1)); a
 *    name that does not say which (`\text{SD}`, `\text{standard deviation}`) is the population's,
 *    and a student's sample value under it is left unmarked.
 *  - mode: every most frequent value (`3, \ 7`); no value repeated is `\varnothing`; every value
 *    repeated equally often (`2, 2, 5, 5`) is not answered — texts disagree.
 *  - numbers exact: a median of two middle values is a short decimal (`7.5`); a standard
 *    deviation that is not exact is rounded to 2 places, with ≈.
 *
 * A data list is 3 to 30 numbers separated by commas (in braces or not): never with `\ldots` (a
 * sequence — `sequences.ts`), a letter (points, `x = 2, 3`) or a bracket. Every answer is
 * recomputed from the data in floating point before it is written. The student's own lines are
 * checked too (`statisticsAnalysis`): the data sorted is `ok`, a claim (`Q_{1} = 5`, `\sigma
 * \approx 4.15`) `ok` or `mismatch`; the lines about a list carry it (their `math` is the list)
 * so a claim three lines down still knows the data.
 */
import type { AnalyzeContext, EngineVerdict, LineAnalysis } from "../contracts";
import { q, qAdd, qDiv, qMul, qNeg, type Q } from "./algebra";
import { evalLatex, type CourseDeps } from "./courseKit";
import { exactly, qFromNumber, qNum, qSub } from "./poly";
import { LIST_SEP, NO_SOLUTION, StepWriter } from "./solution";

type Stat = "mean" | "median" | "mode" | "range" | "q1" | "q3" | "iqr" | "five" | "sigma" | "s" | "sd";

export interface StatName {
  stat: Stat;
  /** the name as the answer line writes it: the student's own word, or the standard symbol */
  label: string;
  /** the student's word (a label), not a symbol */
  word: boolean;
}

export interface Data {
  values: Q[];
  /** each value as the student wrote it */
  texts: string[];
  /** written in decimals: the answers are too */
  decimals: boolean;
}

interface Solved {
  latex: string;
  steps: string[];
}

// ---------------------------------------------------------------- numbers

const qTex = (a: Q): string => (a.d === 1 ? String(a.n) : `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`);
const same = (a: Q, b: Q): boolean => a.n === b.n && a.d === b.d;
const compare = (a: Q, b: Q): number => a.n * b.d - b.n * a.d;

/** `a` as a terminating decimal with at most `places` places (`7.5`, `-3.25`), or null. */
function decimalTex(a: Q, places: number): string | null {
  let d = a.d;
  let k2 = 0;
  let k5 = 0;
  while (d % 2 === 0) {
    d /= 2;
    k2++;
  }
  while (d % 5 === 0) {
    d /= 5;
    k5++;
  }
  const k = Math.max(k2, k5);
  if (d !== 1 || k > places) return null;
  const scaled = Math.abs(a.n) * (10 ** k / a.d);
  if (!Number.isSafeInteger(scaled)) return null;
  const digits = String(scaled).padStart(k + 1, "0");
  const body = k === 0 ? digits : `${digits.slice(0, -k)}.${digits.slice(-k)}`;
  return `${a.n < 0 ? "-" : ""}${body}`;
}

/** A statistic as a teacher writes it: whole, a short decimal (`7.5`), else an exact fraction. */
function statTex(a: Q, data: Data): string {
  if (a.d === 1) return String(a.n);
  return decimalTex(a, data.decimals ? 4 : 2) ?? qTex(a);
}

/** Inside a longer line: `(-3)`. */
const signed = (tex: string): string => (tex.startsWith("-") ? `(${tex})` : tex);

/** `2.5`, `-3`, `\frac{1}{2}` → an exact rational; null for anything else. */
function numberQ(text: string): Q | null {
  const t = text.replace(/\s+/g, "");
  const dec = /^(-?)(\d*)(?:\.(\d{1,6}))?$/.exec(t);
  if (dec && (dec[2] || dec[3])) {
    const places = dec[3]?.length ?? 0;
    const n = Number(dec[2] || "0") * 10 ** places + Number(dec[3] || "0");
    return exactly(() => q(dec[1] ? -n : n, 10 ** places));
  }
  const frac = /^(-?)\\[dt]?frac\{(\d+)\}\{(\d+)\}$/.exec(t);
  if (frac) return exactly(() => q((frac[1] ? -1 : 1) * Number(frac[2]), Number(frac[3])));
  return null;
}

// ---------------------------------------------------------------- the data

const ELLIPSIS = /\\(?:ldots|cdots|dots[a-z]*)|\.\.\.|…/;

/** `3, 7, 8, 12, 15`, `\{3, 7, 8\}`, `\left\{2.5, 3, 4\right\}` → the data; null for anything else. */
export function dataListOf(latex: string): Data | null {
  if (!latex || ELLIPSIS.test(latex)) return null;
  const s = latex
    .replace(/\\left\s*(?:\\\{|\\lbrace)|\\right\s*(?:\\\}|\\rbrace)/g, " ")
    .replace(/\\\{|\\\}|\\lbrace|\\rbrace/g, " ")
    .replace(/\\[,;:! ]|\\q?quad|~/g, " ")
    .trim();
  const parts = s.split(",").map((p) => p.trim());
  if (parts.length < 3 || parts.length > 30) return null;
  const values: Q[] = [];
  for (const p of parts) {
    const v = numberQ(p);
    if (!v) return null;
    values.push(v);
  }
  return { values, texts: parts.map((p) => p.replace(/\s+/g, " ")), decimals: parts.some((p) => /\./.test(p)) };
}

/** What a line about a list carries in its `math`: the list, exactly (`3, 7, 1 / 2`). */
function carry(data: Data): string {
  return data.values.map((v) => (v.d === 1 ? String(v.n) : (decimalTex(v, 6) ?? `${v.n} / ${v.d}`))).join(", ");
}

/**
 * The data an analysed line above is about: a data list's own analysis (its `math` is the list,
 * `3, 7, 8, 12, 15`, as the translator wrote it), or a statistic line's (the list it carries).
 */
function dataOfAnalysis(deps: CourseDeps, a: LineAnalysis | undefined): Data | null {
  if (!a || !a.math || (a.kind !== "expression" && a.kind !== "equation")) return null;
  let s = a.math.trim();
  // `\{3, 7, 8\}` reads as `(3, 7, 8)`
  if (/^\(.*\)$/.test(s) && !/[()]/.test(s.slice(1, -1))) s = s.slice(1, -1);
  if (!s.includes(",") || /[a-zA-Z=<>[\]]/.test(s)) return null;
  const parts = s.split(",").map((p) => p.trim());
  if (parts.length < 3 || parts.length > 30) return null;
  const values: Q[] = [];
  const texts: string[] = [];
  for (const p of parts) {
    if (!/^[-+*/().\d\s]+$/.test(p)) return null;
    let v: unknown;
    try {
      v = deps.math.evaluate(p);
    } catch {
      return null;
    }
    const exact = typeof v === "number" && Number.isFinite(v) ? qFromNumber(v) : null;
    if (!exact) return null;
    values.push(exact);
    texts.push(exact.d === 1 ? String(exact.n) : (decimalTex(exact, 6) ?? qTex(exact)));
  }
  return { values, texts, decimals: /\d\.\d/.test(s) };
}

function dataFromContext(deps: CourseDeps, ctx: AnalyzeContext): Data | null {
  return dataOfAnalysis(deps, ctx.previous) ?? dataOfAnalysis(deps, ctx.original);
}

function sortedIndex(data: Data): number[] {
  return data.values.map((_, i) => i).sort((i, j) => compare(data.values[i], data.values[j]) || i - j);
}

function sortedData(data: Data): Data {
  const order = sortedIndex(data);
  return { values: order.map((i) => data.values[i]), texts: order.map((i) => data.texts[i]), decimals: data.decimals };
}

const isSorted = (values: readonly Q[], dir: 1 | -1 = 1): boolean => values.every((v, i) => i === 0 || dir * compare(values[i - 1], v) <= 0);

function sameValues(a: readonly Q[], b: readonly Q[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort(compare);
  const y = [...b].sort(compare);
  return x.every((v, i) => same(v, y[i]));
}

// ---------------------------------------------------------------- the statistics

const sumOf = (values: readonly Q[]): Q => values.reduce((s, v) => qAdd(s, v), q(0));

function medianOf(sorted: readonly Q[]): Q {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[m] : qDiv(qAdd(sorted[m - 1], sorted[m]), q(2));
}

/** Q1 and Q3 by the other common methods (for a student's claim: not ringed if it is one of these). */
function otherQuartiles(sorted: readonly Q[]): Array<[number, number]> {
  const n = sorted.length;
  const x = sorted.map(qNum);
  const med = (arr: number[]) => (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2);
  // the median in both halves (Tukey's hinges)
  const hinges: [number, number] = [med(x.slice(0, Math.ceil(n / 2))), med(x.slice(Math.floor(n / 2)))];
  // a spreadsheet's interpolation: position (n − 1)p and (n + 1)p − 1, counted from 0
  const at = (pos: number) => {
    const p = Math.min(Math.max(pos, 0), n - 1);
    const lo = Math.floor(p);
    return x[lo] + (p - lo) * ((x[Math.min(lo + 1, n - 1)] ?? x[lo]) - x[lo]);
  };
  const inclusive: [number, number] = [at((n - 1) * 0.25), at((n - 1) * 0.75)];
  const exclusive: [number, number] = [at((n + 1) * 0.25 - 1), at((n + 1) * 0.75 - 1)];
  return [hinges, inclusive, exclusive];
}

/** Every most frequent value, ascending; [] when none repeats; null when every value repeats equally. */
function modesOf(values: readonly Q[]): Q[] | null {
  const counts: Array<{ v: Q; n: number }> = [];
  for (const v of values) {
    const c = counts.find((e) => same(e.v, v));
    if (c) c.n++;
    else counts.push({ v, n: 1 });
  }
  const top = Math.max(...counts.map((c) => c.n));
  if (top === 1) return [];
  if (counts.length > 1 && counts.every((c) => c.n === top)) return null;
  return counts
    .filter((c) => c.n === top)
    .map((c) => c.v)
    .sort(compare);
}

/** √v exactly, when v is the square of a rational. */
function exactRoot(v: Q): Q | null {
  const rn = Math.round(Math.sqrt(v.n));
  const rd = Math.round(Math.sqrt(v.d));
  return v.n >= 0 && rn * rn === v.n && rd * rd === v.d ? q(rn, rd) : null;
}

/** The same statistic in floating point, straight from the data (the self-check). */
function floatStat(stat: Stat, values: readonly Q[]): number | null {
  const x = values.map(qNum).sort((a, b) => a - b);
  const n = x.length;
  const med = (arr: number[]) => (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2);
  const mean = x.reduce((a, b) => a + b, 0) / n;
  const q1 = med(x.slice(0, Math.floor(n / 2)));
  const q3 = med(x.slice(Math.ceil(n / 2)));
  const ss = x.reduce((a, b) => a + (b - mean) ** 2, 0);
  switch (stat) {
    case "mean":
      return mean;
    case "median":
      return med(x);
    case "range":
      return x[n - 1] - x[0];
    case "q1":
      return q1;
    case "q3":
      return q3;
    case "iqr":
      return q3 - q1;
    case "sigma":
    case "sd":
      return Math.sqrt(ss / n);
    case "s":
      return Math.sqrt(ss / (n - 1));
    default:
      return null;
  }
}

/** The modes, or the five-number summary, in floating point straight from the data (the self-check). */
function floatList(stat: Stat, values: readonly Q[]): number[] | null {
  const x = values.map(qNum).sort((a, b) => a - b);
  if (stat === "five") {
    const at = (s: Stat) => floatStat(s, values) ?? NaN;
    return [x[0], at("q1"), at("median"), at("q3"), x[x.length - 1]];
  }
  if (stat !== "mode") return null;
  const counts = new Map<number, number>();
  for (const v of x) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  if (top === 1) return [];
  if (counts.size > 1 && [...counts.values()].every((c) => c === top)) return null;
  return [...counts.entries()].filter(([, c]) => c === top).map(([v]) => v);
}

// ---------------------------------------------------------------- names

const WORDS: ReadonlyArray<[RegExp, Stat]> = [
  [/^(?:median|med)$/, "median"],
  [/^mode$/, "mode"],
  [/^range$/, "range"],
  [/^(?:iqr|interquartilerange)$/, "iqr"],
  [/^(?:lowerquartile|firstquartile|q1)$/, "q1"],
  [/^(?:upperquartile|thirdquartile|q3)$/, "q3"],
  [/^q2$/, "median"],
  [/^(?:five|5)numbersummary$/, "five"],
  [/^(?:mean|average|avg)$/, "mean"],
  [/^populationstandarddeviation$/, "sigma"],
  [/^samplestandarddeviation$/, "s"],
  [/^(?:sd|stdev|stddev|standarddeviation)$/, "sd"],
];

const SYMBOLS: ReadonlyArray<[RegExp, Stat, (m: RegExpExecArray) => string]> = [
  [/^\\(bar|overline)\{?([a-zA-Z])\}?$/, "mean", (m) => `\\${m[1]}{${m[2]}}`],
  [/^\\mu$/, "mean", () => "\\mu"],
  [/^\\tilde\{?x\}?$/, "median", () => "\\tilde{x}"],
  [/^Q_?\{?2\}?$/, "median", () => "Q_{2}"],
  [/^Q_?\{?1\}?$/, "q1", () => "Q_{1}"],
  [/^Q_?\{?3\}?$/, "q3", () => "Q_{3}"],
  [/^\\sigma(_\{?x\}?)?$/, "sigma", (m) => (m[1] ? "\\sigma_{x}" : "\\sigma")],
  [/^s(_\{?x\}?)?$/, "s", (m) => (m[1] ? "s_{x}" : "s")],
];

const WRAPPER = /\\(?:text|textrm|textit|textbf|mathrm|mathit|mathbf|operatorname)\s*\{([^{}]*)\}/g;

/** `\text{median}`, `\operatorname{med}`, `IQR`, `Q_{1}`, `\sigma`, `s_{x}` → the statistic it names. */
export function statNameOf(latex: string): StatName | null {
  const raw = latex.trim();
  if (!raw) return null;
  const compact = raw.replace(/\\[,;:! ]|\s+/g, "");
  for (const [re, stat, label] of SYMBOLS) {
    const m = re.exec(compact);
    if (m) return { stat, label: label(m), word: false };
  }
  // a word: the text of `\text{…}` (and the like) or plain letters, any case, spaces and hyphens ignored
  const text = raw.replace(WRAPPER, " $1 ");
  if (/\\[a-zA-Z]/.test(text.replace(/\\[,;:! ]/g, " "))) return null;
  // (a colon after the word, as a heading is written: `\text{median}:`)
  const key = text
    .replace(/[\s{}\-–_]|\\[,;:! ]/g, "")
    .replace(/[:.]+$/, "")
    .toLowerCase();
  if (!/^[a-z0-9]{2,}$/.test(key)) return null;
  for (const [re, stat] of WORDS) {
    if (re.test(key)) {
      // the student's own label, tidied: `\text { median }` → `\text{median}`, a heading's colon dropped
      const label = raw
        .replace(/\\(text|textrm|textit|textbf|mathrm|mathit|mathbf|operatorname)\s*\{\s*([^{}]*?)[\s:.]*\}/g, "\\$1{$2}")
        .replace(/[\s:.]+$/, "")
        .replace(/\s+/g, " ");
      return { stat, label, word: true };
    }
  }
  return null;
}

/** `\text{median} = ?`, `Q_{1} =`, `\sigma = \text{?}` — or a word alone on its line (`\text{mode}`). */
export function statAsk(latex: string): StatName | null {
  const s = (latex ?? "").trim();
  const m = /^(.*?)\s*=\s*(?:\?|\\text\s*\{\s*\?\s*\})?\s*$/.exec(s);
  if (m) return m[1].trim() && !/[=<>]/.test(m[1]) ? statNameOf(m[1]) : null;
  if (/[=<>]|\\approx/.test(s)) return null;
  const name = statNameOf(s);
  return name && name.word ? name : null;
}

/** `Q_{1} = 5`, `\sigma \approx 4.15`, `\text{mode} = 3, \ 7`: the name and the value side. */
function claimOf(latex: string): { name: StatName; value: string; approx: boolean } | null {
  const s = (latex ?? "").trim();
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (depth !== 0) continue;
    const approx = s.startsWith("\\approx", i);
    if (ch !== "=" && !approx) continue;
    const left = s.slice(0, i).trim();
    const value = s.slice(i + (approx ? 7 : 1)).trim();
    if (!left || !value || /[=<>]|\\approx|\?/.test(value)) return null;
    const name = statNameOf(left);
    return name ? { name, value, approx } : null;
  }
  return null;
}

// ---------------------------------------------------------------- the working

function sortedLine(data: Data): string {
  return sortedData(data).texts.join(", ");
}

/** `L = 8`, or `L = \frac{7 + 8}{2}` then `L = 7.5`: the median of a sorted run of values. */
function middleLines(name: string, sorted: Data, all: Data): { lines: string[]; value: Q } {
  const n = sorted.values.length;
  const m = Math.floor(n / 2);
  const value = medianOf(sorted.values);
  if (n % 2 === 1) return { lines: [`${name} = ${sorted.texts[m]}`], value };
  const [a, b] = [sorted.texts[m - 1], sorted.texts[m]];
  return { lines: [`${name} = \\frac{${a} + ${signed(b)}}{2}`, `${name} = ${statTex(value, all)}`], value };
}

function quartileLines(which: "q1" | "q3", sorted: Data): { lines: string[]; value: Q } {
  const n = sorted.values.length;
  const part = (from: number, to: number): Data => ({ values: sorted.values.slice(from, to), texts: sorted.texts.slice(from, to), decimals: sorted.decimals });
  const half = which === "q1" ? part(0, Math.floor(n / 2)) : part(Math.ceil(n / 2), n);
  return middleLines(which === "q1" ? "Q_{1}" : "Q_{3}", half, sorted);
}

/** `\bar{x} = \frac{3 + 5 + 7}{3}`, `\bar{x} = \frac{15}{3}`, `\bar{x} = 5` — in the student's decimals when the data has them. */
export function meanLines(name: string, data: Data, opts: { total?: boolean; tex?: (a: Q) => string } = {}): string[] {
  const tex = opts.tex ?? ((a: Q) => (data.decimals ? (decimalTex(a, 6) ?? qTex(a)) : qTex(a)));
  const total = sumOf(data.values);
  const n = data.values.length;
  const sum = data.values.map((v, i) => (i === 0 ? tex(v) : v.n < 0 ? ` - ${tex(qNeg(v))}` : ` + ${tex(v)}`)).join("");
  const lines = [`${name} = \\frac{${sum}}{${n}}`];
  if (opts.total !== false) lines.push(`${name} = \\frac{${tex(total)}}{${n}}`);
  lines.push(`${name} = ${tex(qDiv(total, q(n)))}`);
  return lines;
}

/**
 * The standard deviation: the mean, the squared deviations summed (each written out for a short
 * list with a short mean), divided by n (σ) or n − 1 (s), the root; exact or to 2 places.
 */
function deviationLines(name: string, data: Data, sample: boolean, w: StepWriter): Q | null {
  const n = data.values.length;
  if (n < 2 || n > 12) return null;
  const mean = qDiv(sumOf(data.values), q(n));
  const meanTex = statTex(mean, data);
  const short = mean.d === 1 || decimalTex(mean, data.decimals ? 4 : 2) !== null;
  w.writeAll(meanLines("\\bar{x}", data, { total: false, tex: (a) => statTex(a, data) }));
  const div = sample ? n - 1 : n;
  const squares = data.values.map((v) => {
    const d = qSub(v, mean);
    return qMul(d, d);
  });
  const total = sumOf(squares);
  const root = (inner: string) => `${name} = \\sqrt{${inner}}`;
  if (short && n <= 6) w.write(root(`\\frac{${data.texts.map((t) => `(${t} - ${signed(meanTex)})^{2}`).join(" + ")}}{${div}}`));
  const squareTexs = squares.map((s) => (s.d === 1 ? String(s.n) : decimalTex(s, 6)));
  if (short && squareTexs.every((t) => t !== null)) w.write(root(`\\frac{${squareTexs.join(" + ")}}{${div}}`));
  const totalTex = total.d === 1 ? String(total.n) : decimalTex(total, 6);
  const variance = qDiv(total, q(div));
  if (totalTex !== null) w.write(root(`\\frac{${totalTex}}{${div}}`));
  // the division done: a whole number, a fraction in lowest terms, or (a sum in decimals) a short decimal
  const varianceTex = variance.d === 1 ? String(variance.n) : totalTex === null || total.d === 1 ? qTex(variance) : decimalTex(variance, 6);
  if (varianceTex !== null) w.write(root(varianceTex));
  return variance;
}

/** Everything a statistic's steps need, or null when the data cannot give it. */
function workingFor(ask: StatName, data: Data, normalize: (s: string) => string, target: string): { steps: string[]; value: number | null; list?: Q[] } | null {
  const w = new StepWriter(normalize, target);
  const sorted = sortedData(data);
  const n = data.values.length;
  const writeSorted = () => {
    if (!isSorted(data.values)) w.write(sortedLine(data));
  };
  const L = ask.label;
  switch (ask.stat) {
    case "mean": {
      w.writeAll(meanLines(L, data));
      return { steps: w.lines(), value: qNum(qDiv(sumOf(data.values), q(n))) };
    }
    case "median": {
      writeSorted();
      const mid = middleLines(L, sorted, data);
      w.writeAll(mid.lines);
      return { steps: w.lines(), value: qNum(mid.value) };
    }
    case "range": {
      writeSorted();
      const [lo, hi] = [sorted.values[0], sorted.values[n - 1]];
      w.write(`${L} = ${sorted.texts[n - 1]} - ${signed(sorted.texts[0])}`);
      const r = qSub(hi, lo);
      w.write(`${L} = ${statTex(r, data)}`);
      return { steps: w.lines(), value: qNum(r) };
    }
    case "mode": {
      const modes = modesOf(data.values);
      if (modes === null) return null;
      writeSorted();
      w.write(`${L} = ${modes.length === 0 ? NO_SOLUTION : modes.map((m) => statTex(m, data)).join(LIST_SEP)}`);
      return { steps: w.lines(), value: null, list: modes };
    }
    case "q1":
    case "q3": {
      if (n < 4) return null;
      writeSorted();
      const part = quartileLines(ask.stat, sorted);
      const lines = part.lines.map((l) => l.replace(ask.stat === "q1" ? "Q_{1}" : "Q_{3}", L));
      w.writeAll(lines);
      return { steps: w.lines(), value: qNum(part.value) };
    }
    case "iqr": {
      if (n < 4) return null;
      writeSorted();
      const lower = quartileLines("q1", sorted);
      const upper = quartileLines("q3", sorted);
      w.writeAll(lower.lines);
      w.writeAll(upper.lines);
      const iqr = qSub(upper.value, lower.value);
      w.write(`${L} = Q_{3} - Q_{1}`);
      w.write(`${L} = ${statTex(upper.value, data)} - ${signed(statTex(lower.value, data))}`, true);
      w.write(`${L} = ${statTex(iqr, data)}`);
      return { steps: w.lines(), value: qNum(iqr) };
    }
    case "five": {
      if (n < 4) return null;
      writeSorted();
      const mid = middleLines("Q_{2}", sorted, data);
      const lower = quartileLines("q1", sorted);
      const upper = quartileLines("q3", sorted);
      w.writeAll(mid.lines);
      w.writeAll(lower.lines);
      w.writeAll(upper.lines);
      const five = [sorted.values[0], lower.value, mid.value, upper.value, sorted.values[n - 1]];
      w.write(five.map((v) => statTex(v, data)).join(LIST_SEP));
      return { steps: w.lines(), value: null, list: five };
    }
    case "sigma":
    case "s":
    case "sd": {
      const sample = ask.stat === "s";
      const variance = deviationLines(L, data, sample, w);
      if (!variance) return null;
      const exact = exactRoot(variance);
      const value = Math.sqrt(qNum(variance));
      w.write(exact ? `${L} = ${statTex(exact, data)}` : `${L} \\approx ${value.toFixed(2)}`);
      return { steps: w.lines(), value };
    }
  }
}

/**
 * The column's statistics question answered, or null: the last line asks for a statistic by
 * name and a data list is above it (the nearest one).
 */
export function statisticsAnswer(deps: CourseDeps, lines: readonly string[]): Solved | null {
  try {
    return exactly(() => {
      const target = lines[lines.length - 1] ?? "";
      const ask = statAsk(target);
      if (!ask) return null;
      let data: Data | null = null;
      for (let i = lines.length - 2; i >= 0 && !data; i--) data = dataListOf(lines[i]);
      if (!data) return null;
      const work = workingFor(ask, data, deps.normalize, target);
      if (!work || work.steps.length === 0) return null;
      const final = work.steps[work.steps.length - 1];
      // the check: the answer line's value against the statistic worked out again from the data
      if (work.list) {
        const again = floatList(ask.stat, data.values);
        const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
        if (!again || again.length !== work.list.length || work.list.some((v, i) => !near(qNum(v), again[i]))) return null;
      } else {
        const expected = floatStat(ask.stat, data.values);
        const side = final.split(/=|\\approx/).pop() ?? "";
        const got = evalLatex(deps, side);
        if (expected === null || !got || work.value === null) return null;
        const tol = /\\approx/.test(final) ? 0.005 + 1e-9 : 1e-9 * Math.max(1, Math.abs(expected));
        if (Math.abs(got.re - expected) > tol || Math.abs(work.value - expected) > 1e-9 * Math.max(1, Math.abs(expected))) return null;
      }
      return { latex: final, steps: work.steps };
    });
  } catch {
    return null;
  }
}

/**
 * The last line claims a statistic of a data list above it (`\bar{x} = 10`, `\sigma \approx 4.15`):
 * not an equation to solve for a letter — the one-unknown paths would write `x = 10`.
 */
export function isStatisticClaim(lines: readonly string[]): boolean {
  const claim = claimOf(lines[lines.length - 1] ?? "");
  return claim !== null && lines.slice(0, -1).some((l) => dataListOf(l) !== null);
}

// ---------------------------------------------------------------- the student's own lines

/** How many decimal places the value side is written to (0 for none). */
function placesIn(latex: string): number {
  let out = 0;
  for (const m of latex.matchAll(/\d\.(\d+)/g)) out = Math.max(out, m[1].length);
  return out;
}

/** A value side with no letters, as a number; null when it is not one. */
function valueOf(deps: CourseDeps, latex: string): number | null {
  if (/[a-zA-Z]/.test(latex.replace(/\\(?:frac|dfrac|tfrac|sqrt|cdot|times|div|left|right)/g, ""))) return null;
  const v = evalLatex(deps, latex);
  return v && Math.abs(v.im) < 1e-12 ? v.re : null;
}

/** `3, \ 7`, `7`, `\varnothing` → the values listed; null when a piece is not a number. */
function listed(deps: CourseDeps, latex: string): number[] | null {
  const s = latex.replace(/\\[,;:! ]|\\q?quad/g, " ").trim();
  if (/^(?:\\varnothing|\\emptyset|\\\{\s*\\\})$/.test(s)) return [];
  const out: number[] = [];
  for (const p of s.split(",")) {
    const v = valueOf(deps, p.trim());
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

/**
 * A claim about the data checked: `ok` when it is the statistic (to the places written, or with
 * ≈), `none` when it is right by another convention (a quartile's other method, a sample standard
 * deviation under an ambiguous name, some of the modes), `mismatch` otherwise; null when the
 * value cannot be read.
 */
function claimVerdict(deps: CourseDeps, claim: { name: StatName; value: string; approx: boolean }, data: Data): EngineVerdict | null {
  const { name, value, approx } = claim;
  const values = data.values;
  const n = values.length;
  if (name.stat === "five") return null;
  if (name.stat === "mode") {
    const want = modesOf(values);
    const got = listed(deps, value);
    if (!got) return null;
    if (want === null) return "none";
    const has = (v: number) => want.some((w) => Math.abs(qNum(w) - v) < 1e-9);
    if (got.length === want.length && got.every(has)) return "ok";
    return got.length > 0 && got.every(has) ? "none" : "mismatch";
  }
  if (["q1", "q3", "iqr"].includes(name.stat) && n < 4) return null;
  if (name.stat === "s" && n < 2) return null;
  const got = valueOf(deps, value);
  const truth = floatStat(name.stat, values);
  if (got === null || truth === null) return null;
  const places = placesIn(value);
  const tol = places > 0 ? 0.5 * 10 ** -places + 1e-9 : approx ? 0.5 + 1e-9 : 1e-9 * Math.max(1, Math.abs(truth));
  const close = (x: number) => Math.abs(got - x) <= tol;
  if (close(truth)) return "ok";
  const others: number[] = [];
  const sorted = [...values].sort(compare);
  if (name.stat === "q1" || name.stat === "q3" || name.stat === "iqr") {
    for (const [a, b] of otherQuartiles(sorted)) others.push(name.stat === "q1" ? a : name.stat === "q3" ? b : b - a);
  }
  if (name.stat === "sd") others.push(floatStat("s", values) ?? NaN);
  return others.some(close) ? "none" : "mismatch";
}

/**
 * A line under a data list (`ctx`: the line above carries the list): the data again, sorted
 * (`ok`); a statistic asked for (not a step: kind `unknown`, so Solve answers it); a claim about
 * the data (`ok` / `mismatch`). Null for any other line, and when no list is above.
 */
export function statisticsAnalysis(deps: CourseDeps, latex: string, ctx: AnalyzeContext): LineAnalysis | null {
  if (!latex || !/[,=]|\\approx|\\text|[a-zA-Z]/.test(latex)) return null;
  const data = dataFromContext(deps, ctx);
  if (!data) return null;
  const line = (kind: LineAnalysis["kind"], verdict: EngineVerdict, math: string): LineAnalysis => ({ kind, math, resultLatex: "", verdict, note: "" });
  const list = dataListOf(latex);
  if (list) {
    if (!sameValues(list.values, data.values)) return null;
    const sorted = isSorted(list.values) || isSorted(list.values, -1);
    return line("expression", sorted ? "ok" : "none", carry(list));
  }
  if (statAsk(latex)) return line("unknown", "unknown", "");
  const claim = claimOf(latex);
  if (!claim) return null;
  let verdict: EngineVerdict | null = null;
  try {
    verdict = claimVerdict(deps, claim, data);
  } catch {
    verdict = null;
  }
  return line("equation", verdict ?? "none", carry(data));
}
