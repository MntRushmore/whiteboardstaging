/**
 * docs/eval/models.md: one table per job, a rule-based ranking, and the per-item grids.
 *
 * The hand-written recommendation lives between `<!-- recommendation:start -->` and
 * `<!-- recommendation:end -->` and is carried over from the existing file on every rewrite, so
 * rerunning the bench refreshes the numbers without losing the analysis.
 */
import { cell, code, table } from "../report";
import { INCUMBENTS, JOB_SETTINGS, JOB_TITLE, PILOT_ITEMS, SPEND_CAP_USD, type BenchPlan, type BenchRun, type ItemResult, type JobId } from "./bench";
import type { SpendState } from "./client";
import type { FallbackScore } from "./fallback";
import type { ReadScore } from "./misreads";
import type { WordScore } from "./wordProblems";

const API_FAILURES = new Set(["http", "timeout", "network", "empty"]);

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

const mean = (xs: readonly number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pctOf = (n: number, d: number) => (d === 0 ? "–" : `${Math.round((100 * n) / d)}%`);
const frac = (n: number, d: number) => `${n}/${d} (${pctOf(n, d)})`;
const secs = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`);
const usd = (x: number) => (x >= 0.01 ? `$${x.toFixed(3)}` : `$${x.toFixed(5)}`);
export const shortName = (model: string) => model.replace(/^[^/]+\//, "");

export interface CommonStats {
  n: number;
  apiFailures: number;
  badOutput: number;
  p50: number | null;
  p95: number | null;
  outTokens: number;
  reasoningTokens: number;
  costPerCall: number;
  spend: number;
  budgetSkipped: number;
}

function common(rs: readonly ItemResult[], bad: (r: ItemResult) => boolean): CommonStats {
  const ran = rs.filter((r) => r.call.failure !== "budget");
  const answered = ran.filter((r) => r.call.ok || r.call.failure === "empty");
  const lat = answered.map((r) => r.call.latencyMs);
  return {
    n: ran.length,
    apiFailures: ran.filter((r) => r.call.failure && API_FAILURES.has(r.call.failure)).length,
    badOutput: ran.filter((r) => r.call.ok && bad(r)).length,
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    outTokens: mean(answered.map((r) => r.call.completionTokens)),
    reasoningTokens: mean(answered.map((r) => r.call.reasoningTokens)),
    costPerCall: mean(ran.map((r) => r.call.costUsd)),
    spend: ran.reduce((a, r) => a + r.call.costUsd, 0),
    budgetSkipped: rs.length - ran.length,
  };
}

const wordOf = (r: ItemResult): WordScore | null => (r.score?.kind === "word" ? r.score.score : null);
const fbOf = (r: ItemResult): FallbackScore | null => (r.score?.kind === "fallback" ? r.score.score : null);
const readOf = (r: ItemResult): ReadScore | null => (r.score?.kind === "repair" ? r.score.score : null);

export interface WordStats extends CommonStats {
  correct: number;
  outcomes: Record<string, number>;
  words: number;
  stated: number;
}
export function wordStats(rs: readonly ItemResult[]): WordStats {
  const c = common(rs, (r) => wordOf(r)?.outcome === "bad-json");
  const scores = rs.map(wordOf).filter((s): s is WordScore => Boolean(s));
  const outcomes: Record<string, number> = {};
  for (const s of scores) outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
  if (c.apiFailures > 0) outcomes["api-failure"] = c.apiFailures;
  return { ...c, correct: scores.filter((s) => s.correct).length, outcomes, words: scores.filter((s) => s.words).length, stated: scores.filter((s) => s.stated).length };
}

export interface FallbackStats extends CommonStats {
  usable: number;
  usableWithC: number;
  stepsPassedWithC: number;
  answer: number;
  finalDrawn: number;
  steps: number;
  stepsPassed: number;
  wordy: number;
  rejections: Record<string, number>;
}
export function fallbackStats(rs: readonly ItemResult[]): FallbackStats {
  const c = common(rs, (r) => Boolean(fbOf(r)?.badOutput));
  const scores = rs.map(fbOf).filter((s): s is FallbackScore => Boolean(s));
  const rejections: Record<string, number> = {};
  for (const s of scores) for (const st of s.steps) if (!st.ok && st.reason) rejections[st.reason] = (rejections[st.reason] ?? 0) + 1;
  return {
    ...c,
    usable: scores.filter((s) => s.usable).length,
    usableWithC: scores.filter((s) => s.usableWithC).length,
    stepsPassedWithC: scores.reduce((a, s) => a + s.stepsPassedWithC, 0),
    answer: scores.filter((s) => s.answerCorrect).length,
    finalDrawn: scores.filter((s) => s.finalDrawn).length,
    steps: scores.reduce((a, s) => a + s.steps.length, 0),
    stepsPassed: scores.reduce((a, s) => a + s.stepsPassed, 0),
    wordy: scores.filter((s) => s.words).length,
    rejections,
  };
}

export interface RepairStats extends CommonStats {
  misreads: number;
  fixed: number;
  untouched: number;
  realMisreads: number;
  realFixed: number;
  controls: number;
  broken: number;
  correct: number;
}
export function repairStats(rs: readonly ItemResult[]): RepairStats {
  const c = common(rs, (r) => Boolean(readOf(r)?.badJson));
  const ran = rs.filter((r) => r.call.failure !== "budget");
  const kindOf = (r: ItemResult) => (r.itemId.startsWith("ct-") ? "control" : r.itemId.startsWith("sy-") ? "synthetic" : "misread");
  const mis = ran.filter((r) => kindOf(r) !== "control");
  const real = ran.filter((r) => kindOf(r) === "misread");
  const ctl = ran.filter((r) => kindOf(r) === "control");
  const ok = (r: ItemResult) => Boolean(readOf(r)?.correct);
  return {
    ...c,
    misreads: mis.length,
    fixed: mis.filter(ok).length,
    untouched: mis.filter((r) => readOf(r) && !readOf(r)!.changed).length,
    realMisreads: real.length,
    realFixed: real.filter(ok).length,
    controls: ctl.length,
    // a failed call or unreadable reply leaves Mathpix's read in place: not a break
    broken: ctl.filter((r) => {
      const sc = readOf(r);
      return Boolean(sc && !sc.badJson && !sc.correct);
    }).length,
    correct: ran.filter(ok).length,
  };
}

/**
 * Lines per 1000 a repair pass would fix minus lines it would break, if it ran on EVERY line:
 * `misreadRate` is the share of lines Mathpix gets wrong in the handwriting scoreboard.
 */
export function netPer1000(s: RepairStats, misreadRate: number): number | null {
  if (s.realMisreads === 0 || s.controls === 0) return null;
  return 1000 * (misreadRate * (s.realFixed / s.realMisreads) - (1 - misreadRate) * (s.broken / s.controls));
}

// ---------------------------------------------------------------- ranking

export interface Ranked {
  model: string;
  key: number[];
}

/** Sort keys: higher is better for the first ones, then p50 and cost ascending. */
function rank(rows: Array<{ model: string; primary: number[]; p50: number | null; cost: number }>): string[] {
  return [...rows]
    .sort((a, b) => {
      for (let i = 0; i < Math.max(a.primary.length, b.primary.length); i++) {
        const d = (b.primary[i] ?? 0) - (a.primary[i] ?? 0);
        if (Math.abs(d) > 1e-9) return d;
      }
      const dl = (a.p50 ?? Infinity) - (b.p50 ?? Infinity);
      if (dl !== 0) return dl;
      return a.cost - b.cost;
    })
    .map((r) => r.model);
}

// ---------------------------------------------------------------- markdown

function planNote(plan: BenchPlan | undefined, n: number, total: number): string {
  const notes: string[] = [];
  if (plan?.note) notes.push(plan.note);
  else if (n < total) notes.push(`${n} of ${total} items`);
  return notes.join("; ");
}

function modelCell(model: string): string {
  return `\`${shortName(model)}\`${INCUMBENTS.has(model) ? " (incumbent)" : ""}`;
}

