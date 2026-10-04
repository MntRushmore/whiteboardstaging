/**
 * "Now you try": a new problem like the one the student just saw — the same form with new numbers,
 * a clean answer that is not the original's — checked by the engine exactly as `write_problems`
 * checks a problem (`verifyProblem`, the hand's interlock). Three ways, in order:
 *
 *  1. the same form from the practice generators: a generator instance with the problem's
 *     skeleton (`shape.ts`: `3x + 4 = 19` and `5x + 2 = 17` are both `#x+#=#`), clean by
 *     construction, closest in size to the original's numbers first;
 *  2. the problem's own numbers nudged (any form the engine solves, even one no generator makes),
 *     each candidate solved quickly and kept only when its answer has the original's shape
 *     (`x = 4` for `x = 7`, never `x = \frac{3}{7}`), is clean and is a different answer;
 *  3. the caller's fallback: practice problems of the problem's skill.
 *
 * Fast: every candidate is solved quickly (`solveLatex`, ~1–3 ms) before the one that passes is
 * checked in full, and the search stops starting engine work once its time budget would run out (a
 * trig equation's solve alone is ~50 ms, so a trig original is never re-solved: its answer is
 * compared from its numbers, `trigKey`). Pure apart from the engine; never throws.
 */
import { answerOf, isCleanAnswer, verifyProblem } from "@/lib/live/chat/verify";
import { PROBLEM_GRID } from "@/lib/live/chat/layout";
import type { LiveEngine } from "@/lib/live/contracts";
import { allowComplexRoots, DEFAULT_COMPLEX_ROOTS } from "@/lib/live/engine/complexSetting";
import { planHandwriting } from "@/lib/live/handwriting";
import { localSolve } from "@/lib/live/localSolve";
import { localAnswerStep } from "@/lib/live/solveSteps";
import type { PracticeProblem, SkillId } from "../contracts";
import type { Form } from "./form";
import { GENERATORS } from "./index";
import { makeRng, seedFrom, type Rng } from "./rng";
import { freeNumbers, looseSkeleton, numberSlots, skeletonOf, spacingOut, tidy, type NumberSlot } from "./shape";
import { dec } from "./tex";

export const VARIANT_LIMITS = {
  /**
   * The search's time: an engine call is not started when it would likely run past this — except
   * the first check of each way (a slow device still gets a variant, a little late)…
   */
  budgetMs: 80,
  /** …and nothing at all is started past this */
  capMs: 300,
  /** same-form candidates drawn, solved quickly, and checked with the engine */
  sameForm: 12,
  sameFormSolves: 12,
  sameFormChecks: 3,
  /** nudged candidates drawn, solved quickly, and checked with the engine */
  nudged: 40,
  nudgedSolves: 40,
  nudgedChecks: 3,
  /** fallback problems checked */
  fallbackChecks: 2,
  /** instances drawn from each form to learn its skeletons (once per page load) */
  indexSamples: 24,
  /** draws in a row that find no new skeleton before a form is considered learnt */
  indexStale: 8,
  /** draws from one form when looking for an instance with a skeleton */
  formDraws: 60,
  /** lines and characters of a problem worth trying */
  lines: 3,
  lineLength: 300,
} as const;

const TRIG = /\\(?:sin|cos|tan|sec|csc|cot)(?![a-zA-Z])/;
const RELATION = /=|<|>|\\le(?![a-zA-Z])|\\ge(?![a-zA-Z])/;

// ------------------------------------------------------------------ the generators' skeletons

interface Entry {
  skill: SkillId;
  form: Form;
}

let forms: { exact: Map<string, Entry[]>; loose: Map<string, Entry[]> } | null = null;

