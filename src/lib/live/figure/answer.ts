/**
 * From a figure's setup to what the tutor writes, with the engine: each stage solved by `localSolve`
 * (the same function Solve uses), its answer checked. Pure over an engine — no editor, no network —
 * so the board (`LiveLoop.startFigure`) and the figure eval (`src/__eval__/figures/**`) decide the
 * same way.
 *
 *  - A structured read's stages (`planFigure`) carry the planner's own value for each unknown: the
 *    engine's answer must agree with it, or nothing is written.
 *  - The model's free-form lines (the fallback) carry nothing: the engine must solve them to a
 *    number, and that number must be a sensible size — positive, and an angle less than 360°.
 */
import type { LiveEngine, SetupResponse } from "../contracts";
import { localSolve } from "../localSolve";
import { setupBlock, validateSetupLines } from "../wordProblem";
import type { FigureStage, QuantityKind } from "./plan";

// ---------------------------------------------------------------- a number in LaTeX

type Tok = { t: "num"; v: number } | { t: "op"; s: string } | { t: "(" } | { t: ")" } | { t: "{" } | { t: "}" } | { t: "frac" } | { t: "sqrt" };

function tokens(s: string): Tok[] | null {
  const out: Tok[] = [];
  const src = s
    .replace(/\\(?:left|right)(?![a-zA-Z])|\\[,;:! ]|~/g, " ")
    .replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ|°/g, "")
    .replace(/\\(?:dfrac|tfrac)/g, "\\frac")
    .replace(/\\(?:cdot|times)(?![a-zA-Z])/g, "*");
  for (let i = 0; i < src.length; ) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const cmd = /^\\([a-zA-Z]+)/.exec(src.slice(i));
    if (cmd) {
      if (cmd[1] === "frac") out.push({ t: "frac" });
      else if (cmd[1] === "sqrt") out.push({ t: "sqrt" });
      else if (cmd[1] === "pi") out.push({ t: "num", v: Math.PI });
      else return null;
      i += cmd[0].length;
      continue;
    }
    if ("+-*/".includes(ch)) out.push({ t: "op", s: ch });
    else if (ch === "(") out.push({ t: "(" });
    else if (ch === ")") out.push({ t: ")" });
    else if (ch === "{") out.push({ t: "{" });
    else if (ch === "}") out.push({ t: "}" });
    else return null;
    i++;
  }
  return out;
}

