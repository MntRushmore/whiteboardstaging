/**
 * The eval's sample and its run: which lines go to v3/text (≤ ~370 calls) and which of those to the
 * vision fallback too (≤ 96 calls), read them (cached), and judge every reader on the same lines.
 *
 * The sample, deterministic (a seeded shuffle):
 *  - `misread`: every scoreboard line whose strokes read (on disk) is wrong — the lines a crop
 *    reader exists for;
 *  - `strokes-right`: a stratified draw of the scoreboard lines whose strokes read is right, by line
 *    type and hand (with `misread` it gives a stratified estimate over every line with a strokes read);
 *  - `stacked`, `long division`: every one; `divisors`: one per divisor under a division bar;
 *  - `young`: K–6 working, by topic, hands rotated (no strokes read on disk for these);
 *  - `drawings`: drawings alone, two hands (the negatives: nothing should be read).
 */
import { mulberry32 } from "@/lib/hand";
import { YOUNG_CORPUS } from "../young/corpus";
import { buildCorpus, type EvalLine, type LineType } from "./corpus";
import { lineCrop } from "./crop";
import { isRight, judgeLine, type Verdict } from "./judge";
import { pool, readWithMathpixText, readWithVision, type CallLedger, type TextRead, type VisionRead } from "./readers";

export type Stratum = "misread" | "strokes-right" | "stacked" | "long division" | "divisors" | "young" | "drawings";

export interface Sampled {
  line: EvalLine;
  stratum: Stratum;
  vision: boolean;
}

/** How many strokes-right scoreboard lines to draw per type (≈ 200), and how many of each to the vision reader. */
export const STROKES_RIGHT_QUOTA: Partial<Record<LineType, [text: number, vision: number]>> = {
  arithmetic: [30, 4],
  fractions: [30, 4],
  "exponents / roots": [30, 4],
  equations: [40, 5],
  "letters / variables": [25, 4],
  "calculus, trig, units": [45, 4],
};
export const YOUNG_PER_TOPIC: [text: number, vision: number] = [11, 2];

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Round-robin over the hands, so a draw of n has every hand about n / 4 times. */
function byHands(lines: readonly EvalLine[], n: number, seed: number): EvalLine[] {
  const hands = new Map<string, EvalLine[]>();
  for (const l of shuffled(lines, seed)) {
    if (!hands.has(l.variant)) hands.set(l.variant, []);
    hands.get(l.variant)!.push(l);
  }
  const queues = [...hands.values()];
  const out: EvalLine[] = [];
  for (let i = 0; out.length < n && queues.some((q) => q.length > 0); i++) {
    const q = queues[i % queues.length];
    const next = q.shift();
    if (next) out.push(next);
  }
  return out;
}

/** One line per picture of ink (identical strokes give the identical crop and the identical read). */
export function uniqueInk(lines: readonly EvalLine[]): EvalLine[] {
  const seen = new Set<string>();
  return lines.filter((l) => !seen.has(l.cacheKey) && Boolean(seen.add(l.cacheKey)));
}

export function strokesVerdict(line: EvalLine): Verdict | null {
  return line.strokes ? judgeLine(line, line.strokes) : null;
}

export function selectSample(lines: readonly EvalLine[]): Sampled[] {
  const out: Sampled[] = [];
  // by ink: the same line in the same hand (`a = 5` in three problems) is one picture, read once
  const taken = new Set<string>();
  const add = (line: EvalLine, stratum: Stratum, vision: boolean) => {
    if (taken.has(line.cacheKey)) return;
    taken.add(line.cacheKey);
    out.push({ line, stratum, vision });
  };
  const scoreboard = uniqueInk(lines.filter((l) => l.set === "scoreboard" && l.strokes && !/\\begin\{array\}/.test(l.latex)));

  for (const l of scoreboard.filter((x) => !isRight(strokesVerdict(x)))) add(l, "misread", true);

  const right = scoreboard.filter((x) => isRight(strokesVerdict(x)));
  for (const [type, [n, nv]] of Object.entries(STROKES_RIGHT_QUOTA) as Array<[LineType, [number, number]]>)
    byHands(right.filter((l) => l.type === type), n, 101 + type.length).forEach((l, i) => add(l, "strokes-right", i < nv));

  for (const l of lines.filter((x) => x.set === "stacked")) add(l, "stacked", true);
  for (const l of lines.filter((x) => x.type === "long division")) add(l, "long division", l.variant === "clean" || l.variant === "messy");
  const divisors = lines.filter((x) => x.set === "bars" && x.type !== "long division");
  ["2", "-3", "4", "\\frac{1}{2}"].forEach((d, i) => {
    const l = divisors.find((x) => x.id === d && x.variant === ["clean", "slanted", "steep", "messy"][i]);
    if (l) add(l, "divisors", false);
  });

  const topicOf = new Map<string, string>();
  for (const c of YOUNG_CORPUS) for (const latex of [...(c.problem ? [c.problem] : []), ...c.work.map(([l]) => l)]) if (!topicOf.has(latex)) topicOf.set(latex, c.topic);
  const young = lines.filter((x) => x.set === "young");
  for (const topic of new Set(topicOf.values())) {
    const pool = young.filter((l) => topicOf.get(l.latex) === topic);
    // distinct lines first: one hand per written line, hands rotated
    const distinct = new Map<string, EvalLine[]>();
    for (const l of pool) {
      if (!distinct.has(l.latex)) distinct.set(l.latex, []);
      distinct.get(l.latex)!.push(l);
    }
    const picks = shuffled([...distinct.values()], 7 + topic.length).slice(0, YOUNG_PER_TOPIC[0]);
    picks.forEach((hands, i) => add(hands[i % hands.length], "young", i < YOUNG_PER_TOPIC[1]));
  }

  const drawings = lines.filter((x) => x.set === "drawings" && (x.variant === "clean" || x.variant === "messy"));
  let drawingsSeen = 0;
  for (const l of drawings) add(l, "drawings", l.variant === "clean" && drawingsSeen++ < 6);
  return out;
}

