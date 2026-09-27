/**
 * The PROOFS scoreboard (offline: no recognizer, no model). Over the corpus of two-column proofs in
 * `courses/geometryProofs.ts`:
 *
 *  (a) the checker ticks every row of every correct proof (with the figure read; and how many rows
 *      stay unmarked without it — the figure facts only a figure can confirm);
 *  (b) the checker rings seeded errors: automatic ones in every proof (a wrong reason, a derived
 *      row called Given, the wrong correspondence, CPCTC too early, the wrong postulate, a missing
 *      prerequisite) and hand-written ones (SSA, AAA, …);
 *  (c) the planner finishes every proof from every prefix, from the figure read alone.
 *
 * `npm run eval:proofs` writes `docs/eval/proofs.md`.
 */
import { checkProof, type ProofProblem, type RowVerdict } from "@/lib/live/proof/checker";
import { parseStatement, type Statement } from "@/lib/live/proof/facts";
import { buildFigure, type FigureRead } from "@/lib/live/proof/figure";
import { planProof, type PlannedRow } from "@/lib/live/proof/planner";
import { Resolver } from "@/lib/live/proof/resolve";
import { normalizeReason, resolveBisector, REASON_TEXT, type ReasonId } from "@/lib/live/proof/vocab";
import { GEOMETRY_PROOFS, HAND_SEEDED, type ProofCase, type SeededCase } from "./courses/geometryProofs";

type Rows = ReadonlyArray<readonly [string, string]>;

export function reasonOf(latex: string, statement: Statement | null): ReasonId | null {
  return resolveBisector(normalizeReason(latex), statement?.facts.some((f) => f.t === "angCong") ?? false);
}

/** A corpus proof as the checker takes it. */
export function problemOf(given: string, prove: string, rows: Rows, opts: { givenLine?: boolean } = {}): ProofProblem {
  return {
    givens: opts.givenLine === false ? null : parseStatement(given),
    prove: parseStatement(prove),
    rows: rows.map(([s, r]) => {
      const statement = parseStatement(s);
      return { statement, reason: reasonOf(r, statement) };
    }),
  };
}

export interface CheckResult {
  id: string;
  rows: number;
  ok: number;
  /** rows not ticked, with why */
  misses: Array<{ row: number; statement: string; reason: string; verdict: RowVerdict }>;
  /** rows left unmarked when there is no figure read */
  unmarkedNoFigure: number;
  unmarkedNoFigureReasons: string[];
}

export function checkCorpus(cases: readonly ProofCase[] = GEOMETRY_PROOFS): CheckResult[] {
  return cases.map((c) => {
    const problem = problemOf(c.given, c.prove, c.rows);
    const verdicts = checkProof(problem, buildFigure(c.figure));
    const noFig = checkProof(problem, null);
    return {
      id: c.id,
      rows: c.rows.length,
      ok: verdicts.filter((v) => v.verdict === "ok").length,
      misses: verdicts.flatMap((v, i) => (v.verdict === "ok" ? [] : [{ row: i, statement: c.rows[i][0], reason: c.rows[i][1], verdict: v }])),
      unmarkedNoFigure: noFig.filter((v) => v.verdict !== "ok").length,
      unmarkedNoFigureReasons: noFig.flatMap((v, i) => (v.verdict === "ok" ? [] : [c.rows[i][1]])),
    };
  });
}

export type SeedKind = "wrong-reason" | "not-given" | "correspondence" | "cpctc-early" | "wrong-postulate" | "missing" | "ssa" | "aaa" | "does-not-follow";

export interface Seed {
  id: string;
  kind: SeedKind;
  note: string;
  given: string;
  prove: string;
  figure: FigureRead;
  rows: Rows;
  /** the row that must be ringed; -1: any row after `after` */
  wrongRow: number;
  after?: number;
}

const POSTULATE_SWAP: Record<string, string> = { SSS: "\\text{SAS}", SAS: "\\text{SSS}", ASA: "\\text{SAS}", AAS: "\\text{ASA}", HL: "\\text{SAS}" };

