/**
 * Function notation (F-IF.1–2, F-BF.1c, F-BF.4), from a definition on a line above:
 *
 *   f(x) = 2x + 3          f(x) = 2x + 3          f(x) = 2x + 3, g(x) = x^{2}     f(x) = 2x + 3
 *   f(4) =                 f(a + 1) =             f(g(x)) =                      f^{-1}(x) =
 *   = 2(4) + 3             = 2(a + 1) + 3         = f(x^{2})                     y = 2x + 3
 *   = 8 + 3                = 2a + 2 + 3           = 2(x^{2}) + 3                 x = 2y + 3
 *   = 11                   = 2a + 5               = 2x^{2} + 3                   x - 3 = 2y
 *                                                                                y = \frac{x - 3}{2}
 *                                                                                f^{-1}(x) = \frac{x - 3}{2}
 *
 * Also `(f \circ g)(x)`, `(f + g)(x)`, `(fg)(x)`, `\frac{f(4) - f(1)}{4 - 1}` (a rate of change),
 * `P(3)` for a polynomial (the remainder theorem), and a piecewise definition
 * (`\begin{cases} … \end{cases}`): the case whose condition holds is written as a true statement
 * (`3 \ge 0`) and then used. A value that does not exist stops at the division by zero.
 *
 * Every answer is checked against the definitions evaluated numerically, independently of the
 * written working (a bracket dropped in a substitution fails the check, and nothing is written).
 * Without a definition, `f(4)` is NOT `4f`: `hasFunctionCall` lets the engine refuse such a line
 * instead of multiplying (it used to write `= 4f`).
 */
import type { MathNode } from "mathjs";
import { simplifyExpressionSteps, termsOf } from "./algebra";
import { closeC, evalLatex, hasRelation, lettersOf, numberLatex, parseExpr, sampleScopes, splitEquation, withoutQuestionMark, type Complex, type CourseDeps } from "./courseKit";
import { splitRelations } from "./latex";
import { solveForLetter } from "./literalEquations";
import { argsOf, fnOf, stripParens } from "./nodes";

export interface Piece {
  expr: string;
  cond: string;
}

export interface FunctionDef {
  name: string;
  param: string;
  rhs: string;
  pieces?: Piece[];
}

const DEF = /^\s*([a-zA-Z])\s*(?:\\left\s*)?\(\s*([a-zA-Z])\s*(?:\\right\s*)?\)\s*=\s*([\s\S]+)$/;

/** `f(x) = 2x + 3`, `P(x) = x^{3} - 2x^{2} + 4`, a piecewise `f(x) = \begin{cases} … \end{cases}`. */
export function definitionOf(latex: string): FunctionDef | null {
  const m = DEF.exec(latex.trim());
  if (!m) return null;
  const [, name, param, rhsRaw] = m;
  const rhs = rhsRaw.trim();
  if (name === param || !rhs || /\?/.test(rhs)) return null;
  const pieces = piecesOf(rhs);
  if (pieces) return { name, param, rhs, pieces };
  if (/\\begin/.test(rhs) || hasRelation(rhs)) return null;
  return { name, param, rhs };
}

/** The rows of `\begin{cases} x^{2} & x < 0 \\ 2x + 1 & x \ge 0 \end{cases}` (or Mathpix's `\left\{\begin{array}{ll} … \end{array}\right.`). */
function piecesOf(rhs: string): Piece[] | null {
  const m = /\\begin\s*\{\s*(?:cases|array)\s*\}(?:\s*\{[lcr]+\})?([\s\S]*?)\\end\s*\{\s*(?:cases|array)\s*\}/.exec(rhs);
  if (!m) return null;
  const rows = m[1].split(/\\\\/).map((r) => r.trim()).filter(Boolean);
  const out: Piece[] = [];
  for (const row of rows) {
    const cells = row.split("&").map((c) => c.trim());
    if (cells.length !== 2 || !cells[0] || !cells[1]) return null;
    const cond = cells[1].replace(/^,\s*/, "").trim();
    if (/\\text/.test(cond)) return null;
    out.push({ expr: cells[0], cond });
  }
  return out.length >= 2 ? out : null;
}

