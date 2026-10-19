/**
 * docs/eval/mpx-supernet.md from a run (pure: no network). Everything is generated except the
 * recommendation, which lives between `<!-- recommendation:start -->` and `<!-- recommendation:end -->`
 * and is carried over from the existing file on every rewrite.
 *
 * Estimates over "every line with a strokes read" are stratified: every line Mathpix's strokes read
 * got wrong is in the sample, and a draw of those it got right, by line type, so each reader's rate is
 * (right lines × its rate on the right-read draw + misread lines × its rate on the misreads) / all lines.
 */
import { judgeRead } from "../handwriting";
import { LINE_TYPES } from "./corpus";
import { isRight, judgeLine, type Verdict } from "./judge";
import { MATHPIX_PRICE, type Ledger } from "./readers";
import type { LineResult, RunResult } from "./run";
import type { SplitScore } from "./split";
import type { PageReader } from "./worksheets";

export interface SheetRun {
  name: string;
  photo: boolean;
  problems: number;
  reads: Array<{
    reader: PageReader;
    ok: boolean;
    error?: string;
    ms: number;
    score: SplitScore | null;
    pageConfidence: { confidence?: number | null; text_confidence?: number | null; layout_confidence?: number | null } | null;
    regions: number;
    regionTextConfidence: number;
    regionLayoutConfidence: number;
    handwritten: number;
    version?: string;
  }>;
}

export interface ReportInput {
  run: RunResult;
  sheets: SheetRun[];
  ledger: Ledger;
  date: string;
  previous?: string;
}