/** Seeded errors made from every correct proof, plus the hand-written ones. */
export function seedErrors(cases: readonly ProofCase[] = GEOMETRY_PROOFS, hand: readonly SeededCase[] = HAND_SEEDED): Seed[] {
  const out: Seed[] = [];
  for (const c of cases) {
    const base = { given: c.given, prove: c.prove, figure: c.figure };
    const reasons = c.rows.map(([s, r]) => reasonOf(r, parseStatement(s)));
    const set = (i: number, row: readonly [string, string]): Rows => c.rows.map((x, k) => (k === i ? row : x));
    c.rows.forEach(([s, r], i) => {
      const reason = reasons[i];
      const facts = parseStatement(s).facts;
      if (reason === "given" && !facts.every((f) => (f.t === "segCong" || f.t === "angCong") && JSON.stringify(f.x) === JSON.stringify(f.y)))
        out.push({ ...base, id: `${c.id}/r${i + 1}-reflexive`, kind: "wrong-reason", note: `row ${i + 1}: a given called Reflexive`, rows: set(i, [s, "\\text{Reflexive}"]), wrongRow: i });
      if (reason !== "given")
        out.push({ ...base, id: `${c.id}/r${i + 1}-given`, kind: "not-given", note: `row ${i + 1}: ${REASON_TEXT[reason!]} called Given`, rows: set(i, [s, "\\text{Given}"]), wrongRow: i });
      const tri = /^\\triangle ([A-Z]{3}) \\cong \\triangle ([A-Z])([A-Z])([A-Z])$/.exec(s);
      if (tri) {
        const swapped = `\\triangle ${tri[1]} \\cong \\triangle ${tri[2]}${tri[4]}${tri[3]}`;
        out.push({ ...base, id: `${c.id}/r${i + 1}-order`, kind: "correspondence", note: `row ${i + 1}: ${swapped}`, rows: set(i, [swapped, r]), wrongRow: i });
        const post = /\\text\{(SSS|SAS|ASA|AAS|HL)\}/.exec(r)?.[1];
        if (post) out.push({ ...base, id: `${c.id}/r${i + 1}-postulate`, kind: "wrong-postulate", note: `row ${i + 1}: ${post} written as ${POSTULATE_SWAP[post].replace(/\\text\{|\}/g, "")}`, rows: set(i, [s, POSTULATE_SWAP[post]]), wrongRow: i });
      }
      if (reason === "cpctc") {
        const rows = [c.rows[i], ...c.rows.filter((_, k) => k !== i)];
        out.push({ ...base, id: `${c.id}/r${i + 1}-early`, kind: "cpctc-early", note: `row ${i + 1} (CPCTC) moved to the top`, rows, wrongRow: 0 });
      }
      // a prerequisite taken away: some row after it must now be ringed
      if (reason !== "given" && i < c.rows.length - 1) {
        const rows = c.rows.filter((_, k) => k !== i);
        out.push({ ...base, id: `${c.id}/r${i + 1}-missing`, kind: "missing", note: `row ${i + 1} (${REASON_TEXT[reason!]}) left out`, rows, wrongRow: -1, after: i - 1 });
      }
    });
  }
  for (const h of hand) {
    const kind: SeedKind = h.kind === "correspondence" ? "correspondence" : h.kind === "cpctc-early" ? "cpctc-early" : h.kind;
    out.push({ id: h.id, kind, note: h.note, given: h.given, prove: h.prove, figure: h.figure, rows: h.rows, wrongRow: h.wrongRow });
  }
  return out;
}

export interface SeedResult {
  seed: Seed;
  rung: boolean;
  verdicts: RowVerdict[];
  /** a row ringed that should not have been (before the seeded one) */
  falseRings: number[];
}

export function runSeeds(seeds: readonly Seed[] = seedErrors()): SeedResult[] {
  return seeds.map((seed) => {
    const verdicts = checkProof(problemOf(seed.given, seed.prove, seed.rows), buildFigure(seed.figure));
    const rung = seed.wrongRow >= 0 ? verdicts[seed.wrongRow]?.verdict === "wrong" : verdicts.some((v, i) => i > (seed.after ?? -1) && v.verdict === "wrong");
    const first = seed.wrongRow >= 0 ? seed.wrongRow : (seed.after ?? -1) + 1;
    const falseRings = verdicts.flatMap((v, i) => (i < first && v.verdict === "wrong" ? [i] : []));
    return { seed, rung, verdicts, falseRings };
  });
}

export interface PlanResult {
  id: string;
  prefixes: number;
  completed: number;
  /** prefixes the planner could not finish */
  failed: number[];
  /** rows the planner wrote from the empty prefix (the whole proof), and the corpus proof's rows */
  fromScratch: PlannedRow[] | null;
  corpusRows: number;
  ms: number;
}