/** Every definition in the column, the latest for each name. */
export function definitionsIn(lines: readonly string[]): Map<string, FunctionDef> {
  const out = new Map<string, FunctionDef>();
  for (const l of lines) {
    const d = definitionOf(l);
    if (d) out.set(d.name, d);
  }
  return out;
}

// ---------------------------------------------------------------- calls in a line

interface Call {
  name: string;
  inverse: boolean;
  /** the argument as written */
  arg: string;
  start: number;
  end: number;
}

/** Index just past the bracket that closes the one at `open` (`(` or `\left(`), or -1. */
function closeParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s.startsWith("\\left", i)) {
      const k = s.indexOf("(", i);
      if (k >= 0 && /^\\left\s*$/.test(s.slice(i, k))) {
        depth++;
        i = k;
        continue;
      }
    }
    if (s.startsWith("\\right", i)) {
      const k = s.indexOf(")", i);
      if (k >= 0 && /^\\right\s*$/.test(s.slice(i, k))) {
        depth--;
        if (depth === 0) return k + 1;
        i = k;
        continue;
      }
    }
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Where the bracket of a match that ends in `(` opens: at the `\left` before it, if any. */
function openAt(s: string, parenIndex: number): number {
  const m = /\\left\s*$/.exec(s.slice(0, parenIndex));
  return m ? m.index : parenIndex;
}

/** The text inside the bracket opening at `open` and closing just before `end`. */
function innerOf(s: string, open: number, end: number): string {
  const opening = s.indexOf("(", open) + 1;
  const closeParenAt = end - 1;
  const rightAt = /\\right\s*$/.exec(s.slice(0, closeParenAt));
  return s.slice(opening, rightAt ? rightAt.index : closeParenAt);
}

/** Calls of these names (`f(4)`, `f\left(x\right)`, `f^{-1}(x)`), in order of appearance. */
function callsOf(s: string, names: ReadonlySet<string>): Call[] {
  const out: Call[] = [];
  const re = /([a-zA-Z])\s*(\^\s*\{\s*-\s*1\s*\})?\s*(?:\\left\s*)?\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const before = s.slice(0, m.index);
    if (/[a-zA-Z_^]$/.test(before) || /\\[a-zA-Z]*$/.test(before)) continue;
    if (!names.has(m[1])) continue;
    const open = openAt(s, m.index + m[0].length - 1);
    const end = closeParen(s, open);
    if (end < 0) continue;
    out.push({ name: m[1], inverse: Boolean(m[2]), arg: innerOf(s, open, end).trim(), start: m.index, end });
  }
  return out;
}