export interface LineResult {
  key: string;
  set: EvalLine["set"];
  id: string;
  type: LineType;
  letters: boolean;
  variant: string;
  stratum: Stratum;
  latex: string;
  cropBytes: number;
  strokes: { latex: string; confidence: number; verdict: Verdict; source: string } | null;
  /** `verdict` on the LaTeX the route gets; `verdictRaw` on Mathpix's own (before `unwrapMathText`) */
  text: (TextRead & { verdict: Verdict; verdictRaw: Verdict }) | null;
  vision: (VisionRead & { verdict: Verdict }) | null;
}

export interface RunResult {
  /** distinct pictures of ink (identical strokes counted once) */
  corpus: {
    lines: number;
    withStrokes: number;
    strokesWrong: number;
    byType: Record<string, { lines: number; withStrokes: number; strokesWrong: number }>;
    /** the lines with a letter variable, of those with a strokes read */
    letters: { withStrokes: number; strokesWrong: number };
    /** every strokes read on disk (one per picture): its confidence and whether it was right */
    strokesReads: Array<{ c: number; ok: boolean }>;
  };
  results: LineResult[];
}

/** Reads the sample (cached, capped) and judges every reader on it. */
export async function runSample(ledger: CallLedger, opts: { limit?: number } = {}): Promise<RunResult> {
  const lines = buildCorpus();
  const corpusByType: RunResult["corpus"]["byType"] = {};
  let withStrokes = 0;
  let strokesWrong = 0;
  const letters = { withStrokes: 0, strokesWrong: 0 };
  const strokesReads: Array<{ c: number; ok: boolean }> = [];
  for (const l of uniqueInk(lines)) {
    const t = (corpusByType[l.type] ??= { lines: 0, withStrokes: 0, strokesWrong: 0 });
    t.lines++;
    if (l.strokes && l.set === "scoreboard" && !/\\begin\{array\}/.test(l.latex)) {
      const right = isRight(strokesVerdict(l));
      t.withStrokes++;
      withStrokes++;
      if (l.letters) letters.withStrokes++;
      strokesReads.push({ c: l.strokes.confidence, ok: right });
      if (!right) {
        t.strokesWrong++;
        strokesWrong++;
        if (l.letters) letters.strokesWrong++;
      }
    }
  }
  const sample = selectSample(lines).slice(0, opts.limit ?? Infinity);
  const crops = await Promise.all(sample.map((s) => lineCrop(s.line.segments, s.line.bounds)));
  const texts = await pool(sample, 3, async (s, i) => (crops[i] ? readWithMathpixText(crops[i]!.dataUrl, ledger) : null));
  const visions = await pool(sample, 4, async (s, i) => (s.vision && crops[i] ? readWithVision(crops[i]!.dataUrl, ledger) : null));
  const results = sample.map((s, i): LineResult => {
    const l = s.line;
    const sv = strokesVerdict(l);
    const t = texts[i];
    const v = visions[i];
    return {
      key: l.key,
      set: l.set,
      id: l.id,
      type: l.type,
      letters: l.letters,
      variant: l.variant,
      stratum: s.stratum,
      latex: l.latex,
      cropBytes: crops[i]?.bytes ?? 0,
      strokes: l.strokes && sv ? { latex: l.strokes.latex, confidence: l.strokes.confidence, verdict: sv, source: l.strokes.source } : null,
      text: t && t.reason !== "budget" ? { ...t, verdict: judgeLine(l, t), verdictRaw: judgeLine(l, { ok: t.ok, latex: t.rawLatex }) } : null,
      vision: v && v.reason !== "budget" ? { ...v, verdict: judgeLine(l, v) } : null,
    };
  });
  return { corpus: { lines: uniqueInk(lines).length, withStrokes, strokesWrong, byType: corpusByType, letters, strokesReads }, results };
}