function grid(job: JobId, run: BenchRun, ids: string[], mark: (r: ItemResult) => string, label: (id: string) => string): string {
  const models = [...new Set(run.results.filter((r) => r.job === job).map((r) => r.model))];
  const byKey = new Map(run.results.filter((r) => r.job === job).map((r) => [`${r.model}|${r.itemId}`, r]));
  const rows = ids.map((id) => [label(id), ...models.map((m) => {
    const r = byKey.get(`${m}|${id}`);
    return r ? mark(r) : "";
  })]);
  return table(["item", ...models.map(shortName)], rows);
}

function failMark(r: ItemResult): string | null {
  if (r.call.failure === "budget") return "$";
  if (!r.call.ok) return r.call.failure === "timeout" ? "⏱" : "💥";
  return null;
}

export interface ReportInput {
  run: BenchRun;
  spend: SpendState;
  spentThisRun: number;
  catalogFetchedAt: string;
  misreadRate: number;
  date: string;
  previous?: string;
}

const REC_START = "<!-- recommendation:start -->";
const REC_END = "<!-- recommendation:end -->";

function preserved(previous: string | undefined): string {
  if (previous) {
    const a = previous.indexOf(REC_START);
    const b = previous.indexOf(REC_END);
    if (a !== -1 && b > a) return previous.slice(a, b + REC_END.length);
  }
  return `${REC_START}\n_No written recommendation yet: read the tables below._\n${REC_END}`;
}