/** Does a line apply a function by name (`f(4)`)? f, g and h always; other letters only when defined. */
export function hasFunctionCall(latex: string, defined: Iterable<string> = []): boolean {
  const names = new Set(["f", "g", "h", ...defined]);
  if (callsOf(latex, names).length > 0) return true;
  // `(f \circ g)(x)`, `(f + g)(2)`, `(fg)(x)`: two functions combined, then applied
  const combined = /(?:\\left\s*)?\(\s*([a-zA-Z])\s*(?:\\circ|\+|-|\\cdot|)\s*([a-zA-Z])\s*(?:\\right\s*)?\)\s*(?:\\left\s*)?\(/g;
  for (const m of latex.matchAll(combined)) if (names.has(m[1]) && names.has(m[2])) return true;
  return false;
}

/** `(f \circ g)(x)` → `f(g(x))`, `(f + g)(2)` → `f(2) + g(2)`, `(fg)(x)` → `f(x) \cdot g(x)`. */
function expandCombinations(s: string, names: ReadonlySet<string>): string {
  const re = /(?:\\left\s*)?\(\s*([a-zA-Z])\s*(\\circ|\+|-|\\cdot|)\s*([a-zA-Z])\s*(?:\\right\s*)?\)\s*(?:\\left\s*)?\(/;
  let out = s;
  for (let guard = 0; guard < 4; guard++) {
    const m = re.exec(out);
    if (!m || !names.has(m[1]) || !names.has(m[3])) break;
    const open = openAt(out, m.index + m[0].length - 1);
    const end = closeParen(out, open);
    if (end < 0) break;
    const arg = innerOf(out, open, end).trim();
    const [f, op, g] = [m[1], m[2], m[3]];
    const rep = op === "\\circ" ? `${f}(${g}(${arg}))` : op === "+" ? `${f}(${arg}) + ${g}(${arg})` : op === "-" ? `${f}(${arg}) - ${g}(${arg})` : `${f}(${arg}) \\cdot ${g}(${arg})`;
    out = out.slice(0, m.index) + rep + out.slice(end);
  }
  return out;
}

// ---------------------------------------------------------------- substitution

const ATOM = /^(?:\d+(?:\.\d+)?|[a-zA-Z])$/;

/** Top-level `+`/`-` after the first character: the text is a sum. */
function isSumLatex(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      if (s.startsWith("\\pm", i) && depth === 0) return true;
      const m = /^\\[a-zA-Z]+/.exec(s.slice(i));
      if (m) i += m[0].length - 1;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if ((ch === "+" || ch === "-") && depth === 0 && i > 0 && s.slice(0, i).trim()) return true;
  }
  return false;
}

/**
 * The parameter replaced by the argument, bracketed where a student would: `2x + 3` at 4 is
 * `2(4) + 3`, `x^{2}` at -2 is `(-2)^{2}`, `\frac{1}{x}` at `a + 1` is `\frac{1}{a + 1}`, `2x`
 * at y is `2y`.
 */
export function substituteParam(body: string, param: string, arg: string): string {
  let out = "";
  const a = unwrap(arg.trim());
  const negative = a.startsWith("-");
  const sum = isSumLatex(a);
  const atom = ATOM.test(a);
  const letter = /^[a-zA-Z]$/.test(a);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(body.slice(i));
      const cmd = m ? m[0] : "\\";
      out += cmd;
      i += cmd.length - 1;
      continue;
    }
    if (ch !== param) {
      out += ch;
      continue;
    }
    const head = body.slice(0, i).replace(/\s+$/, "");
    const prevCh = head.slice(-1);
    const nextCh = body.slice(i + 1).replace(/^\s+/, "").charAt(0);
    if (prevCh === "_") {
      out += ch;
      continue;
    }
    const tail = body.slice(i + 1).replace(/^\s+/, "");
    // a whole brace group (`\frac{1}{x}`), or a whole side of a condition (`x < 0` at -2 is `-2 < 0`)
    const wholeGroup =
      (prevCh === "{" && nextCh === "}" && !/\^\s*\{$/.test(head)) ||
      ((head === "" || /(?:[<>=]|\\(?:le|ge|leq|geq|ne|neq|lt|gt))$/.test(head)) && (tail === "" || /^(?:[<>=]|\\(?:le|ge|leq|geq|ne|neq|lt|gt)(?![a-zA-Z]))/.test(tail)));
    const glued = /[0-9a-zA-Z)}]/.test(prevCh) && !/\\[a-zA-Z]+$/.test(head);
    // `-x^{2}` at 3 is `-(3)^{2}`: a number under a minus and a power is bracketed, so it reads -(3²)
    const minusPower = prevCh === "-" && nextCh === "^" && !letter;
    const bracket = !wholeGroup && (negative || sum || minusPower || (glued && !letter) || (nextCh === "^" && !atom) || (nextCh === "(" && !atom));
    out += bracket ? `(${a})` : a;
  }
  return out;
}

/** `(2x + 3)` → `2x + 3`: one bracket round the whole argument is not part of it. */
function unwrap(s: string): string {
  let t = s;
  for (let guard = 0; guard < 3; guard++) {
    if (!t.startsWith("(") && !t.startsWith("\\left")) return t;
    const end = closeParen(t, 0);
    if (end !== t.length) return t;
    t = innerOf(t, 0, end).trim();
  }
  return t;
}