export function runPlanner(cases: readonly ProofCase[] = GEOMETRY_PROOFS, opts: { figure?: boolean } = {}): PlanResult[] {
  return cases.map((c) => {
    const figure = opts.figure === false ? null : buildFigure(c.figure);
    const started = performance.now();
    const failed: number[] = [];
    let completed = 0;
    let fromScratch: PlannedRow[] | null = null;
    for (let k = 0; k < c.rows.length; k++) {
      const problem = problemOf(c.given, c.prove, c.rows.slice(0, k));
      const plan = planProof(problem, figure);
      if (k === 0) fromScratch = plan;
      if (plan && plan.length > 0 && finishes(problem, plan, figure)) completed++;
      else failed.push(k);
    }
    return { id: c.id, prefixes: c.rows.length, completed, failed, fromScratch, corpusRows: c.rows.length, ms: performance.now() - started };
  });
}

/** The prefix plus the plan checks row by row, and its last row states what was to be proved. */
function finishes(problem: ProofProblem, plan: readonly PlannedRow[], figure: ReturnType<typeof buildFigure> | null): boolean {
  const rows = [...problem.rows, ...plan.map((p) => ({ statement: { facts: p.facts, complete: true }, reason: p.reason }))];
  const full: ProofProblem = { ...problem, rows };
  const verdicts = checkProof(full, figure);
  if (verdicts.some((v) => v.verdict !== "ok")) return false;
  const r = new Resolver(figure, [...(problem.prove?.facts ?? []), ...rows.flatMap((x) => x.statement?.facts ?? [])]);
  const goal = (problem.prove?.facts ?? []).map((f) => r.factKey(f));
  const last = new Set(rows.flatMap((x) => x.statement?.facts ?? []).map((f) => r.factKey(f)));
  return goal.every((g) => g !== null && last.has(g));
}

// ---------------------------------------------------------------- the report

const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((100 * a) / b)}%`);
const tex = (s: string) => `\`${s.replace(/\|/g, "\\|")}\``;

export interface ProofBoard {
  check: CheckResult[];
  seeds: SeedResult[];
  plan: PlanResult[];
  planNoFigure: PlanResult[];
}

export function runProofBoard(): ProofBoard {
  return { check: checkCorpus(), seeds: runSeeds(), plan: runPlanner(), planNoFigure: runPlanner(GEOMETRY_PROOFS, { figure: false }) };
}