function draw(form: Form, r: Rng): PracticeProblem | null {
  try {
    const p = form(r);
    return p && p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * A generator's problem as `tidy` leaves a read one, for its skeleton. They are written in the
 * chat's conventions already (tested), apart from `\left( … \right)` round tall fractions, which a
 * read problem's tidying takes off.
 */
function asRead(p: PracticeProblem): PracticeProblem {
  return p.some((l) => l.includes("\\left")) ? p.map(tidy) : p;
}

/** Every generator form by the skeletons its problems have (built once, from fixed seeds). */
function formIndex(): NonNullable<typeof forms> {
  if (forms) return forms;
  const exact = new Map<string, Entry[]>();
  const loose = new Map<string, Entry[]>();
  const add = (map: Map<string, Entry[]>, key: string, entry: Entry) => {
    const list = map.get(key);
    if (!list) map.set(key, [entry]);
    else if (!list.some((e) => e.form === entry.form)) list.push(entry);
  };
  for (const [skill, list] of Object.entries(GENERATORS) as [SkillId, readonly Form[]][]) {
    list.forEach((form, i) => {
      const r = makeRng(seedFrom(i, `shape:${skill}`));
      const keys = new Set<string>();
      // most forms have one or a few skeletons: stop once a run of draws finds no new one
      for (let k = 0, stale = 0; k < VARIANT_LIMITS.indexSamples && stale < VARIANT_LIMITS.indexStale; k++) {
        const p = draw(form, r);
        const key = p ? skeletonOf(asRead(p)) : null;
        if (key === null || keys.has(key)) {
          stale++;
          continue;
        }
        stale = 0;
        keys.add(key);
        add(exact, key, { skill, form });
        add(loose, looseSkeleton(key), { skill, form });
      }
    });
  }
  forms = { exact, loose };
  return forms;
}

/** Digits of a number as written (`12` → 2, `2.5` → 2). */
function size(text: string): number {
  return text.replace(/\D/g, "").length;
}

/**
 * How far a candidate's numbers are from the original's: in size (a digit for a digit), and in
 * which of them are equal (`\frac{3}{4} + \frac{1}{6}` has two denominators; `\frac{1}{8} + \frac{5}{8}` one).
 */
function distance(a: readonly string[], b: readonly string[]): number {
  if (a.length !== b.length) return 100;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    d += Math.abs(size(a[i]) - size(b[i]));
    for (let j = i + 1; j < a.length; j++) if ((a[i] === a[j]) !== (b[i] === b[j])) d += 3;
  }
  return d;
}

/**
 * Generator problems with the original's skeleton, new numbers, nearest the original's first; then,
 * when there are too few, ones with its loose skeleton (the signs may differ).
 */
function sameFormCandidates(tidied: readonly string[], seed: number): PracticeProblem[] {
  const key = skeletonOf(tidied);
  const index = formIndex();
  const original = tidied.join("; ");
  const numbers = freeNumbers(tidied);
  const r = makeRng(seedFrom(seed, `variant:${original}`));
  const seen = new Set([original]);
  const out: PracticeProblem[] = [];
  for (const loose of [false, true]) {
    const want = loose ? looseSkeleton(key) : key;
    const entries = (loose ? index.loose : index.exact).get(want) ?? [];
    // each form's nearest first, then each one's second nearest…: one form's answers may all be
    // the wrong shape (`4^{x} = 8` is a fraction where `2^{x} = 32` is whole)
    const found: { p: PracticeProblem; d: number; rank: number }[] = [];
    for (const { form } of r.shuffle(entries)) {
      const mine: { p: PracticeProblem; d: number }[] = [];
      for (let k = 0; k < VARIANT_LIMITS.formDraws && mine.length < VARIANT_LIMITS.sameForm; k++) {
        const p = draw(form, r);
        if (!p) continue;
        const sk = skeletonOf(asRead(p));
        if ((loose ? looseSkeleton(sk) : sk) !== want) continue;
        // the same skeleton and numbers is the same problem (or a sine for a cosine: the engine judges it)
        const text = p.join("; ");
        if (seen.has(text)) continue;
        seen.add(text);
        mine.push({ p, d: distance(numbers, freeNumbers(p)) });
      }
      mine.sort((a, b) => a.d - b.d).forEach((m, rank) => found.push({ ...m, rank }));
    }
    found.sort((a, b) => a.rank - b.rank || a.d - b.d);
    for (const f of found) if (out.length < VARIANT_LIMITS.sameForm) out.push(f.p);
    if (out.length >= VARIANT_LIMITS.sameForm) break;
  }
  return out;
}

// ------------------------------------------------------------------ nudged numbers

/**
 * A new number of about the same size: a digit for a digit, two digits for two, a decimal keeps its
 * places. Never 1 as a coefficient or a power (`1x`, `x^{1}` are not written).
 */
function nudge(r: Rng, text: string, coefficient: boolean): string {
  if (text.includes(".")) {
    const places = text.split(".")[1].length;
    const units = Math.round(Number(text) * 10 ** places);
    for (let i = 0; i < 12; i++) {
      const u = r.int(Math.max(1, Math.ceil(units / 2)), Math.max(2, units * 2));
      if (u !== units && u % 10 !== 0) return dec(u, places);
    }
    return text;
  }
  const v = Number(text);
  if (v <= 9) return String(r.intExcept(coefficient ? 2 : 1, 9, [v]));
  if (v <= 99) return String(r.intExcept(Math.max(10, Math.floor(v / 2)), Math.min(99, v * 2), [v]));
  for (let i = 0; i < 12; i++) {
    const u = r.int(Math.ceil(v / 2), v * 2);
    if (u !== v) return String(u);
  }
  return String(v + 1);
}

function rebuild(line: string, slots: readonly NumberSlot[], changes: ReadonlyMap<NumberSlot, string>): string {
  let out = line;
  for (const s of [...slots].sort((a, b) => b.start - a.start)) {
    const v = changes.get(s);
    if (v !== undefined) out = out.slice(0, s.start) + v + out.slice(s.end);
  }
  return out;
}

/**
 * The problem with its numbers nudged: every number that is not part of the form (0, a square, an
 * angle total, a trig interval) may change; an exponent on a letter only when nothing else can.
 * A number written twice changes the same way both times (`(x - 3)(x + 3)` → `(x - 5)(x + 5)`), and
 * two different numbers never become one.
 */
export function nudgedCandidates(tidied: readonly string[], seed: number): PracticeProblem[] {
  const slots = numberSlots(tidied);
  let free = slots.filter((s) => !s.fixed && !s.exponent);
  if (free.length === 0) free = slots.filter((s) => !s.fixed);
  if (free.length === 0) return [];
  const r = makeRng(seedFrom(seed, `nudge:${tidied.join("; ")}`));
  const seen = new Set([tidied.join("; ")]);
  const out: PracticeProblem[] = [];
  // a number written against a letter, a command or a bracket is a coefficient; one in `^{…}` a power
  const coefficient = (s: NumberSlot) => s.exponent || /^[a-zA-Z\\(^]/.test(tidied[s.line].slice(s.end, s.end + 1));
  const values = [...new Set(free.map((s) => s.text))];
  for (let k = 0; k < VARIANT_LIMITS.nudged * 3 && out.length < VARIANT_LIMITS.nudged; k++) {
    const changing = values.filter(() => r.chance(0.8));
    if (changing.length === 0) changing.push(r.pick(values));
    const to = new Map<string, string>();
    const used = new Set(values.filter((v) => !changing.includes(v)));
    for (const v of changing) {
      const asCoefficient = free.some((s) => s.text === v && coefficient(s));
      let w = nudge(r, v, asCoefficient);
      for (let i = 0; i < 6 && used.has(w); i++) w = nudge(r, v, asCoefficient);
      to.set(v, w);
      used.add(w);
    }
    const after = values.map((v) => to.get(v) ?? v);
    if (new Set(after).size !== after.length || after.every((w, i) => w === values[i])) continue;
    const changes = new Map<NumberSlot, string>();
    for (const s of free) {
      const w = to.get(s.text);
      if (w !== undefined && w !== s.text) changes.set(s, w);
    }
    const p = tidied.map((line, li) =>
      rebuild(
        line,
        slots.filter((s) => s.line === li),
        changes,
      ),
    );
    const text = p.join("; ");
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------ answers

/**
 * An answer as a key two solutions can be compared by: the last line, its roots in any order
 * (`x = 2, \ x = 3` is `x = 3, \ x = 2`); for a system, the value it found for every letter.
 */
export function answerKey(steps: readonly string[]): string {
  const values = new Map<string, string>();
  for (const s of steps) {
    const m = /^\s*([a-zA-Z])\s*=\s*(.+)$/.exec(s);
    if (m && !/[a-zA-Z]/.test(m[2].replace(/\\[a-zA-Z]+/g, ""))) values.set(m[1], m[2].replace(/\s+/g, ""));
  }
  if (values.size >= 2)
    return [...values]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(";");
  return answerOf(steps).replace(/\s+/g, "").split(",\\").sort().join(",");
}

/**
 * The shape of an answer: its numbers taken out, a coefficient and a sign not counted
 * (`x = 7` ~ `x = -4`, `= 5x - 4` ~ `= x + 2`; never `x = 7` ~ `x = \frac{3}{7}` or `x = \pm 2`).
 */
export function answerShape(answer: string): string {
  return tidy(answer)
    .replace(/\s+/g, "")
    .replace(/\d+(?:\.\d+)?/g, (m) => (m.includes(".") ? "#.#" : "#"))
    .replace(/#(?=[a-zA-Z\\(])/g, "")
    .replace(/-/g, "+")
    .replace(/(^|[=;(,{<>|])\+/g, "$1");
}

function largest(answer: string): number {
  let max = 0;
  for (const m of answer.matchAll(/\d+(?:\.\d+)?/g)) max = Math.max(max, Number(m[0]));
  return max;
}

/**
 * Why a candidate's solution is turned down, or null when it is clean, shaped like the original's,
 * not much bigger and a different answer.
 */
export function rejection(steps: readonly string[], original: readonly string[] | null): string | null {
  const answer = answerOf(steps);
  if (!answer || !isCleanAnswer(answer)) return `not clean: ${answer}`;
  if (!original) return largest(answer) <= 1000 ? null : `too big: ${answer}`;
  const was = answerOf(original);
  if (answerShape(answer) !== answerShape(was)) return `shape ${answerShape(answer)} vs ${answerShape(was)}`;
  if (largest(answer) > Math.max(20, 3 * largest(was))) return `too big: ${answer}`;
  return answerKey(steps) === answerKey(original) ? `same answer: ${answer}` : null;
}

/** A number written as `3`, `\sqrt{3}`, `\frac{1}{2}`, `\frac{\sqrt{3}}{2}`, with an optional minus. */
function valueOf(latex: string): number | null {
  const s = latex.replace(/\s+/g, "");
  const m = /^(-?)(?:(\d+)|\\sqrt\{(\d+)\}|\\frac\{(?:(\d+)|\\sqrt\{(\d+)\})\}\{(\d+)\})$/.exec(s);
  if (!m) return null;
  const sign = m[1] ? -1 : 1;
  if (m[2]) return sign * Number(m[2]);
  if (m[3]) return sign * Math.sqrt(Number(m[3]));
  const top = m[4] ? Number(m[4]) : Math.sqrt(Number(m[5]));
  return (sign * top) / Number(m[6]);
}

/**
 * A trig equation's answer without solving it: the function, the value it equals once alone
 * (`2\cos x - 1 = 0` → cos, 1/2) and the interval. Null for any other shape.
 */
export function trigKey(line: string): string | null {
  const s = tidy(line);
  const comma = s.search(/,\s*(?:\\\s)?/);
  const head = comma === -1 ? s : s.slice(0, comma);
  const interval = comma === -1 ? "" : spacingOut(s.slice(comma));
  const m = /^(\d*)\\(sin|cos|tan) x(?: ([+-]) (.+?))? = (.+)$/.exec(head.trim());
  if (!m) return null;
  const a = m[1] ? Number(m[1]) : 1;
  const b = m[4] ? valueOf(m[4]) : 0;
  const c = valueOf(m[5]);
  if (b === null || c === null || a === 0) return null;
  const v = (c - (m[3] === "-" ? -b : b)) / a;
  return `${m[2]}:${v.toFixed(6)}:${interval}`;
}

// ------------------------------------------------------------------ the search

function canDraw(lines: readonly string[]): boolean {
  return planHandwriting(lines, { size: PROBLEM_GRID.size, seed: 1 }).unsupported.length === 0;
}

/** The engine's worked solution, as Solve would write it; null when it has none. */
function solved(engine: LiveEngine, lines: readonly string[]): string[] | null {
  const steps = localSolve(engine, lines).steps;
  return steps.length > 0 ? steps : null;
}

/** A quicker solve for a one-line problem (the path `localSolve` takes first), else `localSolve`. */
function quickSolve(engine: LiveEngine, lines: readonly string[]): string[] | null {
  if (lines.length === 1) {
    const line = lines[0];
    if (RELATION.test(line)) {
      const s = engine.solveLatex(line, { column: [line], complexRoots: allowComplexRoots(DEFAULT_COMPLEX_ROOTS, [line]) });
      if (s && s.steps.length > 0) return s.steps;
    } else if (/[a-zA-Z]/.test(line.replace(/\\[a-zA-Z]+/g, ""))) {
      const s = engine.simplifySteps?.(line);
      if (s && s.length > 0) return s.map(localAnswerStep);
    }
  }
  return solved(engine, lines);
}

export interface VariantOptions {
  /** practice problems of the problem's skill, the last resort (`practiceProblems(classifyProblem(…), …)`) */
  fallback: (tidied: readonly string[]) => readonly PracticeProblem[];
  /** a clock in ms (tests pass a still one, so the result does not depend on the machine's load) */
  now?: () => number;
  /** what the search tried and why each candidate was turned down (tests, debugging) */
  trace?: (event: string) => void;
}

const clockNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function findVariant(engine: LiveEngine, problem: readonly string[], seed: number, opts: VariantOptions): PracticeProblem | null {
  const now = opts.now ?? clockNow;
  // learnt once per page load (~25 ms warm), before the clock starts: the first search gets its whole budget
  try {
    formIndex();
  } catch {
    forms = { exact: new Map(), loose: new Map() };
  }
  const start = now();
  let slowest = 0;
  /**
   * May another engine call start? Within the budget (counting the slowest call so far), or — for
   * the first check of a way, `owed` — within the hard cap: a slow device still gets its variant.
   */
  const may = (owed = false) => {
    const spent = now() - start;
    return spent < VARIANT_LIMITS.capMs && (owed || spent + slowest < VARIANT_LIMITS.budgetMs);
  };
  const timed = <T>(fn: () => T): T | null => {
    const t = now();
    try {
      return fn();
    } catch {
      return null;
    } finally {
      slowest = Math.max(slowest, now() - t);
    }
  };

  // `\frac{3}{4} + \frac{1}{6} =` and `f(4) = ?` as a student writes them ask for the value: the
  // problem is the expression (as the chat writes one)
  const lines = (Array.isArray(problem) ? problem : [])
    .map((l) => (typeof l === "string" ? l.trim().replace(/\s*=\s*\??$/, "") : ""))
    .filter(Boolean);
  if (lines.length === 0) return null;
  const tidied = lines.map(tidy);
  const original = tidied.join("; ");
  const usable = tidied.length <= VARIANT_LIMITS.lines && tidied.every((l) => l.length <= VARIANT_LIMITS.lineLength);
  const trigEquation = usable && tidied.length === 1 && TRIG.test(original) && RELATION.test(original);
  const trigWas = trigEquation ? trigKey(tidied[0]) : null;
  // the original's answer (a trig equation's from its numbers: solving one costs most of the budget)
  const was = usable && !trigEquation ? timed(() => solved(engine, tidied)) : null;
  const trace = opts.trace ?? (() => undefined);
  trace(`original ${original}: ${was ? answerOf(was) : trigWas ?? "no answer"}`);

  /** The engine's check of a candidate, as `write_problems` makes it; the candidate when it passes. */
  const check = (candidate: PracticeProblem): PracticeProblem | null => {
    const v = timed(() => verifyProblem(engine, candidate, canDraw));
    if (!v || !v.ok) {
      trace(`  ${candidate.join("; ")}: ${v ? v.reason : "threw"}`);
      return null;
    }
    if (trigEquation) {
      const key = trigKey(candidate[0]);
      const why = !isCleanAnswer(answerOf(v.steps)) ? "not clean" : key !== null && trigWas !== null && key === trigWas ? "same answer" : null;
      trace(`  ${candidate.join("; ")}: ${why ?? "ok"}`);
      return why ? null : candidate;
    }
    const why = rejection(v.steps, was);
    trace(`  ${candidate.join("; ")}: ${why ?? "ok"}`);
    return why ? null : candidate;
  };

  /**
   * Candidates in turn: each solved quickly first (a trig equation's answer compared from its
   * numbers), and only one that passes is checked in full. The first quick solve and the first
   * check of a way are owed even past the budget (within the cap).
   */
  const tryAll = (candidates: readonly PracticeProblem[], limits: { solves: number; checks: number }): PracticeProblem | null => {
    let solves = 0;
    let checks = 0;
    for (const candidate of candidates) {
      if (solves >= limits.solves || checks >= limits.checks) break;
      if (trigEquation) {
        const key = trigKey(candidate[0]);
        if (key !== null && trigWas !== null && key === trigWas) {
          trace(`  ~ ${candidate.join("; ")}: same answer`);
          continue;
        }
      } else if (was) {
        if (!may(solves === 0)) break;
        solves++;
        const quick = timed(() => quickSolve(engine, candidate));
        const why = quick ? rejection(quick, was) : "no quick answer";
        if (why) {
          trace(`  ~ ${candidate.join("; ")}: ${why}`);
          continue;
        }
      }
      if (!may(checks === 0)) break;
      checks++;
      const ok = check(candidate);
      if (ok) return ok;
    }
    return null;
  };

  if (usable) {
    // 1. the same form, from the generators
    trace("same form");
    const same = tryAll(sameFormCandidates(tidied, seed), { solves: VARIANT_LIMITS.sameFormSolves, checks: VARIANT_LIMITS.sameFormChecks });
    if (same) return same;
    // 2. its own numbers nudged
    if (was && !trigEquation) {
      trace("nudged");
      const nudged = tryAll(nudgedCandidates(tidied, seed), { solves: VARIANT_LIMITS.nudgedSolves, checks: VARIANT_LIMITS.nudgedChecks });
      if (nudged) return nudged;
    }
  }
  trace(`fallback (${Math.round(now() - start)} ms spent)`);

  // 3. another problem of its skill (the generators are held to the engine by their tests, so
  //    past the cap one is written unchecked rather than none)
  let fallback: readonly PracticeProblem[] = [];
  try {
    fallback = opts.fallback(tidied);
  } catch {
    fallback = [];
  }
  let checks = 0;
  for (const candidate of fallback) {
    if (!Array.isArray(candidate) || candidate.length === 0 || candidate.join("; ") === original) continue;
    if (checks >= VARIANT_LIMITS.fallbackChecks || !may(checks === 0)) return [...candidate];
    checks++;
    const v = timed(() => verifyProblem(engine, candidate, canDraw));
    if (v?.ok && (!was || answerKey(v.steps) !== answerKey(was))) return [...candidate];
  }
  return null;
}