/** A condition as it is written out: spaces round the relation (`-2 < 0`). */
function spacedCondition(cond: string): string {
  return cond
    .replace(/\s*(<|>|=)\s*/g, " $1 ")
    .replace(/\s*\\(le|ge|leq|geq|ne|neq)(?![a-zA-Z])\s*/g, " \\$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------- evaluating

function flattenSum(node: MathNode, sign: 1 | -1 = 1): Array<{ sign: 1 | -1; node: MathNode }> {
  const n = stripParens(node);
  const f = fnOf(n);
  const a = argsOf(n);
  if (n.type === "OperatorNode" && f === "add") return [...flattenSum(a[0], sign), ...flattenSum(a[1], sign)];
  if (n.type === "OperatorNode" && f === "subtract") return [...flattenSum(a[0], sign), ...flattenSum(a[1], (-sign) as 1 | -1)];
  return [{ sign, node: n }];
}

function flattenProduct(node: MathNode): MathNode[] {
  const n = stripParens(node);
  if (n.type === "OperatorNode" && fnOf(n) === "multiply") return [...flattenProduct(argsOf(n)[0]), ...flattenProduct(argsOf(n)[1])];
  return [n];
}

function realOf(node: MathNode): number | null {
  try {
    const v = node.compile().evaluate({});
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * A numeric line reduced the way a student does it: each summand worked out (or the top and the
 * bottom of a fraction, or each factor), then the value. A zero bottom stops at `\frac{…}{0}`.
 */
export function arithmetic(deps: CourseDeps, latex: string, decimals: boolean): { lines: string[]; value: number } | null {
  const node = parseExpr(deps, latex);
  if (!node || lettersOf(node).length > 0) return null;
  const n = stripParens(node);
  const f = fnOf(n);
  const a = argsOf(n);
  const num = (x: MathNode): string | null => {
    const v = realOf(x);
    return v === null ? null : numberLatex(v, decimals);
  };
  const lines: string[] = [];
  if (n.type === "OperatorNode" && f === "divide" && a.length === 2) {
    const top = num(a[0]);
    const bottom = num(a[1]);
    if (top !== null && bottom === "0") return { lines: [`\\frac{${top}}{0}`], value: NaN };
    if (top !== null && bottom !== null) lines.push(`\\frac{${top}}{${bottom}}`);
  } else if (n.type === "OperatorNode" && (f === "add" || f === "subtract")) {
    const terms = flattenSum(n);
    const texts = terms.map((t) => ({ sign: t.sign, tex: num(t.node) }));
    if (texts.every((t) => t.tex !== null) && terms.some((t) => t.node.type !== "ConstantNode")) {
      let line = "";
      for (const t of texts) {
        const tex = t.tex!;
        const neg = t.sign < 0 !== tex.startsWith("-");
        const mag = tex.replace(/^-/, "");
        line = !line ? (neg ? `-${mag}` : mag) : `${line} ${neg ? "-" : "+"} ${mag}`;
      }
      lines.push(line);
    }
  } else if (n.type === "OperatorNode" && f === "multiply") {
    const factors = flattenProduct(n);
    const parts = factors.map(num);
    if (parts.every((p) => p !== null) && factors.some((x) => x.type !== "ConstantNode")) lines.push(parts.map((p) => (p!.startsWith("-") ? `(${p})` : p)).join(" \\cdot "));
  }
  const whole = evalLatex(deps, latex);
  if (!whole || Math.abs(whole.im) > 1e-9) return null;
  const valueTex = numberLatex(whole.re, decimals);
  if (valueTex === null) return null;
  lines.push(valueTex);
  return { lines, value: whole.re };
}

/** A relation written in LaTeX holds (a piecewise condition with the value in). */
function conditionHolds(deps: CourseDeps, cond: string, scope: Record<string, number> = {}): boolean | null {
  let split: { sides: string[]; ops: string[] };
  try {
    split = splitRelations(cond);
  } catch {
    return null;
  }
  if (split.sides.length < 2) return null;
  const values = split.sides.map((s) => evalLatex(deps, s, scope));
  if (values.some((v) => !v || Math.abs(v.im) > 1e-9)) return null;
  for (let i = 0; i < split.ops.length; i++) {
    const x = values[i]!.re;
    const y = values[i + 1]!.re;
    const op = split.ops[i];
    const eps = 1e-12 * Math.max(1, Math.abs(x), Math.abs(y));
    const ok = op === "<" ? x < y - eps : op === ">" ? x > y + eps : op === "<=" ? x <= y + eps : op === ">=" ? x >= y - eps : op === "==" ? Math.abs(x - y) <= eps : op === "!=" ? Math.abs(x - y) > eps : null;
    if (ok === null) return null;
    if (!ok) return false;
  }
  return true;
}

/** The body a call becomes, and the condition line that chose it (piecewise). Null outside every piece. */
function applied(deps: CourseDeps, def: FunctionDef, arg: string): { body: string; condition?: string } | null {
  if (!def.pieces) return { body: substituteParam(def.rhs, def.param, arg) };
  for (const p of def.pieces) {
    const cond = substituteParam(p.cond, def.param, arg);
    if (conditionHolds(deps, cond)) return { body: substituteParam(p.expr, def.param, arg), condition: spacedCondition(cond) };
  }
  return null;
}

/**
 * The value of a line with calls, straight from the definitions (never from the written
 * working): each innermost call evaluated numerically, then the line. The self-check's reference.
 */
function callValue(deps: CourseDeps, latex: string, defs: ReadonlyMap<string, FunctionDef>, scope: Record<string, number>): Complex | null {
  const names = new Set(defs.keys());
  let cur = latex;
  for (let guard = 0; guard < 8; guard++) {
    const calls = callsOf(cur, names).filter((c) => callsOf(c.arg, names).length === 0);
    if (calls.length === 0) break;
    let next = "";
    let last = 0;
    for (const c of calls) {
      if (c.inverse) return null;
      const v = evalLatex(deps, c.arg, scope);
      if (!v || Math.abs(v.im) > 1e-9) return null;
      const def = defs.get(c.name)!;
      let body = def.rhs;
      if (def.pieces) {
        const piece = def.pieces.find((p) => conditionHolds(deps, p.cond, { [def.param]: v.re }));
        if (!piece) return null;
        body = piece.expr;
      }
      const w = evalLatex(deps, body, { ...scope, [def.param]: v.re });
      if (!w || Math.abs(w.im) > 1e-9) return null;
      next += cur.slice(last, c.start) + `(${w.re.toPrecision(17)})`;
      last = c.end;
    }
    cur = next + cur.slice(last);
  }
  return evalLatex(deps, cur, scope);
}

export interface Evaluated {
  steps: string[];
  latex: string;
}

/**
 * The target line (a call, or an expression of calls, maybe ending `=` / `= ?`) worked out from
 * the definitions: calls replaced innermost first, then the arithmetic or the algebra. Null when
 * the line has no call of a defined function or the working fails its check.
 */
export function evaluateCalls(deps: CourseDeps, target: string, defs: ReadonlyMap<string, FunctionDef>): Evaluated | null {
  try {
    const names = new Set(defs.keys());
    const { body } = withoutQuestionMark(target);
    const start = expandCombinations(body, names);
    const first = callsOf(start, names);
    if (first.length === 0 || first.some((c) => c.inverse)) return null;
    const decimals = /\d\.\d/.test(start) || [...defs.values()].some((d) => /\d\.\d/.test(d.rhs));
    const steps: string[] = [];
    let previous = body;
    const write = (line: string) => {
      if (deps.normalize(line) === deps.normalize(previous)) return;
      steps.push(`= ${line}`);
      previous = line;
    };
    write(start);
    let cur = start;
    let undefinedValue = false;
    for (let guard = 0; guard < 6; guard++) {
      const calls = callsOf(cur, names);
      if (calls.length === 0) break;
      const innermost = calls.filter((c) => callsOf(c.arg, names).length === 0);
      const whole = innermost.length === 1 && innermost[0].start === 0 && innermost[0].end === cur.length;
      let next = "";
      let last = 0;
      let values = "";
      let valueLast = 0;
      let allValued = true;
      for (const c of innermost) {
        const got = applied(deps, defs.get(c.name)!, c.arg);
        if (!got) return null;
        if (got.condition && whole) steps.push(got.condition);
        // a call that is already the whole argument of another call keeps that one bracket
        const wrapped = /(?:\(|\\left\s*\()\s*$/.test(cur.slice(0, c.start)) && /^\s*(?:\)|\\right\s*\))/.test(cur.slice(c.end));
        const bracket = !whole && !wrapped && (isSumLatex(got.body) || got.body.trim().startsWith("-") || /^\s*\^/.test(cur.slice(c.end)));
        next += cur.slice(last, c.start) + (bracket ? `(${got.body})` : got.body);
        last = c.end;
        const bodyNode = parseExpr(deps, got.body);
        const v = bodyNode && lettersOf(bodyNode).length === 0 ? evalLatex(deps, got.body) : null;
        const vTex = v && Math.abs(v.im) < 1e-9 ? numberLatex(v.re, decimals) : null;
        if (vTex === null) allValued = false;
        values += cur.slice(valueLast, c.start) + (vTex === null ? cur.slice(c.start, c.end) : vTex.startsWith("-") && !whole ? `(${vTex})` : vTex);
        valueLast = c.end;
      }
      next += cur.slice(last);
      values += cur.slice(valueLast);
      write(next);
      if (!whole && allValued) {
        // `f(2^{2})` → `f(4)`, `(3(2) - 5) + (3(-1) - 5)` → `1 + (-8)`: each call's value, then on
        write(values);
        cur = values;
        continue;
      }
      cur = next;
    }
    if (callsOf(cur, names).length > 0) return null;
    const node = parseExpr(deps, cur);
    if (!node) return null;
    const letters = lettersOf(node);
    if (letters.length === 0) {
      const ar = arithmetic(deps, cur, decimals);
      if (!ar) return null;
      for (const l of ar.lines) write(l);
      undefinedValue = !Number.isFinite(ar.value);
    } else if (termsOf(node, letters)) {
      const simplified = simplifyExpressionSteps(node, letters, cur, deps.normalize);
      if (simplified) for (const l of simplified) write(l);
    }
    if (steps.length === 0) return null;
    if (undefinedValue) return { steps, latex: steps[steps.length - 1] };
    if (!selfCheck(deps, body, steps, defs)) return null;
    return { steps, latex: steps[steps.length - 1] };
  } catch {
    return null;
  }
}

/** Every `= …` line without a call has the value of the question, computed from the definitions. */
function selfCheck(deps: CourseDeps, body: string, steps: readonly string[], defs: ReadonlyMap<string, FunctionDef>): boolean {
  const names = new Set(defs.keys());
  const plain = steps.filter((s) => s.startsWith("= ") && callsOf(s.slice(2), names).length === 0).map((s) => s.slice(2));
  if (plain.length === 0) return false;
  const letters = new Set<string>();
  for (const s of plain) {
    const n = parseExpr(deps, s);
    if (!n) return false;
    for (const v of lettersOf(n)) letters.add(v);
  }
  let checked = 0;
  for (const scope of sampleScopes([...letters], false)) {
    const ref = callValue(deps, expandCombinations(body, names), defs, scope);
    if (!ref) continue;
    for (const s of plain) {
      const v = evalLatex(deps, s, scope);
      if (!v || !closeC(v, ref, 1e-8)) return false;
    }
    checked++;
    if (letters.size === 0) break;
  }
  return checked >= (letters.size === 0 ? 1 : 3);
}

/** Every call in a line replaced by its body, innermost first, bracketed inside a longer line. */
function substituteCalls(deps: CourseDeps, latex: string, defs: ReadonlyMap<string, FunctionDef>): string | null {
  const names = new Set(defs.keys());
  let cur = expandCombinations(latex, names);
  for (let guard = 0; guard < 6; guard++) {
    const calls = callsOf(cur, names).filter((c) => callsOf(c.arg, names).length === 0);
    if (calls.length === 0) return cur;
    const whole = calls.length === 1 && calls[0].start === 0 && calls[0].end === cur.length;
    let next = "";
    let last = 0;
    for (const c of calls) {
      if (c.inverse) return null;
      const got = applied(deps, defs.get(c.name)!, c.arg);
      if (!got || defs.get(c.name)!.pieces) return null;
      const bracket = !whole && (isSumLatex(got.body) || got.body.trim().startsWith("-") || /^\s*\^/.test(cur.slice(c.end)));
      next += cur.slice(last, c.start) + (bracket ? `(${got.body})` : got.body);
      last = c.end;
    }
    cur = next + cur.slice(last);
  }
  return null;
}

/**
 * `f(x) = 7` or `f(x) = g(x)` under the definitions: each side written out, then solved as any
 * one-unknown equation (`2x + 3 = 7` … `x = 2`). The written-out line is checked against the
 * definitions before its steps are used.
 */
export function solveFunctionEquation(deps: CourseDeps, target: string, defs: ReadonlyMap<string, FunctionDef>): Evaluated | null {
  const sides = splitEquation(target);
  if (!sides || /\?/.test(sides[1])) return null;
  const names = new Set(defs.keys());
  if (callsOf(target, names).length === 0) {
    // `f(x) = 7` read as a new definition of f: the left side is the call
    if (!definitionOf(target)) return null;
  }
  const L = substituteCalls(deps, sides[0], defs);
  const R = substituteCalls(deps, sides[1], defs);
  if (!L || !R) return null;
  const line = `${L} = ${R}`;
  const lNode = parseExpr(deps, L);
  const rNode = parseExpr(deps, R);
  if (!lNode || !rNode) return null;
  const letters = [...new Set([...lettersOf(lNode), ...lettersOf(rNode)])];
  if (letters.length !== 1) return null;
  let checked = 0;
  for (const scope of sampleScopes(letters, false)) {
    const a = callValue(deps, sides[0], defs, scope);
    const b = callValue(deps, sides[1], defs, scope);
    const c = evalLatex(deps, L, scope);
    const d = evalLatex(deps, R, scope);
    if (!a || !b || !c || !d) continue;
    if (!closeC(a, c, 1e-8) || !closeC(b, d, 1e-8)) return null;
    checked++;
  }
  if (checked < 3) return null;
  const solved = deps.solveOne(line);
  if (!solved) return null;
  const steps = [line, ...solved.steps.filter((s) => deps.normalize(s) !== deps.normalize(line))];
  return { steps: steps.slice(0, 8).length === steps.length ? steps : [line, ...solved.steps.slice(-7)], latex: solved.latex };
}

/**
 * `f^{-1}(x)` from `f(x) = …`: written as y, x and y swapped, solved for y, named. Null when the
 * inverse is not a function the literal solver can write (an even power) or fails its check.
 */
export function inverseOf(deps: CourseDeps, target: string, defs: ReadonlyMap<string, FunctionDef>): Evaluated | null {
  const { body } = withoutQuestionMark(target);
  const m = /^([a-zA-Z])\s*\^\s*\{\s*-\s*1\s*\}\s*(?:\\left\s*)?\(\s*([a-zA-Z])\s*(?:\\right\s*)?\)$/.exec(body.trim());
  if (!m) return null;
  const def = defs.get(m[1]);
  if (!def || def.pieces) return null;
  const x = m[2];
  const y = x === "y" ? "t" : "y";
  const asY = substituteParam(def.rhs, def.param, x);
  const swapped = substituteParam(def.rhs, def.param, y);
  const node = parseExpr(deps, swapped);
  if (!node) return null;
  // an even power has no inverse function without a restricted domain
  let evenPower = false;
  node.traverse((n: MathNode) => {
    if (n.type === "OperatorNode" && fnOf(n) === "pow") {
      const e = realOf(argsOf(n)[1]);
      if (e !== null && Number.isInteger(e) && e % 2 === 0) evenPower = true;
    }
  });
  if (evenPower) return null;
  const first = `${y} = ${asY}`;
  const swap = `${x} = ${swapped}`;
  const solved = solveForLetter(deps, swap, y, { positive: false });
  if (!solved) return null;
  const final = `${m[1]}^{-1}(${x}) = ${solved.value}`;
  let steps = [first, swap, ...solved.steps.filter((s) => deps.normalize(s) !== deps.normalize(swap)), final];
  if (steps.length > 8) steps = [first, swap, ...steps.slice(steps.length - 6)];
  // the check: f(f^{-1}(x)) = x wherever both are defined
  const inv = parseExpr(deps, solved.value);
  const fx = parseExpr(deps, def.rhs);
  if (!inv || !fx) return null;
  let ok = 0;
  for (const v of [0.37, 1.13, 2.29, 3.17, 5.3, 7.1, -0.61, -2.3]) {
    const w = realAt(inv, { [x]: v });
    if (w === null) continue;
    const back = realAt(fx, { [def.param]: w });
    if (back === null) continue;
    if (Math.abs(back - v) > 1e-7 * Math.max(1, Math.abs(v))) return null;
    ok++;
  }
  return ok >= 3 ? { steps, latex: final } : null;
}

function realAt(node: MathNode, scope: Record<string, number>): number | null {
  try {
    const v = node.compile().evaluate({ ...scope });
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * A student's line that claims a value (`f(4) = 11`, `f(a + 1) = 2a + 5`) under a definition:
 * ok when both sides agree once each call is replaced, mismatch when they do not. Null for a
 * line that is not such a claim.
 */
export function checkClaim(deps: CourseDeps, latex: string, defs: ReadonlyMap<string, FunctionDef>): "ok" | "mismatch" | null {
  const sides = splitEquation(latex);
  if (!sides) return null;
  const names = new Set(defs.keys());
  const calls = callsOf(latex, names);
  if (calls.length === 0 || calls.some((c) => c.inverse)) return null;
  // `f(x) = …` again is a definition, not a claim
  if (definitionOf(latex)) return null;
  const letters = new Set<string>();
  for (const side of sides) {
    const stripped = side.replace(/[a-zA-Z]\s*(?:\\left\s*)?\(/g, "(");
    const n = parseExpr(deps, stripped);
    if (!n) return null;
    for (const v of lettersOf(n)) if (!names.has(v)) letters.add(v);
  }
  let agree = 0;
  for (const scope of sampleScopes([...letters], false)) {
    const l = callValue(deps, expandCombinations(sides[0], names), defs, scope);
    const r = callValue(deps, expandCombinations(sides[1], names), defs, scope);
    if (!l || !r) continue;
    if (!closeC(l, r, 1e-8)) return "mismatch";
    agree++;
    if (letters.size === 0) break;
  }
  return agree >= (letters.size === 0 ? 1 : 3) ? "ok" : null;
}

/** A function line's analysis (`f(x) = 2 * x + 3`, mathjs) back as a definition. */
export function definitionFromMath(deps: CourseDeps, math: string): FunctionDef | null {
  const m = /^([a-zA-Z])\(([a-zA-Z])\)\s*=\s*([\s\S]+)$/.exec(math);
  if (!m) return null;
  try {
    const node = deps.math.parse(m[3]);
    const tex = printMathSource(node);
    return tex ? { name: m[1], param: m[2], rhs: tex } : null;
  } catch {
    return null;
  }
}

function printMathSource(node: MathNode): string | null {
  try {
    return node.toTex({ parenthesis: "keep" }).replace(/\\cdot/g, " \\cdot ").replace(/\\mathrm\{([a-zA-Z])\}/g, "$1");
  } catch {
    return null;
  }
}