const pct = (a: number, b: number, digits = 0) => (b === 0 ? "–" : `${((100 * a) / b).toFixed(digits)}%`);
const frac = (a: number, b: number) => (b === 0 ? "–" : `${a}/${b} (${pct(a, b)})`);
const code = (s: string) => "`" + s.replace(/\s+/g, " ").replace(/`/g, "'").replace(/\|/g, "\\|").trim() + "`";
const c3 = (n: number | null | undefined) => (typeof n === "number" ? n.toFixed(3) : "–");

function quantile(xs: readonly number[], q: number): number {
  const a = [...xs].sort((x, y) => x - y);
  return a.length === 0 ? NaN : a[Math.min(a.length - 1, Math.floor(q * a.length))];
}

const okT = (r: LineResult) => Boolean(r.text) && isRight(r.text!.verdict);
const okV = (r: LineResult) => Boolean(r.vision) && isRight(r.vision!.verdict);
const okS = (r: LineResult) => Boolean(r.strokes) && isRight(r.strokes!.verdict);
const scoreboardStrata = (r: LineResult) => r.stratum === "misread" || r.stratum === "strokes-right";

/** Two reads are the same maths (the judge's own test, one read against the other). */
export function sameRead(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  try {
    return judgeRead(a, b) !== "wrong";
  } catch {
    return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
  }
}

/** Each sampled scoreboard line's weight in the stratified estimate (by type and stratum). */
export function weights(run: RunResult): Map<string, number> {
  const out = new Map<string, number>();
  const sampled = run.results.filter(scoreboardStrata);
  for (const t of LINE_TYPES) {
    const pop = run.corpus.byType[t];
    if (!pop) continue;
    const right = sampled.filter((r) => r.type === t && r.stratum === "strokes-right");
    const wrong = sampled.filter((r) => r.type === t && r.stratum === "misread");
    for (const r of right) out.set(r.key, (pop.withStrokes - pop.strokesWrong) / right.length);
    for (const r of wrong) out.set(r.key, pop.strokesWrong / wrong.length);
  }
  return out;
}

/** A reader's stratified rate over every line with a strokes read (types without a right-read draw left out). */
function estimate(run: RunResult, w: Map<string, number>, ok: (r: LineResult) => boolean, has: (r: LineResult) => boolean, filter: (r: LineResult) => boolean = () => true): number {
  let num = 0;
  let den = 0;
  for (const r of run.results.filter((x) => scoreboardStrata(x) && has(x) && filter(x))) {
    const wt = w.get(r.key) ?? 0;
    den += wt;
    if (ok(r)) num += wt;
  }
  return den === 0 ? NaN : num / den;
}

/** Pooled over types: the right-read draw and the misreads, weighted by the whole population (for a reader with few lines per type). */
function pooled(run: RunResult, ok: (r: LineResult) => boolean, has: (r: LineResult) => boolean): { rate: number; right: [number, number]; wrong: [number, number] } {
  const R = run.corpus.withStrokes - run.corpus.strokesWrong;
  const W = run.corpus.strokesWrong;
  const right = run.results.filter((r) => r.stratum === "strokes-right" && has(r));
  const wrong = run.results.filter((r) => r.stratum === "misread" && has(r));
  const a = right.filter(ok).length;
  const b = wrong.filter(ok).length;
  return { rate: (R * (a / Math.max(1, right.length)) + W * (b / Math.max(1, wrong.length))) / (R + W), right: [a, right.length], wrong: [b, wrong.length] };
}

interface GateRow {
  rule: string;
  asked: number;
  rightWhenTrusted: number;
  wrongCaught: number;
  needless: number;
  trustedWrong: number;
}

/** A gate over the weighted scoreboard sample: `trust(r)` true = the read is used without asking. */
function gate(run: RunResult, w: Map<string, number>, rule: string, ok: (r: LineResult) => boolean, trust: (r: LineResult) => boolean, has: (r: LineResult) => boolean): GateRow {
  let all = 0;
  let trusted = 0;
  let trustedRight = 0;
  let wrong = 0;
  let wrongAsked = 0;
  let right = 0;
  let rightAsked = 0;
  let trustedWrongRaw = 0;
  for (const r of run.results.filter((x) => scoreboardStrata(x) && has(x))) {
    const wt = w.get(r.key) ?? 0;
    const good = ok(r);
    const t = trust(r);
    all += wt;
    if (t) {
      trusted += wt;
      if (good) trustedRight += wt;
      else trustedWrongRaw++;
    }
    if (good) {
      right += wt;
      if (!t) rightAsked += wt;
    } else {
      wrong += wt;
      if (!t) wrongAsked += wt;
    }
  }
  return { rule, asked: 1 - trusted / all, rightWhenTrusted: trustedRight / Math.max(1e-9, trusted), wrongCaught: wrongAsked / Math.max(1e-9, wrong), needless: rightAsked / Math.max(1e-9, right), trustedWrong: trustedWrongRaw };
}

const gateTable = (rows: readonly GateRow[], what: string) => [
  `| ${what} | lines asked about | right when trusted | wrong reads caught | right reads asked about (needless) | wrong reads trusted (sample) |`,
  "| --- | --- | --- | --- | --- | --- |",
  ...rows.map((g) => `| ${g.rule} | ${(100 * g.asked).toFixed(1)}% | ${(100 * g.rightWhenTrusted).toFixed(1)}% | ${(100 * g.wrongCaught).toFixed(0)}% | ${(100 * g.needless).toFixed(1)}% | ${g.trustedWrong} |`),
];

const THRESHOLDS = [0.5, 0.8, 0.9, 0.95, 0.98, 0.99, 0.999] as const;

export function renderMpxMarkdown(input: ReportInput): string {
  const { run, sheets, ledger } = input;
  const R = run.results;
  const w = weights(run);
  const maths = R.filter((r) => r.set !== "drawings");
  const hasT = (r: LineResult) => Boolean(r.text);
  const hasV = (r: LineResult) => Boolean(r.vision);
  const hasS = (r: LineResult) => Boolean(r.strokes);
  const misreads = R.filter((r) => r.stratum === "misread");
  const both = maths.filter((r) => r.vision && r.text);
  const out: string[] = [];

  // ---------------------------------------------------------------- head
  const textMs = R.filter((r) => r.text?.ok || r.text?.reason === "api_error").map((r) => r.text!.ms);
  const visionMs = R.filter((r) => r.vision).map((r) => r.vision!.ms);
  const visionCost = R.filter((r) => r.vision).map((r) => r.vision!.costUsd);
  const meanVision = visionCost.reduce((a, b) => a + b, 0) / Math.max(1, visionCost.length);
  const textPool = pooled(run, okT, hasT);
  const visionPool = pooled(run, okV, hasV);
  const versions = [...new Set(R.map((r) => r.text?.version).filter(Boolean))].join(", ");
  const visionModel = R.find((r) => r.vision)?.vision?.model ?? "?";
  const pdfPages = ledger.pdfPages;
  const textCalls = ledger.mathpixCalls - pdfPages;

  out.push(
    "# Mathpix v3/text (SuperNet-201) as Agathon's crop reader",
    "",
    "> Generated by `npm run eval:mpx-text` (`src/__eval__/mpx-text/**`; needs `RUN_MPX_TEXT_EVAL=1` and the Mathpix and OpenRouter keys); do not edit by hand",
    "> outside the recommendation. Every line is the web scoreboards' synthetic ink (the tutor's hand engine in the four student",
    "> hands; **no child's writing, no production data**), cropped exactly as an iPad's board crops it (`captureInkCrop`, the drawn",
    "> path: black on white, ≤ 512 px, JPEG 0.8), and read by Mathpix `v3/text` (`recognizeImage`: `improve_mathpix: false`,",
    `> auto-rotation off, \`include_line_data\`) and by today's crop reader, the recognize route's vision fallback (\`${visionModel}\`,`,
    "> its prompt and body, the production privacy preferences). Mathpix's strokes reads are the scoreboard's, already on disk",
    "> (no strokes call was made). Judged by the scoreboard's own `judgeRead`; stacked sums by `parseStacked`, long divisions by the",
    "> bracket's divisor and dividend (the board's own parsers). Answers are cached under `src/__eval__/.cache/mpx-text/`.",
    `> Run ${input.date}; Mathpix answered as \`${versions || "?"}\`. Calls: ${textCalls} v3/text + ${pdfPages} v3/pdf pages (cap ${400}), ${ledger.visionCalls} vision (cap 100).`,
    "",
  );

  // ---------------------------------------------------------------- recommendation
  const recommendation =
    /<!-- recommendation:start -->[\s\S]*?<!-- recommendation:end -->/.exec(input.previous ?? "")?.[0] ??
    "<!-- recommendation:start -->\n_(written by hand after a run)_\n<!-- recommendation:end -->";
  out.push("## Recommendation", "", recommendation, "");

  // ---------------------------------------------------------------- headline
  const youngT = R.filter((r) => r.stratum === "young");
  const stacks = R.filter((r) => r.stratum === "stacked");
  const longDiv = R.filter((r) => r.stratum === "long division");
  out.push(
    "## The numbers",
    "",
    "| | strokes (today's first read) | **v3/text on the crop** | vision model on the crop (today's fallback) |",
    "| --- | --- | --- | --- |",
    `| every line with a strokes read on disk (${run.corpus.withStrokes} distinct, stratified estimate) | ${pct(run.corpus.withStrokes - run.corpus.strokesWrong, run.corpus.withStrokes, 1)} | **${(100 * textPool.rate).toFixed(1)}%** | ${(100 * visionPool.rate).toFixed(1)}% (from ${visionPool.right[1]} + ${visionPool.wrong[1]} lines) |`,
    `| … the lines strokes read right (sampled) | 100% | ${frac(...textPool.right)} | ${frac(...visionPool.right)} |`,
    `| **the lines strokes misread** (all ${misreads.length}) | 0% | **${frac(misreads.filter(okT).length, misreads.length)}** | ${frac(misreads.filter(okV).length, misreads.filter(hasV).length)} |`,
    `| young kids' lines (K–6, sampled) | (none on disk) | ${frac(youngT.filter(okT).length, youngT.length)} | ${frac(youngT.filter(okV).length, youngT.filter(hasV).length)} |`,
    `| stacked sums (one block) | (none on disk) | ${frac(stacks.filter(okT).length, stacks.length)} | ${frac(stacks.filter(okV).length, stacks.filter(hasV).length)} |`,
    `| long division | (none on disk) | ${frac(longDiv.filter(okT).length, longDiv.length)} | ${frac(longDiv.filter(okV).length, longDiv.filter(hasV).length)} |`,
    `| the ${both.length} maths lines both crop readers read | – | **${frac(both.filter(okT).length, both.length)}** | ${frac(both.filter(okV).length, both.length)} |`,
    `| latency p50 / p90 (from this Mac) | ≈ 0.45 s p50 (production route, LIVE-MATH-SPEC; not measured here) | **${(quantile(textMs, 0.5) / 1000).toFixed(2)} s / ${(quantile(textMs, 0.9) / 1000).toFixed(2)} s** (max ${(Math.max(...textMs) / 1000).toFixed(2)} s) | ${(quantile(visionMs, 0.5) / 1000).toFixed(2)} s / ${(quantile(visionMs, 0.9) / 1000).toFixed(2)} s (max ${(Math.max(...visionMs) / 1000).toFixed(2)} s) |`,
    `| cost per call | $${MATHPIX_PRICE.strokes.toFixed(4)} (list) | $${MATHPIX_PRICE.text.toFixed(4)} (list; $0.0015 past 1M a month) | $${meanVision.toFixed(5)} (OpenRouter's \`usage.cost\`, mean of ${visionCost.length}) |`,
    "",
    `"Right" = the scoreboard's \`exact\` or \`semantic\`. v3/text's LaTeX is as \`recognizeImage\` hands it to the route, i.e. after \`unwrapMathText\`: Mathpix's own \`latex_styled\` wrapped ${maths.filter((r) => r.text && isRight(r.text.verdict) && !isRight(r.text.verdictRaw)).length} right reads in \`\\text{…}\` (\`\\text { 12-5 }\`, \`\\text { 3R2 }\`, \`\\text { 4) } \\overline{128}\`), which the engine cannot read; as Mathpix sent them, v3/text was right on ${frac(maths.filter((r) => r.text && isRight(r.text.verdictRaw)).length, maths.length)} of the maths lines.`,
    "",
  );

  // ---------------------------------------------------------------- by type
  const types = LINE_TYPES.filter((t) => t !== "drawing (no maths)");
  const typeRow = (label: string, rows: LineResult[], pop: { lines?: number; withStrokes: number; strokesWrong: number } | null, filter: (r: LineResult) => boolean) => {
    const sample = rows.filter((r) => r.stratum !== "misread");
    const est = pop && pop.withStrokes > 0 ? estimate(run, w, okT, hasT, filter) : NaN;
    const vis = rows.filter(hasV);
    const strokesCol = pop && pop.withStrokes > 0 ? `${pct(pop.withStrokes - pop.strokesWrong, pop.withStrokes)} of ${pop.withStrokes}` : "–";
    const mis = rows.filter((r) => r.stratum === "misread");
    return `| ${label} | ${pop?.lines ?? "–"} | ${strokesCol} | ${frac(sample.filter(okT).length, sample.length)} | ${Number.isFinite(est) ? `**${(100 * est).toFixed(1)}%**` : `**${pct(sample.filter(okT).length, sample.length, 1)}**`} | ${mis.length ? frac(mis.filter(okT).length, mis.length) : "–"} | ${vis.length ? frac(vis.filter(okV).length, vis.length) : "–"} | ${vis.length ? frac(vis.filter(okT).length, vis.length) : "–"} |`;
  };
  out.push(
    "## By line type",
    "",
    "| line type | distinct lines in the corpus | strokes read right (on disk) | v3/text right (sampled) | **v3/text, all lines of the type** | v3/text on the strokes misreads | vision right (its lines) | v3/text on those lines |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...types.map((t) => typeRow(t, maths.filter((r) => r.type === t), run.corpus.byType[t] ?? null, (r) => r.type === t)),
    typeRow("any line with a letter variable (overlaps the rows above)", maths.filter((r) => r.letters), { ...run.corpus.letters }, (r) => r.letters),
    "",
    "\"All lines of the type\" is the stratified estimate where the type has strokes reads on disk, else the sample's rate. The vision",
    "reader saw a subset (every strokes misread, every stacked sum, half the long divisions, a few of each other type), so its",
    "column is on few lines; the last column is v3/text on exactly those lines.",
    "",
  );

  // by hand
  const hands = ["clean", "slanted", "steep", "messy", "fixture"];
  out.push("### By hand", "", "| hand | v3/text right (sampled, not misreads) | v3/text on the strokes misreads | vision right (its lines) |", "| --- | --- | --- | --- |");
  for (const h of hands) {
    const rows = maths.filter((r) => r.variant === h);
    if (rows.length === 0) continue;
    const s = rows.filter((r) => r.stratum !== "misread");
    const m = rows.filter((r) => r.stratum === "misread");
    out.push(`| ${h} | ${frac(s.filter(okT).length, s.length)} | ${m.length ? frac(m.filter(okT).length, m.length) : "–"} | ${frac(rows.filter(okV).length, rows.filter(hasV).length)} |`);
  }
  out.push("");

  // ---------------------------------------------------------------- the misreads
  out.push(
    "## The lines Mathpix's strokes read got wrong",
    "",
    "The lines a crop reader exists for. Every one on disk (distinct ink), with all three reads:",
    "",
    "| hand | written | strokes read (conf) | v3/text (conf) | vision model (conf) |",
    "| --- | --- | --- | --- | --- |",
  );
  const mark = (v: Verdict | undefined) => (isRight(v) ? "✓" : "✗");
  for (const r of misreads)
    out.push(
      `| ${r.variant} | ${code(r.latex)} | ${code(r.strokes!.latex)} (${c3(r.strokes!.confidence)}) | ${mark(r.text?.verdict)} ${code(r.text?.latex ?? "")} (${c3(r.text?.confidence)}) | ${r.vision ? `${mark(r.vision.verdict)} ${code(r.vision.latex)} (${c3(r.vision.confidence)})` : "–"} |`,
    );
  const fixedByEither = misreads.filter((r) => okT(r) || okV(r)).length;
  const bothWrong = misreads.filter((r) => !okT(r) && !okV(r));
  out.push(
    "",
    `Either crop reader right: ${frac(fixedByEither, misreads.length)}. Both wrong (${bothWrong.length}): ${bothWrong.map((r) => `${code(r.latex)} (${r.variant}) → ${code(r.text?.latex ?? "")} / ${code(r.vision?.latex ?? "")}`).join("; ")} — look-alike glyphs of the tutor's hand that the strokes reader trips on too.`,
    "",
  );

  // ---------------------------------------------------------------- confidence
  const confFields: Array<[string, (r: LineResult) => number | null | undefined]> = [
    ["`confidence` (top level; what the prototype reports)", (r) => r.text?.confidences?.confidence],
    ["`confidence_rate`", (r) => r.text?.confidences?.confidenceRate],
    ["`line_data[].confidence`", (r) => r.text?.confidences?.line],
    ["`line_data[].text_confidence` (SuperNet-201)", (r) => r.text?.confidences?.lineText],
    ["`line_data[].layout_confidence` (SuperNet-201)", (r) => r.text?.confidences?.lineLayout],
  ];
  const answered = R.filter((r) => r.text?.ok);
  const regionTypes = new Map<string, number>();
  for (const r of answered) for (const g of r.text!.regions) regionTypes.set(`${g.type}${g.subtype ? `/${g.subtype}` : ""}`, (regionTypes.get(`${g.type}${g.subtype ? `/${g.subtype}` : ""}`) ?? 0) + 1);
  out.push(
    "## Confidence: can it tell a read to trust from one to ask the kid about?",
    "",
    `What v3/text returned on the ${answered.length} line crops it answered (${R.filter((r) => r.text && !r.text.ok).length} more were \`image_no_content\`):`,
    "",
    "| field | present |",
    "| --- | --- |",
    ...confFields.map(([name, pick]) => `| ${name} | ${answered.filter((r) => typeof pick(r) === "number").length} / ${answered.length} |`),
    `| \`is_handwritten\` true | ${answered.filter((r) => r.text!.isHandwritten).length} / ${answered.length} |`,
    "",
    `Regions per crop: ${[...new Set(answered.map((r) => r.text!.regions.length))].sort().join(", ")} (types: ${[...regionTypes.entries()].map(([k, n]) => `${k} ${n}`).join(", ")}). **SuperNet-201's new per-region \`text_confidence\` and \`layout_confidence\` are not returned for a line crop** — every crop is one \`math\` region, and those two fields come back null; they appear only on a full page (\`page_confidence\` from v3/text, and per region from v3/pdf, below). What a crop gets is the old \`confidence\` / \`confidence_rate\`.`,
    "",
  );

  // v3/text calibration, weighted scoreboard + unweighted young/layouts
  out.push(
    "### v3/text `confidence`, calibrated",
    "",
    "Over every line with a strokes read (stratified weights: the misreads are 2.9 % of those lines, not the sample's 11 %), then",
    "over the young kids' lines and the layouts (as sampled). \"Trusted\" = confidence ≥ the threshold; the rest would get \"I read: … — tap to fix\".",
    "",
  );
  const textGates = THRESHOLDS.map((t) => gate(run, w, `≥ ${t}`, okT, (r) => (r.text?.confidences?.confidence ?? 0) >= t, hasT));
  out.push(...gateTable(textGates, "v3/text confidence"), "");
  const other = maths.filter((r) => !scoreboardStrata(r) && r.text);
  out.push("Young kids' lines, stacked sums, long divisions and divisors (unweighted):", "", "| v3/text confidence | reads trusted | right when trusted | wrong reads trusted | reads asked about | of them wrong |", "| --- | --- | --- | --- | --- | --- |");
  for (const t of THRESHOLDS) {
    const hi = other.filter((r) => (r.text!.confidences?.confidence ?? 0) >= t);
    const lo = other.filter((r) => (r.text!.confidences?.confidence ?? 0) < t);
    out.push(`| ≥ ${t} | ${hi.length} | ${pct(hi.filter(okT).length, hi.length, 1)} | ${hi.filter((r) => !okT(r)).length} | ${lo.length} | ${lo.filter((r) => !okT(r)).length} |`);
  }
  const wrongs = maths.filter((r) => r.text && !okT(r));
  const confidentWrong = wrongs.filter((r) => r.text!.confidence >= 0.9).sort((a, b) => b.text!.confidence - a.text!.confidence);
  const unsureRight = maths.filter((r) => r.text && okT(r) && r.text.confidence < 0.9);
  out.push(
    "",
    `The confidences of v3/text's ${wrongs.length} wrong reads: ${wrongs.map((r) => r.text!.confidence).sort((a, b) => b - a).map((c) => c.toFixed(2)).join(", ")}.`,
    `Wrong at ≥ 0.9: ${confidentWrong.map((r) => `${code(r.latex)} → ${code(r.text!.latex)} (${c3(r.text!.confidence)})`).join(", ") || "none"}.`,
    `Right below 0.9: ${unsureRight.map((r) => `${code(r.latex)} (${r.type}, ${c3(r.text!.confidence)})`).join(", ") || "none"}.`,
    "",
  );

  // strokes confidence over the whole population, and the agreement gate
  const sr = run.corpus.strokesReads;
  out.push(
    "### Against what the board has today",
    "",
    `Mathpix's **strokes** confidence over every strokes read on disk (${sr.length} distinct lines, ${sr.filter((x) => !x.ok).length} wrong; exact counts, no sampling):`,
    "",
    "| strokes confidence | lines asked about | right when trusted | wrong reads caught | right reads asked about (needless) |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const t of THRESHOLDS) {
    const hi = sr.filter((x) => x.c >= t);
    const lo = sr.filter((x) => x.c < t);
    out.push(`| ≥ ${t} | ${pct(lo.length, sr.length, 1)} | ${pct(hi.filter((x) => x.ok).length, hi.length, 1)} | ${pct(lo.filter((x) => !x.ok).length, sr.filter((x) => !x.ok).length)} | ${pct(lo.filter((x) => x.ok).length, sr.filter((x) => x.ok).length, 1)} |`);
  }
  const agree = (r: LineResult) => Boolean(r.strokes && r.text) && sameRead(r.strokes!.latex, r.text!.latex);
  const both2 = (r: LineResult) => hasS(r) && hasT(r);
  const agreeGates = [
    gate(run, w, "strokes alone, no question", okS, () => true, both2),
    gate(run, w, "strokes confidence ≥ 0.99", okS, (r) => r.strokes!.confidence >= 0.99, both2),
    gate(run, w, "strokes confidence ≥ 0.999", okS, (r) => r.strokes!.confidence >= 0.999, both2),
    gate(run, w, "v3/text confidence ≥ 0.99 (v3/text's read)", okT, (r) => (r.text!.confidences?.confidence ?? 0) >= 0.99, both2),
    gate(run, w, "**v3/text reads the same maths as strokes**", okS, agree, both2),
    gate(run, w, "same maths, and strokes confidence ≥ 0.99", okS, (r) => agree(r) && r.strokes!.confidence >= 0.99, both2),
  ];
  const dis = R.filter((r) => scoreboardStrata(r) && both2(r) && !agree(r));
  const disRight = dis.filter((r) => r.stratum === "strokes-right");
  const disWrong = dis.filter((r) => r.stratum === "misread");
  const swap = pooled(run, (r) => (agree(r) ? okS(r) : okT(r)), both2);
  out.push(
    "",
    "The **second-opinion gate**: read every line with v3/text as well (in parallel with strokes, so no added wait at 0.2 s against",
    "0.45 s) and ask the kid only when the two readers disagree. Weighted over every line with a strokes read:",
    "",
    ...gateTable(agreeGates, "rule (the strokes read is used unless asked)"),
    "",
    `They disagreed on ${frac(disWrong.length, misreads.length)} of the strokes misreads and on ${frac(disRight.length, R.filter((r) => r.stratum === "strokes-right").length)} of the right reads sampled. On a disagreement v3/text was the right one ${dis.filter(okT).length} times, strokes ${dis.filter(okS).length}. Taking v3/text's read on every disagreement instead of asking: ${(100 * swap.rate).toFixed(1)}% right (strokes alone ${pct(run.corpus.withStrokes - run.corpus.strokesWrong, run.corpus.withStrokes, 1)}) — it fixes ${swap.wrong[0]} of ${swap.wrong[1]} misreads and breaks ${swap.right[1] - swap.right[0]} of ${swap.right[1]} right reads.`,
    "",
    "The **vision model's** own confidence is no gate: it said " +
      [...R.filter(hasV).reduce((m, r) => m.set(r.vision!.confidence, (m.get(r.vision!.confidence) ?? 0) + 1), new Map<number, number>()).entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([c, n]) => `${c} (${n}×)`)
        .join(", ") +
      ` on its ${R.filter(hasV).length} reads, wrong ones included (${R.filter((r) => hasV(r) && !okV(r) && r.vision!.confidence >= 0.95).length} wrong reads at ≥ 0.95).`,
    "",
  );

  // ---------------------------------------------------------------- drawings
  const drawings = R.filter((r) => r.set === "drawings");
  out.push(
    "## Drawings on their own (nothing to read)",
    "",
    "The board sets drawings aside before it reads (`splitInk`), so these only matter when one slips through:",
    "",
    "| drawing | hand | v3/text | vision model |",
    "| --- | --- | --- | --- |",
    ...drawings.map((r) => `| ${r.id} | ${r.variant} | ${r.text?.ok ? (r.text.latex ? `${code(r.text.latex)} (${c3(r.text.confidence)})` : "nothing") : "`image_no_content`"} | ${r.vision ? (r.vision.latex ? `${code(r.vision.latex)} (${c3(r.vision.confidence)}, isMath ${r.vision.isMath})` : "nothing") : "–"} |`),
    "",
  );

  // ---------------------------------------------------------------- what v3/text gets wrong
  out.push("## Every wrong v3/text read", "", "| stratum | hand | written | v3/text (conf) | strokes | vision |", "| --- | --- | --- | --- | --- | --- |");
  for (const r of maths.filter((x) => x.text && !okT(x)))
    out.push(`| ${r.stratum} | ${r.variant} | ${code(r.latex)} | ${r.text!.ok ? `${code(r.text!.latex)} (${c3(r.text!.confidence)})` : `\`${r.text!.reason}\``} | ${r.strokes ? code(r.strokes.latex) : "–"} | ${r.vision ? `${mark(r.vision.verdict)} ${code(r.vision.latex)}` : "–"} |`);
  const visionStackWrong = R.filter((r) => r.stratum === "stacked" && r.vision && !okV(r));
  // the same read with its column spec, `\phantom` and `\quad` taken out: the right digits in a shape the board rejects?
  const tidy = (l: string) => l.replace(/\\begin\{array\}\{(?:[^{}]|\{[^{}]*\})*\}/, "\\begin{array}{r}").replace(/\\phantom\{[^{}]*\}|\\quad/g, "").replace(/\+\s+/g, "+");
  const visionShape = visionStackWrong.filter((r) => isRight(judgeLine(r, { ok: true, latex: tidy(r.vision!.latex) })));
  const visionDiv = R.filter((r) => r.stratum === "long division" && r.vision && !okV(r));
  out.push(
    "",
    `Vision's stacked sums: ${visionShape.length} of its ${visionStackWrong.length} wrong ones were the right digits in a shape the board's stack parser rejects (${[...new Set(visionShape.map((r) => code(r.vision!.latex.slice(0, 28) + "…")))].slice(0, 3).join(", ")}), so on the board they would not be worked as sums. Its wrong long divisions: ${visionDiv.map((r) => code(r.vision!.latex)).join(", ") || "none"} (no bracket the board knows). v3/text's: ${[stacks.find(okT), longDiv.find(okT)].filter((r): r is LineResult => Boolean(r)).map((r) => code(r.text!.latex.slice(0, 60))).join(", ")} — the shapes the board's parsers were built on.`,
    "",
  );

  // ---------------------------------------------------------------- worksheets
  out.push(
    "## Snap your homework: one problem per page",
    "",
    "Five synthetic worksheets drawn by the eval (printed problems in Helvetica, the kid's answers in the tutor's hand; two made to",
    "look like a phone photo: turned 1.6° / −2.2°, uneven light, grain). Each read three ways; a problem is **split right** when",
    "grouping the regions geometrically (a region starting with its number opens it; every other region joins the nearest number",
    "above it in its column) gives a box that overlaps where the problem is (IoU ≥ 0.5).",
    "",
    "| worksheet | reader | problems numbered | split right | regions inside one problem | kid's writing with its problem | page confidence (all / text / layout) | regions with text / layout confidence | regions flagged handwritten | time |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  const tot = new Map<string, { split: number; problems: number; ms: number[] }>();
  for (const s of sheets)
    for (const r of s.reads) {
      const sc = r.score;
      const t = tot.get(r.reader) ?? { split: 0, problems: 0, ms: [] };
      t.problems += s.problems;
      t.split += sc?.splitRight ?? 0;
      t.ms.push(r.ms);
      tot.set(r.reader, t);
      const pc = r.pageConfidence;
      out.push(
        `| ${s.name} | ${r.reader} | ${sc ? `${sc.numbersFound}/${sc.problems}` : r.error ?? "failed"} | ${sc ? `**${sc.splitRight}/${sc.problems}**` : "–"} | ${sc ? `${sc.pureRegions}/${sc.regionsOverProblems}` : "–"} | ${sc ? `${sc.handwritingAttached}/${sc.handwriting}` : "–"} | ${pc ? [pc.confidence, pc.text_confidence, pc.layout_confidence].map((v) => c3(v).slice(0, 4)).join(" / ") : "–"} | ${r.regionTextConfidence} / ${r.regionLayoutConfidence} of ${r.regions} | ${r.handwritten} | ${(r.ms / 1000).toFixed(1)} s |`,
      );
    }
  out.push("", "| reader | problems split right | time per page (median) | price per page |", "| --- | --- | --- | --- |");
  for (const [reader, t] of tot) out.push(`| ${reader} | ${frac(t.split, t.problems)} | ${(quantile(t.ms, 0.5) / 1000).toFixed(1)} s | ${reader === "v3/pdf" ? `$${MATHPIX_PRICE.pdfPage.toFixed(3)}` : `$${MATHPIX_PRICE.text.toFixed(3)} (an image of more than 12 rows of text may be billed at the PDF rate)`} |`);
  const arithmetic = sheets.find((s) => /arithmetic/.test(s.name))?.reads.find((r) => r.reader === "v3/text")?.score?.texts;
  if (arithmetic) {
    out.push("", "What v3/text read for each problem of the arithmetic grid (a photo):", "", "| problem | regions, in Mathpix's order |", "| --- | --- |");
    for (const [n, t] of Object.entries(arithmetic)) out.push(`| ${n} | ${code(t.slice(0, 160))} |`);
  }
  out.push(
    "",
    "## Caveats",
    "",
    "- **None of this is a child's handwriting.** The lines are the tutor's own hand engine, perturbed; its glyphs are neat and",
    "  font-like, and its `a`, `e`, `i` and `u` have look-alikes every reader trips on. The iPad reader study (feat/ipad-reader,",
    "  docs/READER.md) reached the same limit. Real kids' ink decides it; this eval can only rank the readers on the same ink.",
    "- The crop is the iPad's (the hand-drawn path of `captureInkCrop`). On desktop browsers the board's first try is tldraw's own",
    "  export (variable-width, 2× pixel ratio), which may read differently.",
    "- Strokes reads are the cached ones; young kids' lines, stacked sums and long divisions have none on disk, so those rows have",
    "  no strokes comparison. No strokes call was made.",
    "- The worksheets are clean, synthetic and well spaced. A real photo of homework (crowded, handwriting crossing problems, a",
    "  page curling, a shadow over a column) is a much harder split; treat the worksheet result as \"works on the easy case\".",
    "- Latency is from this Mac over home broadband; the server (Vercel, iad1) is likely faster to both providers.",
    "",
  );
  return out.join("\n") + "\n";
}