export function renderProofsMarkdown(board: ProofBoard): string {
  const rows = board.check.reduce((n, c) => n + c.rows, 0);
  const ok = board.check.reduce((n, c) => n + c.ok, 0);
  const unmarked = board.check.reduce((n, c) => n + c.unmarkedNoFigure, 0);
  const seeds = board.seeds.length;
  const rung = board.seeds.filter((s) => s.rung).length;
  const falseRings = board.seeds.filter((s) => s.falseRings.length > 0).length;
  const prefixes = board.plan.reduce((n, p) => n + p.prefixes, 0);
  const completed = board.plan.reduce((n, p) => n + p.completed, 0);
  const completedNoFig = board.planNoFigure.reduce((n, p) => n + p.completed, 0);
  const kinds = [...new Set(board.seeds.map((s) => s.seed.kind))];
  const out: string[] = [];
  out.push("# Proofs scoreboard", "");
  out.push(
    "> Generated by `npm run eval:proofs` (src/__eval__/proofs.test.ts). Offline: no recognizer, no model. The corpus is",
    `> ${GEOMETRY_PROOFS.length} textbook two-column proofs (src/__eval__/courses/geometryProofs.ts), each with its figure as the tutor reads one`,
    "> (labelled points and the straight lines through them) and a full correct proof, one LaTeX string per statement and reason.",
    "",
  );
  out.push("| | result |", "| --- | --- |");
  out.push(`| (a) rows of correct proofs ticked (figure read) | ${ok} / ${rows} (${pct(ok, rows)}) |`);
  out.push(`| (a) rows left unmarked without a figure read (never ringed) | ${unmarked} / ${rows} |`);
  out.push(`| (b) seeded errors ringed | ${rung} / ${seeds} (${pct(rung, seeds)}) |`);
  out.push(`| (b) seeded proofs with a right row ringed before the error | ${falseRings} |`);
  out.push(`| (c) prefixes the planner finishes (figure read, no model) | ${completed} / ${prefixes} (${pct(completed, prefixes)}) |`);
  out.push(`| (c) … with no figure read at all | ${completedNoFig} / ${prefixes} (${pct(completedNoFig, prefixes)}) |`);
  out.push("");
  out.push("## (a) The checker on correct proofs", "");
  out.push("| proof | rows | ticked | unmarked without the figure (their reasons) |", "| --- | --- | --- | --- |");
  for (const c of board.check) {
    const miss = c.misses.map((m) => `row ${m.row + 1} ${m.verdict.verdict} (${m.verdict.why})`).join("; ");
    out.push(`| ${c.id} | ${c.rows} | ${c.ok}${miss ? ` — ${miss}` : ""} | ${c.unmarkedNoFigure}${c.unmarkedNoFigureReasons.length ? ` (${c.unmarkedNoFigureReasons.map((r) => r.replace(/\\text\{|\}|\\/g, "").replace(/angle s/g, "∠s")).join(", ")})` : ""} |`);
  }
  out.push("");
  out.push("## (b) Seeded errors", "");
  out.push("| kind | seeded | ringed |", "| --- | --- | --- |");
  for (const k of kinds) {
    const of = board.seeds.filter((s) => s.seed.kind === k);
    out.push(`| ${k} | ${of.length} | ${of.filter((s) => s.rung).length} |`);
  }
  out.push("");
  const missed = board.seeds.filter((s) => !s.rung);
  if (missed.length > 0) {
    out.push("Not ringed (left unmarked, never ticked unless noted):", "");
    for (const s of missed) {
      const row = s.seed.wrongRow >= 0 ? s.verdicts[s.seed.wrongRow] : undefined;
      out.push(`- ${s.seed.id} (${s.seed.kind}): ${s.seed.note} — ${row ? `${row.verdict} (${row.why})` : s.verdicts.map((v) => v.verdict).join(", ")}`);
    }
    out.push("");
  }
  const falses = board.seeds.filter((s) => s.falseRings.length > 0);
  if (falses.length > 0) {
    out.push("Right rows ringed before the error:", "");
    for (const s of falses) out.push(`- ${s.seed.id}: rows ${s.falseRings.map((i) => i + 1).join(", ")}`);
    out.push("");
  }
  out.push("Examples:", "");
  for (const k of kinds) {
    const ex = board.seeds.find((s) => s.seed.kind === k && s.rung);
    if (!ex) continue;
    const i = ex.seed.wrongRow >= 0 ? ex.seed.wrongRow : ex.verdicts.findIndex((v, n) => n > (ex.seed.after ?? -1) && v.verdict === "wrong");
    const [st, re] = ex.seed.rows[i];
    out.push(`- **${k}** (${ex.seed.id}): ${tex(st)} \\| ${tex(re)} → ring on the ${ex.verdicts[i].part} (${ex.verdicts[i].why})`);
  }
  out.push("");
  out.push("## (c) The planner", "");
  out.push("From every prefix of every proof (the first k rows, k = 0 … n − 1) the planner writes the rest; a prefix counts when every", "row it writes is ticked by the checker and its last row is the Prove statement.", "");
  out.push("| proof | prefixes finished | without the figure | rows from scratch (corpus) | ms |", "| --- | --- | --- | --- | --- |");
  board.plan.forEach((p, i) => {
    const nf = board.planNoFigure[i];
    out.push(`| ${p.id} | ${p.completed} / ${p.prefixes}${p.failed.length ? ` (not: k = ${p.failed.join(", ")})` : ""} | ${nf.completed} / ${nf.prefixes} | ${p.fromScratch ? p.fromScratch.length : "—"} (${p.corpusRows}) | ${Math.round(p.ms)} |`);
  });
  out.push("");
  const ex = board.plan.find((p) => p.id === "gp-19")?.fromScratch;
  if (ex) {
    out.push("The planner's proof of gp-19 from nothing (as the tutor writes it):", "");
    out.push("| statement | reason |", "| --- | --- |");
    for (const r of ex) out.push(`| ${tex(r.statement)} | ${tex(r.reasonLatex)} |`);
    out.push("");
  }
  return out.join("\n") + "\n";
}