/** The value of a LaTeX number: `5`, `-2.5`, `\frac{170}{7}`, `2\sqrt{13}`, `\frac{3\sqrt{2}}{2}`, `4\pi`. Null otherwise. */
export function numberValue(latex: string): number | null {
  const toks = tokens(latex);
  if (!toks || toks.length === 0) return null;
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const expect = (t: Tok["t"]) => {
    if (take()?.t !== t) throw new Error(t);
  };
  const expr = (): number => {
    let v = term();
    while (peek()?.t === "op" && ((peek() as { s: string }).s === "+" || (peek() as { s: string }).s === "-")) {
      const op = (take() as { s: string }).s;
      v = op === "+" ? v + term() : v - term();
    }
    return v;
  };
  const term = (): number => {
    let v = factor();
    for (;;) {
      const p = peek();
      if (p?.t === "op" && (p.s === "*" || p.s === "/")) {
        take();
        v = p.s === "*" ? v * factor() : v / factor();
      } else if (p && (p.t === "num" || p.t === "(" || p.t === "frac" || p.t === "sqrt" || p.t === "{")) v *= factor();
      else return v;
    }
  };
  const factor = (): number => {
    const tok = take();
    if (!tok) throw new Error("end");
    switch (tok.t) {
      case "op":
        if (tok.s === "-") return -factor();
        if (tok.s === "+") return factor();
        throw new Error("op");
      case "num":
        return tok.v;
      case "(": {
        const v = expr();
        expect(")");
        return v;
      }
      case "{": {
        const v = expr();
        expect("}");
        return v;
      }
      case "frac": {
        expect("{");
        const n = expr();
        expect("}");
        expect("{");
        const d = expr();
        expect("}");
        return n / d;
      }
      case "sqrt": {
        expect("{");
        const v = expr();
        expect("}");
        return Math.sqrt(v);
      }
      default:
        throw new Error("token");
    }
  };
  try {
    const v = expr();
    return i === toks.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const escapeRe = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

/**
 * The value of `letter` in the last line that gives it a number: `x = 5`, `x = \sqrt{74}`,
 * `x \approx 8.60`, `x = \frac{170}{7}`, `x = 70^{\circ}`. Null when no line does.
 */
export function finalValue(lines: readonly string[], letter: string): number | null {
  const head = new RegExp(`^\\s*${escapeRe(letter)}\\s*(?:\\^\\s*\\{?\\s*\\\\circ\\s*\\}?\\s*)?(=|\\\\approx)\\s*(.+)$`);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = head.exec(lines[i] ?? "");
    if (!m) continue;
    // `x = \sqrt{74} \approx 8.60`: the exact form first
    const rhs = m[2].split(/\\approx|=/)[0].trim();
    const v = numberValue(rhs);
    if (v !== null) return v;
  }
  return null;
}

// ---------------------------------------------------------------- a Greek letter through a stand-in

const GREEK = /^\\[a-zA-Z]+$/;

/** Replaces the letter `from` (a single Latin letter or `\theta`) by `to` wherever it stands alone. */
export function renameLetter(latex: string, from: string, to: string): string {
  if (GREEK.test(from)) return latex.replace(new RegExp(`${escapeRe(from)}(?![a-zA-Z])`, "g"), to);
  // `x` alone: not inside a command name (`\approx`), not part of a word
  return latex.replace(new RegExp(`(?<![\\\\a-zA-Z])${from}(?![a-zA-Z])`, "g"), to);
}

function standInFor(lines: readonly string[]): string {
  for (const c of ["x", "y", "z", "w", "u", "v", "a", "b"]) if (!lines.some((l) => new RegExp(`(?<![\\\\a-zA-Z])${c}(?![a-zA-Z])`).test(l))) return c;
  return "x";
}

// ---------------------------------------------------------------- solving what the plan wrote

const TOL = 1e-6;

export type FigureSolve = { ok: true; block: string[]; values: Array<{ letter: string; value: number }> } | { ok: false; reason: string };

/**
 * Each stage solved by the engine, its answer checked against the plan's, and the block the tutor
 * writes: each stage's lines, then the engine's steps (a step the block already has is not written
 * twice). The engine does not read a Greek letter well (`\theta + 50 = 180` came back `theta = 130`),
 * so a Greek unknown is solved as a Latin stand-in and renamed back.
 */
export function solveStages(engine: LiveEngine, stages: readonly FigureStage[]): FigureSolve {
  const block: string[] = [];
  const values: Array<{ letter: string; value: number }> = [];
  for (const stage of stages) {
    const greek = GREEK.test(stage.letter);
    const stand = greek ? standInFor(stage.lines) : stage.letter;
    const lines = greek ? stage.lines.map((l) => renameLetter(l, stage.letter, stand)) : [...stage.lines];
    let steps: string[] = [];
    try {
      steps = localSolve(engine, lines, undefined, { handwriting: true }).steps;
    } catch {
      steps = [];
    }
    const got = finalValue([...lines, ...steps], stand);
    if (got === null) return { ok: false, reason: `the engine gives no value for ${stage.letter}` };
    // exact, except that an irrational answer may only be given rounded (`x \approx 8.6`)
    const integer = Math.abs(stage.value - Math.round(stage.value)) < TOL;
    const diff = Math.abs(got - stage.value);
    if (diff > TOL * Math.max(1, Math.abs(stage.value)) && (integer || diff > 0.051)) {
      return { ok: false, reason: `the engine's ${stage.letter} = ${got} is not the plan's ${stage.value}` };
    }
    const out = greek ? steps.map((s) => renameLetter(s, stand, stage.letter)) : steps;
    block.push(...setupBlock(stage.lines, out).filter((l) => !block.includes(l)));
    values.push({ letter: stage.letter, value: got });
  }
  return { ok: true, block, values };
}

/** A size that makes sense for what it measures: positive; an angle under a full turn. */
export function sensibleSize(value: number, kind: QuantityKind | null): boolean {
  if (!Number.isFinite(value) || value <= TOL) return false;
  return kind !== "angle" || value < 360;
}

/**
 * The model's own lines (the fallback): solved by the engine to a number for the unknown — the one
 * the model named, else the letter the last step gives — and that number a sensible size. `kind`:
 * what the figure's labels say is asked (a degree mark: an angle), when they say.
 */
export function solveFallbackLines(engine: LiveEngine, lines: readonly string[], opts: { unknown?: string; kind?: QuantityKind | null } = {}): FigureSolve {
  if (lines.length === 0) return { ok: false, reason: "no lines" };
  let steps: string[] = [];
  try {
    const solved = localSolve(engine, lines, undefined, { handwriting: true });
    steps = solved.steps;
  } catch {
    return { ok: false, reason: "the engine failed" };
  }
  const all = [...lines, ...steps];
  const lastLetter = /^\s*(\\[a-zA-Z]+|[A-Za-z])\s*(?:=|\\approx)/.exec(all[all.length - 1] ?? "")?.[1];
  const letter = opts.unknown && /^(?:\\[a-zA-Z]+|[A-Za-z])$/.test(opts.unknown) ? opts.unknown : lastLetter;
  if (!letter) return { ok: false, reason: "no unknown" };
  const value = finalValue(all, letter);
  if (value === null) return { ok: false, reason: `the engine gives no value for ${letter}` };
  const kind = opts.kind ?? (lines.some((l) => /\^\s*\{?2\}?|\\sqrt|\\frac\{[^{}]*\}\{[^{}]*\}\s*=\s*\\frac/.test(l)) ? "length" : null);
  if (!sensibleSize(value, kind)) return { ok: false, reason: `${letter} = ${value} is not a sensible ${kind ?? "size"}` };
  return { ok: true, block: setupBlock(lines, steps), values: [{ letter, value }] };
}

export type FigureAnswer = (FigureSolve & { source: "facts" | "lines" }) | { ok: false; source: "facts" | "lines"; reason: string };

/**
 * What the board writes for a figure's setup reply (`/api/live/setup` with a crop), or why it writes
 * nothing. `context`: the figure's labels as read and the lines beside it (the letters the setup may
 * use). The planner's stages when the reply has them — each checked like a word problem's setup
 * (`validateSetupLines`) and solved to the planner's own value; otherwise the model's own lines,
 * validated the same way and kept only when they solve to a sensible size. A reply from before
 * figures were read as facts (no `figure`) is the model's lines.
 */
export function figureAnswer(engine: LiveEngine, res: Pick<SetupResponse, "lines" | "unknown" | "figure">, context: readonly string[]): FigureAnswer {
  const stages = res.figure?.source === "facts" ? res.figure.stages : undefined;
  if (stages && stages.length > 0) {
    for (const s of stages) {
      if (!validateSetupLines(engine, s.lines, context)) return { ok: false, source: "facts", reason: `the stage for ${s.letter} does not validate` };
    }
    return { ...solveStages(engine, stages), source: "facts" };
  }
  const setup = validateSetupLines(engine, res.lines, context);
  if (!setup) return { ok: false, source: "lines", reason: "the lines do not validate" };
  return { ...solveFallbackLines(engine, setup, { unknown: res.unknown, kind: res.figure?.kind ?? null }), source: "lines" };
}