export function renderModelsMarkdown(input: ReportInput): string {
  const { run } = input;
  const out: string[] = [];
  const planOf = (job: JobId, model: string) => run.plans.find((p) => p.job === job && p.model === model);
  const resultsOf = (job: JobId, model: string) => run.results.filter((r) => r.job === job && r.model === model);
  const modelsOf = (job: JobId) => run.plans.filter((p) => p.job === job).map((p) => p.model);

  out.push("# Model bench: cheap and fast models for the three model jobs");
  out.push("");
  out.push(`Run ${input.date}. Generated by \`npm run eval:models\` (\`src/__eval__/models/**\`); every response is cached under \`src/__eval__/.cache/models/\`, so a rerun is free and reproduces these numbers. Prices and capabilities from the OpenRouter catalog fetched ${input.catalogFetchedAt}.`);
  out.push("");
  out.push(`**Spend:** $${input.spend.totalUsd.toFixed(4)} in ${input.spend.calls} OpenRouter calls in total (cap $${SPEND_CAP_USD.toFixed(2)} of the $5.00 approved; $${input.spentThisRun.toFixed(4)} of it in the run that wrote this file). Cost per call is OpenRouter's own \`usage.cost\`.`);
  if (run.missing.length > 0) out.push(`\n**Not on OpenRouter (skipped):** ${run.missing.map((m) => `\`${m}\``).join(", ")}.`);
  out.push("");
  out.push("## Recommendation");
  out.push("");
  out.push(preserved(input.previous));
  out.push("");

  out.push("## How each job is run");
  out.push("");
  out.push(table(
    ["job", "items", "prompt", "output", "settings"],
    [
      ["1. word problems", `${run.jobs.word.length} school word problems with known answers`, "bench prompt `WORD_SETUP_SYSTEM_PROMPT` (wordProblems.ts): set up, never calculate", "JSON `{unknown, lines[]}`; the lines go through `localSolve` (the board's local Solve) and the engine's answer is compared numerically", `reasoning ${JOB_SETTINGS.word.reasoning("x")}, max ${JOB_SETTINGS.word.maxTokens} tokens, JSON mode, timeout ${JOB_SETTINGS.word.timeoutMs / 1000} s`],
      ["2. solve fallback", `${run.jobs.fallback.length} problems \`localSolve\` returns \`source: null\` for`, "the product's `buildSolveMessages` (prompts/solve.ts), unchanged", "JSON Lines parsed by the route's `jsonlToEvents` + `SolveStepSchema` (8-step cap, last step boxed), then every step through `createSolveStepGuard` + `engineParsesStep`", `reasoning ${JOB_SETTINGS.fallback.reasoning("x")}, max ${JOB_SETTINGS.fallback.maxTokens} tokens (as /api/live/solve), timeout ${JOB_SETTINGS.fallback.timeoutMs / 1000} s`],
      ["3. misread repair", `${run.jobs.repair.filter((i) => i.kind === "misread").length} real Mathpix misreads + ${run.jobs.repair.filter((i) => i.kind === "synthetic").length} synthetic + ${run.jobs.repair.filter((i) => i.kind === "control").length} correct reads (controls)`, "bench prompt `REPAIR_SYSTEM_PROMPT` (misreads.ts): image of the ink + Mathpix's LaTeX + the lines above", "JSON `{latex, changed}`, judged by the handwriting scoreboard's `judgeRead` against what was written", `reasoning minimal (Anthropic: none), max ${JOB_SETTINGS.repair.maxTokens} tokens, JSON mode, timeout ${JOB_SETTINGS.repair.timeoutMs / 1000} s; PNG ${run.imageBytes.min}–${run.imageBytes.max} bytes`],
    ],
  ));
  out.push("");
  out.push(`Every call: temperature 0 where the model takes it (GPT-5.4 and Sonnet 5 do not; their default is used), \`provider.sort: latency\` as the Live routes stream with, at most 4 in flight. Latency is wall clock per call, non-streaming (the board writes a model's steps only when the stream ends, so the whole reply is what the student waits for). Every model was piloted on the first ${PILOT_ITEMS} items of each job before the rest ran.`);
  out.push("");

  // ---- job 1
  {
    const job: JobId = "word";
    const total = run.jobs.word.length;
    const rows = modelsOf(job).map((m) => ({ m, s: wordStats(resultsOf(job, m)) }));
    out.push(`## 1. ${JOB_TITLE.word}`);
    out.push("");
    out.push("Accuracy = the engine, solving the model's setup, gets the known answer. A model that computes the answer itself, or writes a setup the engine cannot solve, does not score.");
    out.push("");
    out.push(table(
      ["model", "accuracy", "fail (API / bad JSON)", "p50", "p95", "out tokens (reasoning)", "$/call", "$/1000", "notes"],
      rows.map(({ m, s }) => [modelCell(m), frac(s.correct, s.n), `${pctOf(s.apiFailures + s.badOutput, s.n)} (${s.apiFailures} / ${s.badOutput})`, secs(s.p50), secs(s.p95), `${Math.round(s.outTokens)} (${Math.round(s.reasoningTokens)})`, usd(s.costPerCall), usd(s.costPerCall * 1000), planNote(planOf(job, m), s.n, total)]),
    ));
    out.push("");
    out.push("Where the points went (per model): " + rows.map(({ m, s }) => `\`${shortName(m)}\` ${Object.entries(s.outcomes).filter(([k]) => k !== "correct").map(([k, v]) => `${k} ${v}`).join(", ") || "none lost"}${s.stated ? `; stated the answer in a line ${s.stated}×` : ""}${s.words ? `; words ${s.words}×` : ""}`).join(" · ") + ".");
    out.push("");
    out.push(`Rule-based order (accuracy, then p50, then cost): ${rank(rows.filter(({ s }) => s.n > 0).map(({ m, s }) => ({ model: m, primary: [s.correct / s.n], p50: s.p50, cost: s.costPerCall }))).map((m) => `\`${shortName(m)}\``).join(" > ")}.`);
    out.push("");
  }

  // ---- job 2
  {
    const job: JobId = "fallback";
    const total = run.jobs.fallback.length;
    const rows = modelsOf(job).map((m) => ({ m, s: fallbackStats(resultsOf(job, m)) }));
    out.push(`## 2. ${JOB_TITLE.fallback}`);
    out.push("");
    out.push("**usable** = what the student would actually see is right: the final step survives the board's step guard, its answer is numerically correct, and no step carries words. **answer** = the final step is right whatever the guard says. **steps through guard** = steps `createSolveStepGuard` lets through (the rest are silently dropped on the board). **usable if + C were allowed** = the same as usable with the integration constant `C` in the guard's scope — a what-if: today's guard rejects every `+ C` as a symbol from nowhere, so no antiderivative is ever drawn, whichever model wrote it.");
    out.push("");
    out.push(table(
      ["model", "usable", "answer", "usable if + C were allowed", "steps through guard (with + C)", "no words", "fail (API / no steps)", "p50", "p95", "out tokens (reasoning)", "$/call", "$/1000", "notes"],
      rows.map(({ m, s }) => [modelCell(m), frac(s.usable, s.n), frac(s.answer, s.n), frac(s.usableWithC, s.n), `${frac(s.stepsPassed, s.steps)} (${pctOf(s.stepsPassedWithC, s.steps)})`, pctOf(s.n - s.wordy - s.apiFailures - s.badOutput, s.n - s.apiFailures - s.badOutput), `${pctOf(s.apiFailures + s.badOutput, s.n)} (${s.apiFailures} / ${s.badOutput})`, secs(s.p50), secs(s.p95), `${Math.round(s.outTokens)} (${Math.round(s.reasoningTokens)})`, usd(s.costPerCall), usd(s.costPerCall * 1000), planNote(planOf(job, m), s.n, total)]),
    ));
    out.push("");
    out.push("Why the guard dropped steps (all models): " + Object.entries(rows.reduce<Record<string, number>>((acc, { s }) => {
      for (const [k, v] of Object.entries(s.rejections)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {})).map(([k, v]) => `${k} ${v}`).join(", ") + ".");
    out.push("");
    out.push(`Rule-based order (answer, then usable with + C, then usable, then p50, then cost — usable alone is decided by the guard's + C rule more than by the model): ${rank(rows.filter(({ s }) => s.n > 0).map(({ m, s }) => ({ model: m, primary: [s.answer / s.n, s.usableWithC / s.n, s.usable / s.n], p50: s.p50, cost: s.costPerCall }))).map((m) => `\`${shortName(m)}\``).join(" > ")}.`);
    out.push("");
  }

  // ---- job 3
  {
    const job: JobId = "repair";
    const total = run.jobs.repair.length;
    const rows = modelsOf(job).map((m) => ({ m, s: repairStats(resultsOf(job, m)) }));
    out.push(`## 3. ${JOB_TITLE.repair}`);
    out.push("");
    out.push(`**fixed** = a misread (real or synthetic) comes back as what was written (exact or the same maths). **broke** = a CORRECT read (control) comes back as something else (a failed call or an unreadable reply keeps Mathpix's read, so it is a failure, not a break). The synthetic misreads turned out to be guessable from the LaTeX alone (every model fixed all six, including one that fixed no real misread), so **fixed (real only)** is the column that measures reading the image. **net / 1000 lines** = real misreads fixed minus correct reads broken if the repair ran on every line, at the scoreboard's misread rate (${(input.misreadRate * 100).toFixed(1)}% of lines): the cost of a false correction is paid on the ~${Math.round((1 - input.misreadRate) * 100)}% of lines Mathpix already reads right.`);
    out.push("");
    out.push(table(
      ["model", "fixed (all misreads)", "fixed (real only)", "left unchanged", "broke a correct read", "net / 1000 lines", "fail (API / bad JSON)", "p50", "p95", "out tokens (reasoning)", "$/call", "$/1000", "notes"],
      [
        ["Mathpix alone (no repair)", `0/${run.jobs.repair.filter((i) => i.kind !== "control").length} (0%)`, "0%", "100%", `0/${run.jobs.repair.filter((i) => i.kind === "control").length} (0%)`, "0", "–", "–", "–", "–", "$0", "$0", "baseline"],
        ...rows.map(({ m, s }) => {
          const net = netPer1000(s, input.misreadRate);
          return [modelCell(m), frac(s.fixed, s.misreads), frac(s.realFixed, s.realMisreads), pctOf(s.untouched, s.misreads), frac(s.broken, s.controls), net === null ? "–" : net.toFixed(1), `${pctOf(s.apiFailures + s.badOutput, s.n)} (${s.apiFailures} / ${s.badOutput})`, secs(s.p50), secs(s.p95), `${Math.round(s.outTokens)} (${Math.round(s.reasoningTokens)})`, usd(s.costPerCall), usd(s.costPerCall * 1000), planNote(planOf(job, m), s.n, total)];
        }),
      ],
    ));
    out.push("");
    out.push(`Rule-based order (fewest broken controls, then most real misreads fixed, then p50, then cost): ${rank(rows.filter(({ s }) => s.n > 0).map(({ m, s }) => ({ model: m, primary: [-(s.broken / Math.max(1, s.controls)), s.realFixed / Math.max(1, s.realMisreads)], p50: s.p50, cost: s.costPerCall }))).map((m) => `\`${shortName(m)}\``).join(" > ")}.`);
    out.push("");
  }

  // ---- per item
  out.push("## Per item");
  out.push("");
  out.push("✓ right, ✗ wrong, ⏱ timeout, 💥 API error / no reply, $ skipped by the spend cap, blank = not run (budget plan).");
  out.push("");
  out.push("<details><summary>1. Word problems: ✓ engine got the answer · ✗ wrong answer · ∅ engine could not solve the setup · = model stated the answer itself · J bad JSON</summary>\n");
  out.push(grid("word", run, run.jobs.word.map((p) => p.id), (r) => {
    const f = failMark(r);
    if (f) return f;
    const s = wordOf(r)!;
    return { correct: "✓", "wrong-answer": "✗", "engine-cannot-solve": "∅", "answered-itself": "=", "bad-json": "J" }[s.outcome];
  }, (id) => {
    const p = run.jobs.word.find((x) => x.id === id)!;
    return `${id} ${cell(p.lines.map((l) => l.replace(/^\\text\{|\}$/g, "")).join(" "))} → ${p.answer}`;
  }));
  out.push("\n</details>\n");
  out.push("<details><summary>2. Solve fallback: ✓ usable · C usable only if + C were allowed · A right answer but the final step is dropped by the guard or has words · ✗ wrong answer · J no valid step; then steps through the guard</summary>\n");
  out.push(grid("fallback", run, run.jobs.fallback.map((p) => p.id), (r) => {
    const f = failMark(r);
    if (f) return f;
    const s = fbOf(r)!;
    if (s.badOutput) return "J";
    return `${s.usable ? "✓" : s.usableWithC ? "C" : s.answerCorrect ? "A" : "✗"} ${s.stepsPassed}/${s.steps.length}`;
  }, (id) => {
    const p = run.jobs.fallback.find((x) => x.id === id)!;
    return `${id} ${p.area}: ${code(p.lines.join("; "))} → ${code(p.answer)}`;
  }));
  out.push("\n</details>\n");
  out.push("<details><summary>3. Misread repair: ✓ right after repair · ✗ wrong (for a control: a correct read broken) · J bad JSON</summary>\n");
  out.push(grid("repair", run, run.jobs.repair.map((i) => i.id), (r) => {
    const f = failMark(r);
    if (f) return f;
    const s = readOf(r)!;
    return s.badJson ? "J" : s.correct ? "✓" : "✗";
  }, (id) => {
    const it = run.jobs.repair.find((x) => x.id === id)!;
    return `${id} (${it.kind}, ${it.variant}) ${code(it.truth)} read ${code(it.read)}`;
  }));
  out.push("\n</details>\n");

  out.push("## Caveats");
  out.push("");
  out.push(`- **Small samples.** ${run.jobs.word.length} / ${run.jobs.fallback.length} / ${run.jobs.repair.length} items per job, one run at temperature 0: one item is ${Math.round(100 / Math.max(1, run.jobs.word.length))}–${Math.round(100 / Math.max(1, run.jobs.repair.filter((i) => i.kind === "control").length))} percentage points. Differences of one or two items are noise; read the tables as tiers, not a leaderboard.`);
  out.push("- **Latency** is one machine, one afternoon, through OpenRouter's latency-sorted routing; p95 over ≤ 25 calls is close to the maximum. Cached reruns report the first run's timings.");
  out.push("- **Prompts.** Job 2 uses the product's solve prompt verbatim; jobs 1 and 3 use bench prompts written for this test (a better prompt could move every model). The repair prompt names the classes of confusion Mathpix makes (look-alike letters and digits, case, bars, lost limits), which are also the classes in the test set; the synthetic items only partly offset that.");
  out.push("- **Answers are judged numerically** (`answers.ts` over the scoreboard's oracle). An answer in a form the oracle cannot read — a tuple the parser does not know, degrees for a radian question — counts as wrong.");
  out.push("- **Handwriting is the tutor's own hand** (the handwriting scoreboard's ink), not a student's; images are rendered from the strokes at up to 2× the page scale.");
  out.push("");
  return out.join("\n") + "\n";
}
