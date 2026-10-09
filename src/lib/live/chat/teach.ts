// The check only (no drawing code): the chat route runs it on the server, the teach writer runs it
// again on the board before its hand writes a stroke (the same function, so both judge alike).
import { layoutSteps } from "@/lib/hand";
import type { LineAnalysis, LiveEngine } from "../contracts";
import { normaliseWords } from "../lecture/words";
import { analyzeColumn, localSolve } from "../localSolve";
import { hasWords } from "./verify";

/**
 * The board chat's worked solutions (`teach`): the tutor teaches a problem on the board the way a
 * teacher does — a sentence saying what happens next, the maths under it, the answer last — and
 * NOTHING of the maths is written until the engine has checked it. `checkTeach` is that check,
 * pure and fast (a few hundred engine calls at most), run by the chat route (which repairs a teach
 * it fails once, else drops it and refunds) and again by the board before writing.
 *
 * The words (`say`) are not checked — they are words — but everything under them is:
 *
 *  1. CHAINS. A step's maths is one or more chains: a line, then lines that start with `=` (or
 *     `\approx`) continuing it — `OR = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}`, `= \sqrt{(a +
 *     \sqrt{6} - a)^2 + (b + 5 - b)^2}`, `= \sqrt{31}`. Every link must be EQUAL: the engine
 *     judges `left = right` with every letter given numbers, four times over (`linkHolds`) — `a`
 *     and `b`, `OR` (a segment is one quantity), `x_2`, `\theta` alike — so an identity in free
 *     letters holds and a slip (`\sqrt{6 + 25} = \sqrt{30}`) is caught. Calculus the engine judges
 *     itself (`\frac{d}{dx}(x^{3}) = 3x^{2}`).
 *  2. A FORMULA, THEN ITS NUMBERS. The first link of a chain may put values into a formula: its
 *     letters that vanish (`x_1`, `x_2`, `y_1`, `y_2`) are matched against the next line
 *     (`matchTemplate`: the formula's text with each such letter as a hole, the holes balanced
 *     pieces of the line) and the formula with those values put in must then equal the line — so
 *     the substitution is checked as maths, not trusted. Which numbers belong in it (that R's
 *     x-coordinate is `a + \sqrt{6}`) is the reading of the problem, which no engine can check.
 *  3. NAMES CARRY. A chain headed by a name (`OR = …`, `RS^{2} = …`, `m\angle B = …`, `f(3) = …`)
 *     states its value; later maths is checked with it put in (`2OR^{2}` is `2(\sqrt{31})^{2}`),
 *     a restated value must agree (`OR = \sqrt{30}` after `OR = \sqrt{31}` is caught), and a
 *     segment's square gives the segment (`RS^{2} = 62` → `RS = \sqrt{62}`).
 *  4. EQUATIONS. A line that is an equation or inequality to solve (`2x + 3 = 11`, `x - y = 2`)
 *     starts or continues a column, and each line under it must follow as the engine ticks a
 *     student's column (`analyzeColumn`), or be satisfied by what the column's own equations solve
 *     to (a system's elimination lines); a first line is the problem's setup, taken as given.
 *  5. AT THE END every relation that was taken as given (a setup, a definition) is checked again
 *     with every value the working found, and the answer must agree with the working
 *     (`RS^{2} = 64` after it found 62 is caught).
 *  6. The hand can write every line, and the words have no symbol it cannot write.
 *
 * What comes back on a failure are sentences the model can act on ("Step 2, line 4:
 * `\sqrt{6 + 25}` is not equal to `\sqrt{30}`"), for the route's one repair round-trip.
 */

export const TEACH_CHECK = {
  /** the hand size the writability check lays each line out at */
  handSize: 34,
  /** at most this many different letters and names in one link (more: it cannot be checked) */
  maxNames: 12,
  /**
   * Values the letters are given, one set per check: positive (lengths, coordinates and radii are),
   * irregular and different from each other, so a slip does not cancel out.
   */
  samples: [
    [3, 7, 2, 5, 11, 4, 6, 13, 9, 8, 12, 10],
    [5, 2, 9, 4, 3, 8, 12, 7, 6, 11, 10, 13],
    [8, 11, 3, 13, 2, 5, 4, 9, 7, 6, 10, 12],
    [1.5, 2.5, 3.25, 4.75, 0.5, 5.5, 6.25, 7.5, 2.25, 3.75, 4.25, 1.25],
  ] as readonly (readonly number[])[],
  /** work the template matcher may do on one link, and the matches it tries */
  matchBudget: 20_000,
  maxMatches: 24,
  /** findings sent back to the model (the first ones) */
  maxProblems: 6,
} as const;

// ------------------------------------------------------------------ the action, as the check reads it

export interface TeachStepInput {
  say: string;
  math?: readonly string[];
}

export interface TeachInput {
  steps: readonly TeachStepInput[];
  answer?: string;
}

export interface TeachFinding {
  /** 1-based step, 0 for the answer */
  step: number;
  /** 1-based line of the step's maths, when it is one line */
  line?: number;
  problem: string;
}

export type TeachVerdict =
  | {
      ok: true;
      /** links the engine showed equal (or a column line it ticked) */
      checked: number;
      /** what the working found: each named quantity's value (LaTeX), for the eval and the tests */
      found: Record<string, string>;
      /** the answer's value when it states one (`RS^{2} = 62` → `62`) */
      answerValue: string | null;
    }
  | { ok: false; problems: string[]; findings: TeachFinding[] };

// ------------------------------------------------------------------ LaTeX, as names and the rest

/** Greek letters that name a quantity (`\theta`); `\pi` is a number and stays. */
const GREEK = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "kappa", "lambda", "mu", "nu", "xi", "rho", "sigma", "tau", "phi", "varphi", "chi", "psi", "omega"]);

/** A piece of a line: a name (a quantity: `x`, `a`, `OR`, `x_{2}`, `m∠ABC`, `\theta`) or literal text. */
export interface Tok {
  /** the quantity's key (`OR`, `x_{2}`, `∠ROS`), or null for literal text */
  name: string | null;
  text: string;
}

/**
 * A line of LaTeX as the quantities it names and the text between them. A run of capitals is ONE
 * name (`OR`, `RS`, `ABC`: a segment, a triangle), as is a letter with a subscript (`x_{2}`), an
 * angle (`\angle ROS`, `m\angle ROS`), a segment written `\overline{AB}` (the same name as `AB`)
 * and a Greek letter other than π. `e` and `i` are the constants. Commands, digits and symbols are
 * literal.
 */
export function tokenize(latex: string): Tok[] {
  const s = latex;
  const out: Tok[] = [];
  const lit = (t: string) => {
    const last = out[out.length - 1];
    if (last && last.name === null) last.text += t;
    else out.push({ name: null, text: t });
  };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const ch = s[i];
    if (ch === "\\") {
      const angle = /^\\(?:measured)?angle\s*\{?\s*([A-Z]{1,3})\s*\}?/.exec(rest);
      if (angle) {
        out.push({ name: `∠${angle[1]}`, text: angle[0] });
        i += angle[0].length;
        continue;
      }
      const over = /^\\overline\s*\{\s*([A-Z]{2,3})\s*\}/.exec(rest);
      if (over) {
        out.push({ name: over[1], text: over[0] });
        i += over[0].length;
        continue;
      }
      const words = /^\\(?:text[a-z]*|mathrm|operatorname|mbox)\s*\{[^{}]*\}/.exec(rest);
      if (words) {
        lit(words[0]);
        i += words[0].length;
        continue;
      }
      const cmd = /^\\([A-Za-z]+)/.exec(rest);
      if (!cmd) {
        lit(rest.slice(0, 2));
        i += Math.min(2, rest.length);
        continue;
      }
      if (GREEK.has(cmd[1])) {
        const sub = /^_(?:\{([^{}]*)\}|([A-Za-z0-9]))/.exec(s.slice(i + cmd[0].length));
        const key = `\\${cmd[1]}${sub ? `_{${(sub[1] ?? sub[2]).replace(/\s+/g, "")}}` : ""}`;
        const len = cmd[0].length + (sub ? sub[0].length : 0);
        out.push({ name: key, text: s.slice(i, i + len) });
        i += len;
        continue;
      }
      lit(cmd[0]);
      i += cmd[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      const measure = /^m\s*\\(?:measured)?angle\s*\{?\s*([A-Z]{1,3})\s*\}?/.exec(rest);
      if (measure) {
        out.push({ name: `m∠${measure[1]}`, text: measure[0] });
        i += measure[0].length;
        continue;
      }
      if (/[A-Z]/.test(ch)) {
        let j = i;
        while (j < s.length && /[A-Z]/.test(s[j])) j++;
        if (j - i >= 2) {
          out.push({ name: s.slice(i, j), text: s.slice(i, j) });
          i = j;
          continue;
        }
      }
      let j = i + 1;
      let key = ch;
      const sub = /^_(?:\{([^{}]*)\}|([A-Za-z0-9]))/.exec(s.slice(j));
      if (sub) {
        key += `_{${(sub[1] ?? sub[2]).replace(/\s+/g, "")}}`;
        j += sub[0].length;
      }
      while (s[j] === "'") {
        key += "'";
        j++;
      }
      if (!sub && key.length === 1 && (ch === "e" || ch === "i")) {
        lit(ch);
        i++;
        continue;
      }
      out.push({ name: key, text: s.slice(i, j) });
      i = j;
      continue;
    }
    lit(ch);
    i++;
  }
  return out;
}

/** The quantities a line names. */
export function namesOf(latex: string): Set<string> {
  return new Set(tokenize(latex).flatMap((t) => (t.name ? [t.name] : [])));
}

/** The line with named quantities replaced by values (each in brackets): `2OR^{2}` → `2(\sqrt{31})^{2}`. */
export function substitute(latex: string, values: ReadonlyMap<string, string>): string {
  return tokenize(latex)
    .map((t) => (t.name !== null && values.has(t.name) ? bracket(values.get(t.name)!) : t.text))
    .join("");
}

/** A value in brackets, unless it is one bracket already (`(4, 5)` stays a pair). */
function bracket(value: string): string {
  const v = value.trim();
  if (/^\(.*\)$/.test(v) && balanced(v.slice(1, -1))) return v;
  return `(${v})`;
}

/**
 * The line as text to compare: no spaces (one kept where it ends a command before a letter), no
 * `\left` / `\right` or spacing commands, `x^2` as `x^{2}`, `\sqrt6` as `\sqrt{6}`, `\dfrac` as `\frac`.
 */
export function normTex(latex: string): string {
  return latex
    .replace(/\\(?:left|right)\s*(?=[()[\]|.]|\\[{}])/g, "")
    .replace(/\\[dt]frac/g, "\\frac")
    .replace(/\\[,;:!]|\\ |~/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(\\[A-Za-z]+) (?=[A-Za-z])/g, "$1\u0000")
    .replace(/ /g, "")
    .replace(/\u0000/g, " ")
    .replace(/\\sqrt(\d)/g, "\\sqrt{$1}")
    .replace(/\\frac(\d)(\d)/g, "\\frac{$1}{$2}")
    .replace(/([\^_])([A-Za-z0-9])/g, "$1{$2}")
    .trim();
}

// ------------------------------------------------------------------ relations

const REL = String.raw`=|\\approx|\\neq|\\ne|\\leq|\\le|\\geq|\\ge|\\lt|\\gt|<|>`;
const REL_AT = new RegExp(`^(?:${REL})(?![A-Za-z])`);

/** The relation symbols of a line at the top level (outside every bracket), with where each is. */
export function relationsIn(latex: string): Array<{ at: number; rel: string }> {
  const out: Array<{ at: number; rel: string }> = [];
  let depth = 0;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === "\\" && /^\\(?:left|right)/.test(latex.slice(i))) continue;
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth > 0) continue;
    const m = REL_AT.exec(latex.slice(i));
    // a `\le` inside `\left` is not a relation (skipped above); `\neq` before `\ne`
    if (m && !(ch === "\\" && /^\\(?:left|lim|leftarrow|ln|log)/.test(latex.slice(i)))) {
      out.push({ at: i, rel: m[0] });
      i += m[0].length - 1;
    }
  }
  return out;
}

/** A line split at its top-level relations: the parts and the relation between each two. */
export function splitRelations(latex: string): { parts: string[]; rels: string[] } {
  const rels = relationsIn(latex);
  const parts: string[] = [];
  let from = 0;
  for (const r of rels) {
    parts.push(latex.slice(from, r.at).trim());
    from = r.at + r.rel.length;
  }
  parts.push(latex.slice(from).trim());
  return { parts, rels: rels.map((r) => r.rel) };
}

/** The line begins with a relation: it continues the line above (`= 2(31)`). */
export function continues(line: string): boolean {
  return REL_AT.test(line.trim());
}

const EQUALS = new Set(["=", "\\approx"]);

/** A list of relations at the top level (`x = 2, \ x = 3`): the engine judges it as a whole. */
function isList(latex: string): boolean {
  let depth = 0;
  for (const ch of latex) {
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) return true;
  }
  return false;
}

/** A tuple `(a, b)`: compared part by part. */
function tupleParts(latex: string): string[] | null {
  const t = latex.trim();
  if (!/^\(.*\)$/.test(t)) return null;
  const inner = t.slice(1, -1);
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") {
      depth--;
      if (depth < 0) return null;
    } else if (ch === "," && depth === 0) {
      out.push(inner.slice(from, i).trim());
      from = i + 1;
    }
  }
  if (depth !== 0) return null;
  out.push(inner.slice(from).trim());
  return out.length >= 2 && out.every(Boolean) ? out : null;
}

/** Maths the engine judges by putting numbers in; calculus it judges itself. */
function isPlain(latex: string): boolean {
  return !/\\(?:int|lim|sum|prod|partial|mathrm)\b|\\frac\{d|d\/dx|'/.test(latex);
}

/**
 * The name a part states the value of, when it is one: `OR`, `RS^{2}`, `x`, `A`, `m∠B`, `f(3)`,
 * `\theta`. `strict`: not a lower-case letter squared (`x^{2} = 9` on a line of its own is an
 * equation to solve; `c^{2} = a^{2} + b^{2}` heading a chain states c²).
 */
function headOf(part: string, strict = false): { name: string; power: string | null; call: boolean } | null {
  const toks = tokenize(part.trim()).filter((t) => t.name !== null || t.text.trim() !== "");
  if (toks.length === 0 || toks[0].name === null) return null;
  const name = toks[0].name;
  if (toks.length === 1) return { name, power: null, call: false };
  if (toks.length === 2 && toks[1].name === null) {
    const rest = normTex(toks[1].text);
    const pow = /^\^\{(\d+)\}$/.exec(rest);
    if (pow) return strict && /^[a-z]$/.test(name) ? null : { name, power: pow[1], call: false };
  }
  // a function at a value or a variable: f(3), g(x)
  const text = normTex(part);
  if (/^[a-zA-Z]\([^()]*\)$/.test(text) && /^[a-zA-Z]$/.test(name)) return { name, power: null, call: true };
  return null;
}

// ------------------------------------------------------------------ the engine's judgement

type Link = "ok" | "mismatch" | "unknown";

function verdictOf(engine: LiveEngine, latex: string): LineAnalysis["verdict"] | undefined {
  try {
    return engine.analyzeLine(latex, { mode: "answer" }).verdict;
  } catch {
    return undefined;
  }
}

/**
 * Is `b` equal to `a`? Tuples part by part; calculus as the engine judges `a = b` itself; otherwise
 * every name is given the same number on both sides, four times over (`TEACH_CHECK.samples`), and
 * the engine judges each closed equation exactly as it judges `2 + 2 = 5`. `ok` only when every
 * sample holds; `mismatch` when every sample it could judge is false; `unknown` otherwise.
 */
export function linkHolds(engine: LiveEngine, a: string, b: string): Link {
  if (!a.trim() || !b.trim()) return "unknown";
  const ta = tupleParts(a);
  const tb = tupleParts(b);
  if (ta || tb) {
    if (!ta || !tb || ta.length !== tb.length) return "unknown";
    let all: Link = "ok";
    for (let k = 0; k < ta.length; k++) {
      const v = linkHolds(engine, ta[k], tb[k]);
      if (v === "mismatch") return "mismatch";
      if (v !== "ok") all = "unknown";
    }
    return all;
  }
  if (!isPlain(a) || !isPlain(b)) {
    const v = verdictOf(engine, `${a} = ${b}`);
    return v === "ok" ? "ok" : v === "mismatch" ? "mismatch" : "unknown";
  }
  const names = [...new Set([...namesOf(a), ...namesOf(b)])];
  if (names.length === 0) {
    const v = verdictOf(engine, `${a} = ${b}`);
    return v === "ok" ? "ok" : v === "mismatch" ? "mismatch" : "unknown";
  }
  if (names.length > TEACH_CHECK.maxNames) return "unknown";
  let ok = 0;
  let wrong = 0;
  for (const sample of TEACH_CHECK.samples) {
    const values = new Map(names.map((n, k) => [n, String(sample[k])] as const));
    const v = verdictOf(engine, `${substitute(a, values)} = ${substitute(b, values)}`);
    if (v === "ok") ok++;
    else if (v === "mismatch") wrong++;
  }
  if (ok === TEACH_CHECK.samples.length) return "ok";
  return wrong > 0 && ok === 0 ? "mismatch" : "unknown";
}

// ------------------------------------------------------------------ a formula, then its numbers

type Piece = { hole: string } | { lit: string };

/** Round, curly and square brackets balance, never closing one that is not open. */
function balanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * The ways `line` is `template` with each of the `holes` (names in the template) replaced by a
 * piece of the line: the same piece wherever a name recurs, every piece non-empty and balanced.
 * Text matching on `normTex`, bounded (`TEACH_CHECK.matchBudget`); the caller checks each match
 * as maths, so a match that is only textual is harmless.
 */
export function matchTemplate(template: string, line: string, holes: ReadonlySet<string>): Array<Map<string, string>> {
  const pieces: Piece[] = [];
  for (const t of tokenize(normTex(template))) {
    if (t.name !== null && holes.has(t.name)) pieces.push({ hole: t.name });
    else {
      const text = t.text;
      const last = pieces[pieces.length - 1];
      if (last && "lit" in last) last.lit += text;
      else pieces.push({ lit: text });
    }
  }
  // spaces are only where a command meets a letter: literals are matched without them
  for (const p of pieces) if ("lit" in p) p.lit = p.lit.replace(/ /g, "");
  const s = normTex(line).replace(/(\\[A-Za-z]+) (?=[A-Za-z])/g, "$1\u0000").replace(/ /g, "").replace(/\u0000/g, " ");
  /** where `lit` ends when it is at `pos` of the line, spaces in the line skipped; -1 when it is not */
  const litEnd = (lit: string, pos: number): number => {
    let i = pos;
    for (const ch of lit) {
      while (s[i] === " ") i++;
      if (s[i] !== ch) return -1;
      i++;
    }
    return i;
  };
  const out: Array<Map<string, string>> = [];
  let budget = TEACH_CHECK.matchBudget;
  const map = new Map<string, string>();
  const go = (k: number, pos: number): void => {
    if (out.length >= TEACH_CHECK.maxMatches || --budget < 0) return;
    if (k === pieces.length) {
      if (pos === s.length) out.push(new Map(map));
      return;
    }
    const p = pieces[k];
    if ("lit" in p) {
      const end = litEnd(p.lit, pos);
      if (end >= 0) go(k + 1, end);
      return;
    }
    const known = map.get(p.hole);
    if (known !== undefined) {
      const end = litEnd(known.replace(/ /g, ""), pos);
      if (end >= 0) go(k + 1, end);
      return;
    }
    const next = pieces[k + 1];
    for (let end = pos + 1; end <= s.length; end++) {
      if (next && "lit" in next && litEnd(next.lit, end) < 0) continue;
      const piece = s.slice(pos, end).trim();
      if (!piece) continue;
      if (!balanced(piece)) continue;
      map.set(p.hole, piece);
      go(k + 1, end);
      map.delete(p.hole);
      if (out.length >= TEACH_CHECK.maxMatches || budget < 0) return;
    }
  };
  go(0, 0);
  return out;
}

/** `line` is `template` with values put in for the names that vanish, and equal to it with them. */
function templateHolds(engine: LiveEngine, template: string, line: string): boolean {
  const inLine = namesOf(line);
  const holes = new Set([...namesOf(template)].filter((n) => !inLine.has(n)));
  if (holes.size === 0) return false;
  for (const m of matchTemplate(template, line, holes)) {
    if (linkHolds(engine, substitute(normTex(template), m), line) === "ok") return true;
  }
  return false;
}

/** The same, for a whole relation (`a^{2} + b^{2} = c^{2}` → `6^{2} + 8^{2} = c^{2}`): side by side. */
function templateRelationHolds(engine: LiveEngine, template: string, line: string): boolean {
  const inLine = namesOf(line);
  const holes = new Set([...namesOf(template)].filter((n) => !inLine.has(n)));
  if (holes.size === 0) return false;
  const want = splitRelations(line);
  for (const m of matchTemplate(template, line, holes)) {
    const got = splitRelations(substitute(normTex(template), m));
    if (got.parts.length !== want.parts.length || got.rels.join() !== want.rels.join()) continue;
    if (got.parts.every((p, k) => linkHolds(engine, p, want.parts[k]) === "ok")) return true;
  }
  return false;
}

// ------------------------------------------------------------------ the check

interface Known {
  value: string;
  step: number;
  /** what the step said it is, for a message (`OR = \sqrt{31}`) */
  said: string;
}

interface Given {
  a: string;
  b: string;
  step: number;
  line: number;
}

const quote = (s: string) => `"${s.trim()}"`;

/** One chain's lines: its parts, the relation before each part after the first, and each part's line. */
interface Chain {
  parts: string[];
  rels: string[];
  at: number[];
  lines: Array<{ text: string; n: number }>;
}

/** A step's maths as chains: a line, then the lines that continue it (`= …`). */
export function chainsOf(math: readonly string[]): Chain[] {
  const out: Chain[] = [];
  math.forEach((text, k) => {
    const n = k + 1;
    const sp = splitRelations(text);
    const cur = out[out.length - 1];
    if (continues(text) && cur) {
      // `= 2(31)`: the relation it starts with, then its parts
      const lead = splitRelations(`x${text.trim()}`);
      cur.rels.push(lead.rels[0], ...sp.rels.slice(1));
      sp.parts.slice(1).forEach((p) => {
        cur.parts.push(p);
        cur.at.push(n);
      });
      cur.lines.push({ text, n });
      return;
    }
    out.push({ parts: sp.parts, rels: sp.rels, at: sp.parts.map(() => n), lines: [{ text, n }] });
  });
  return out;
}

/**
 * The engine's check of a worked solution (see the file comment). `canDraw` is the hand's
 * interlock for the maths; by default the hand's own layout at `TEACH_CHECK.handSize`.
 */
export function checkTeach(engine: LiveEngine, teach: TeachInput, canDraw: (lines: readonly string[]) => boolean = handCanWrite): TeachVerdict {
  const findings: TeachFinding[] = [];
  const find = (step: number, problem: string, line?: number) => {
    if (!findings.some((f) => f.problem === problem)) findings.push({ step, problem, ...(line ? { line } : {}) });
  };
  /** named quantities → their value */
  const facts = new Map<string, Known>();
  /** stated values of heads that are not a bare name (`RS^{2}`, `f(3)`), by their text */
  const claims = new Map<string, Known>();
  /** relations taken as given (a definition, a setup): checked again at the end with every value found */
  const givens: Given[] = [];
  /** the column of equations being solved, and the lines that were its setup */
  let column: Array<{ latex: string; step: number; line: number }> = [];
  let setups: string[] = [];
  let checked = 0;
  let last: { head: string | null; value: string } | null = null;
  /** every line and every `head = value` the working wrote, as text (the answer may repeat one) */
  const wrote = new Set<string>();

  const values = () => new Map([...facts].map(([k, v]) => [k, v.value] as const));
  /** a part with every value known put in (a claimed head by its value) */
  const resolve = (part: string): string => {
    const c = claims.get(normTex(part));
    if (c) return c.value;
    return substitute(part, values());
  };
  /** at the end: a head through its names' values first (`c^{2}` with `c = 11` is 121, whatever was claimed) */
  const resolveFinal = (part: string): string => {
    const v = substitute(part, values());
    if (namesOf(v).size === 0) return v;
    return claims.get(normTex(part))?.value ?? v;
  };
  const isKnown = (part: string) => claims.has(normTex(part)) || namesOf(resolve(part)).size === 0;

  const setFact = (name: string, value: string, step: number) => {
    if (facts.has(name)) return;
    const v = resolve(value);
    if (namesOf(v).has(name)) return;
    facts.set(name, { value: v, step, said: `${name} = ${v}` });
  };

  const recordHead = (head: string, value: string, step: number) => {
    const h = headOf(head);
    if (!h) return;
    const v = resolve(value);
    wrote.add(normTex(`${head}=${value}`));
    if (!h.power && !h.call) return setFact(h.name, value, step);
    const key = normTex(head);
    if (!claims.has(key)) claims.set(key, { value: v, step, said: `${head.trim()} = ${v}` });
    // a segment's square gives the segment: RS^{2} = 62 → RS = \sqrt{62}
    if (h.power === "2" && /^[A-Z]{2,3}$/.test(h.name) && namesOf(v).size === 0) setFact(h.name, `\\sqrt{${v}}`, step);
  };

  const whenFound = (part: string): string => {
    const h = headOf(part);
    const k = (h && facts.get(h.name)) || claims.get(normTex(part));
    return k ? ` (step ${k.step} found ${quote(k.said)})` : "";
  };

  // ---------------------------------------------------------------- a chain of equal parts
  const chain = (c: Chain, step: number) => {
    const { parts, rels, at } = c;
    const head = headOf(parts[0]) && !isKnown(parts[0]) ? parts[0] : null;
    /**
     * Quantities the chain names that were not known before it: its head (`OR = …`), one on the way
     * (`OR = OS = …`), one it ends in (`… = OS`). A link to or from one is what the chain says that
     * quantity IS — taken as given, and checked again at the end with every value found.
     */
    const named = parts.map((p, k) => (k === 0 ? head !== null : headOf(p) !== null && !isKnown(p)));
    /** the first link the chain computes (not a definition): where a formula may take the problem's numbers */
    const firstComputed = parts.findIndex((_, i) => i + 1 < parts.length && !named[i] && !named[i + 1]);
    let failed = false;
    for (let i = 0; i + 1 < parts.length; i++) {
      const a = parts[i];
      const b = parts[i + 1];
      const line = at[i + 1];
      if (!EQUALS.has(rels[i])) {
        failed = true;
        find(step, `Step ${step}, line ${line}: a chain continues with "=" only; write ${quote(`${a} ${rels[i]} ${b}`)} as a line of its own.`, line);
        continue;
      }
      if (named[i] || named[i + 1]) {
        givens.push({ a, b, step, line });
        continue;
      }
      const ra = resolve(a);
      const rb = resolve(b);
      const first = i === firstComputed;
      if (first && templateHolds(engine, ra, rb)) {
        checked++;
        continue;
      }
      const v = linkHolds(engine, ra, rb);
      if (v === "ok") {
        checked++;
        continue;
      }
      failed = true;
      // a formula whose letters vanish: the numbers were not put in where they belong (or a leap)
      const leap = first && [...namesOf(ra)].some((n) => !namesOf(rb).has(n));
      if (v === "mismatch" && !leap) find(step, `Step ${step}, line ${line}: ${quote(a)} is not equal to ${quote(b)}${i === 0 ? whenFound(a) : ""}.`, line);
      else if (leap)
        find(
          step,
          `Step ${step}, line ${line}: the engine could not check that ${quote(b)} is ${quote(a)} with the numbers put in. Write the formula, then the formula with the numbers put in exactly where its letters were, then simplify one step per line.`,
          line,
        );
      else find(step, `Step ${step}, line ${line}: the engine could not check that ${quote(a)} equals ${quote(b)}. Take one small step per line, each line equal to the one above.`, line);
    }
    // the chain's value: its last part, or the part before a name it ends in
    const endAt = named[parts.length - 1] ? parts.length - 2 : parts.length - 1;
    const end = parts[endAt];
    wrote.add(normTex(`${parts[0]}=${parts[parts.length - 1]}`));
    if (failed) return;
    if (head) recordHead(head, end, step);
    for (let k = 1; k < parts.length; k++) if (named[k]) recordHead(parts[k], end, step);
    last = { head: head ?? (headOf(parts[0]) ? parts[0] : null), value: resolve(end) };
  };

  // ---------------------------------------------------------------- an equation or inequality in a column
  const relationLine = (latex: string, step: number, line: number) => {
    const names = namesOf(latex);
    const inColumn = column.some((c) => [...namesOf(c.latex)].some((n) => names.has(n)));
    const said = latex.trim();
    const took = (as: "setup" | "followed") => {
      const { parts, rels } = splitRelations(latex);
      if (as === "setup") {
        if (!inColumn) {
          column = [];
          setups = [];
        }
        setups.push(latex);
        if (parts.length === 2 && rels[0] === "=" && !isList(latex)) givens.push({ a: parts[0], b: parts[1], step, line });
      } else checked++;
      column.push({ latex, step, line });
      wrote.add(normTex(latex));
      // `x = 4`: the letter's value from here on
      const h = parts.length === 2 && rels[0] === "=" && !isList(latex) ? headOf(parts[0]) : null;
      if (h && !h.power && !h.call && namesOf(resolve(parts[1])).size === 0) setFact(h.name, parts[1], step);
      last = { head: parts.length === 2 ? parts[0] : null, value: parts[parts.length - 1] };
    };
    if (!inColumn) return took("setup");
    const above = column[column.length - 1].latex;
    const notFollow = () => find(step, `Step ${step}, line ${line}: ${quote(said)} does not follow from ${quote(above)}.`, line);
    // a formula, then the problem's numbers in it (`a^{2} + b^{2} = c^{2}` → `6^{2} + 8^{2} = c^{2}`)
    if (column.length === 1 && templateRelationHolds(engine, column[0].latex, latex)) return took("followed");
    let verdict: LineAnalysis["verdict"] | undefined;
    try {
      verdict = analyzeColumn(engine, [...column.map((c) => c.latex), latex], "answer").pop()?.verdict;
    } catch {
      verdict = undefined;
    }
    if (verdict === "ok") return took("followed");
    // what the column's own equations solve to, put into this line (a system's elimination)
    const solved = solveValues(engine, setups);
    if (names.size > 0 && [...names].every((n) => solved.has(n))) {
      const v = linkHoldsRelation(engine, substitute(latex, solved));
      if (v === "ok") return took("followed");
      if (v === "mismatch") return notFollow();
    }
    if (verdict === "mismatch") return notFollow();
    // the column's equations do not fix every letter yet: another equation of the setup (a system)
    const letters = new Set(setups.flatMap((l) => [...namesOf(l)]));
    if ([...letters].some((n) => !solved.has(n))) return took("setup");
    find(step, `Step ${step}, line ${line}: the engine could not check that ${quote(said)} follows from ${quote(above)}. Take one small step per line.`, line);
  };

  // ---------------------------------------------------------------- the steps
  teach.steps.forEach((s, si) => {
    const step = si + 1;
    const math = (s.math ?? []).map((l) => l.trim()).filter(Boolean);
    const unwritable = unwritableWords(s.say);
    if (unwritable.length > 0) find(step, `Step ${step}'s words use ${unwritable.map(quote).join(", ")}, which the hand cannot write: say it in words, or put it in the maths.`);
    const worded = math.findIndex(hasWords);
    if (worded >= 0) return find(step, `Step ${step}, line ${worded + 1}: ${quote(math[worded])} has words in it. Words go in "say"; "math" is maths only.`, worded + 1);
    if (math.length > 0 && !canDraw(math)) return find(step, `Step ${step}: the hand cannot write one of its lines (${math.map(quote).join(", ")}); use plain LaTeX.`);
    if (math.length > 0 && continues(math[0])) find(step, `Step ${step}, line 1: ${quote(math[0])} starts with a relation but continues nothing: a step's maths starts with a whole line.`, 1);
    for (const c of chainsOf(math)) {
      for (const l of c.lines) wrote.add(normTex(l.text));
      const first = c.lines[0];
      if (c.parts.some((p) => !p)) {
        find(step, `Step ${step}, line ${first.n}: ${quote(c.lines.map((l) => l.text).join(" "))} has an empty side.`, first.n);
        continue;
      }
      if (c.parts.length === 1) {
        // an expression on its own states nothing to check
        last = { head: null, value: resolve(c.parts[0]) };
        continue;
      }
      const inequality = c.rels.some((r) => !EQUALS.has(r));
      if (c.lines.length === 1 && (inequality || isList(first.text))) {
        relationLine(first.text, step, first.n);
        continue;
      }
      if (c.lines.length > 1 || c.parts.length > 2) {
        if (inequality) {
          find(step, `Step ${step}, line ${first.n}: write each inequality as a whole line of its own, not as a chain.`, first.n);
          continue;
        }
        // an equation whose right side the chain works out (`2^{x+3} = 32`, `= 2^{5}`;
        // `c^{2} = a^{2} + b^{2}`, `= 6^{2} + 8^{2}`, …): the right side's links are checked equal, and
        // the equation, its side as worked out, goes in the column (`2^{x+3} = 2^{5}`, `c^{2} = 100`)
        const [a, b] = c.parts;
        if (isPlain(a) && !headOf(a, true) && !(isKnown(a) && isKnown(b)) && linkHolds(engine, resolve(a), resolve(b)) !== "ok") {
          chain({ parts: c.parts.slice(1), rels: c.rels.slice(1), at: c.at.slice(1), lines: c.lines }, step);
          relationLine(`${a} = ${c.parts[c.parts.length - 1]}`, step, first.n);
          continue;
        }
        chain(c, step);
        continue;
      }
      // one relation on one line: a value stated, a closed fact, an identity, or an equation to solve
      const [a, b] = c.parts;
      const h = headOf(a, true);
      const inColumn = h !== null && column.some((l) => namesOf(l.latex).has(h.name));
      if ((h && !inColumn) || (!h && isKnown(a) && isKnown(b))) {
        chain(c, step);
        continue;
      }
      if (!h && linkHolds(engine, resolve(a), resolve(b)) === "ok") {
        checked++;
        last = { head: null, value: resolve(b) };
        continue;
      }
      relationLine(first.text, step, first.n);
    }
  });

  // ---------------------------------------------------------------- what was taken as given, with every value found
  for (const g of givens) {
    const a = resolveFinal(g.a);
    const b = resolveFinal(g.b);
    if (namesOf(a).size > 0 || namesOf(b).size > 0) continue;
    if (linkHolds(engine, a, b) !== "mismatch") continue;
    const names = [...namesOf(`${g.a} ${g.b}`)];
    const uses = [...new Set(names.flatMap((n) => (facts.get(n) ? [facts.get(n)!] : [])))];
    const from = uses.length ? ` with ${uses.map((f) => `${quote(f.said)} (step ${f.step})`).join(" and ")}` : "";
    find(g.step, `Step ${g.step}, line ${g.line}: ${quote(`${g.a} = ${g.b}`)} does not hold${from}: the steps disagree.`, g.line);
  }
  // a value stated for a power or a function (`c^{2} = 100`) against its names' values (`c = 11`)
  for (const [head, k] of claims) {
    const a = substitute(head, values());
    if (namesOf(a).size > 0 || namesOf(k.value).size > 0) continue;
    if (linkHolds(engine, a, k.value) !== "mismatch") continue;
    const uses = [...namesOf(head)].flatMap((n) => (facts.get(n) ? [facts.get(n)!] : []));
    find(k.step, `Step ${k.step} found ${quote(k.said)}, but ${uses.map((f) => `${quote(f.said)} (step ${f.step})`).join(" and ")} disagrees: the steps disagree.`);
  }

  // ---------------------------------------------------------------- the answer
  let answerValue: string | null = null;
  const answer = teach.answer?.trim();
  if (answer) {
    if (hasWords(answer)) find(0, `The answer ${quote(answer)} has words in it: maths only.`);
    else if (!canDraw([answer])) find(0, `The hand cannot write the answer ${quote(answer)}.`);
    else {
      const res = checkAnswer(engine, answer, { resolve: resolveFinal, wrote, column: column.map((c) => c.latex), last });
      answerValue = res.value;
      if (res.problem) find(0, res.problem);
    }
  }

  if (findings.length > 0) return { ok: false, findings, problems: findings.slice(0, TEACH_CHECK.maxProblems).map((f) => f.problem) };
  const found: Record<string, string> = {};
  for (const [k, v] of facts) found[k] = v.value;
  for (const [k, v] of claims) found[k] = v.value;
  return { ok: true, checked, found, answerValue };
}

/** A closed relation (every name given a value), judged by the engine: `2(6) = 12`, `(6) + (4) = 10`. */
function linkHoldsRelation(engine: LiveEngine, latex: string): Link {
  const { parts, rels } = splitRelations(latex);
  if (parts.length === 2 && rels[0] === "=") return linkHolds(engine, parts[0], parts[1]);
  const v = verdictOf(engine, latex);
  return v === "ok" ? "ok" : v === "mismatch" ? "mismatch" : "unknown";
}

/**
 * What a column's equations solve to, as the engine solves them (`localSolve`, Solve's own path):
 * every `x = <number>` among its steps (and its lines), the last one for each letter.
 */
export function solveValues(engine: LiveEngine, equations: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (equations.length === 0) return out;
  const take = (line: string) => {
    if (isList(line)) return;
    const { parts, rels } = splitRelations(line);
    if (parts.length !== 2 || rels[0] !== "=") return;
    const h = headOf(parts[0]);
    if (!h || h.power || h.call || namesOf(parts[1]).size > 0 || !parts[1]) return;
    out.set(h.name, parts[1]);
  };
  for (const l of equations) take(l);
  try {
    const solved = localSolve(engine, [...equations]);
    for (const l of solved.steps) take(l);
  } catch {
    // nothing solved: nothing known
  }
  return out;
}

/** A list's items at the top level (`x = 2, \ x = 3` → `x = 2`, `x = 3`). */
function listItems(latex: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      out.push(latex.slice(from, i));
      from = i + 1;
    }
  }
  out.push(latex.slice(from));
  return out.map((s) => s.replace(/^\s*(?:\\[ ,;:!]|\\quad|\\qquad|~|\s)*/, "").trim()).filter(Boolean);
}

/** The answer against the working: a line it wrote, the value it found, or its names' values. */
function checkAnswer(
  engine: LiveEngine,
  answer: string,
  ctx: { resolve: (p: string) => string; wrote: ReadonlySet<string>; column: readonly string[]; last: { head: string | null; value: string } | null },
): { value: string | null; problem: string | null } {
  const { parts, rels } = splitRelations(answer);
  const list = isList(answer) && !tupleParts(parts[parts.length - 1] ?? "");
  const value = list ? answer : parts[parts.length - 1];
  const found = ctx.last ? `${ctx.last.head ? `${ctx.last.head.trim()} = ` : ""}${ctx.last.value}` : "";
  const disagrees = `The answer ${quote(answer)} does not match the working${found ? `, which found ${quote(found)}` : ""}.`;
  const ok = { value, problem: null };
  // a line of the working (or what a chain found), written again
  if (ctx.wrote.has(normTex(answer))) return ok;
  /** the column of equations ticks it as its next line */
  const columnTicks = (): LineAnalysis["verdict"] | undefined => {
    if (ctx.column.length === 0) return undefined;
    try {
      const a = analyzeColumn(engine, [...ctx.column, answer], "answer").pop();
      // one branch of a factored equation (`x = 2` under `(x - 2)(x - 3) = 0`) is right as a step,
      // but an answer with a root missing is not the answer
      return a?.branch && !a.solved ? "mismatch" : a?.verdict;
    } catch {
      return undefined;
    }
  };
  /** every part, with the values found put in, equal */
  const closedHolds = (latex: string): Link => {
    const sp = splitRelations(latex);
    if (sp.parts.length < 2 || sp.rels.some((r) => !EQUALS.has(r))) return "unknown";
    const resolved = sp.parts.map(ctx.resolve);
    if (resolved.some((p) => namesOf(p).size > 0)) return "unknown";
    for (let k = 0; k + 1 < resolved.length; k++) {
      const v = linkHolds(engine, resolved[k], resolved[k + 1]);
      if (v !== "ok") return v;
    }
    return "ok";
  };
  if (list) {
    const items = listItems(answer);
    if (items.length > 1 && items.every((it) => closedHolds(it) === "ok")) return ok;
    return columnTicks() === "ok" ? ok : { value, problem: disagrees };
  }
  if (rels.some((r) => !EQUALS.has(r))) return columnTicks() === "ok" ? ok : { value, problem: disagrees };
  // a bare value: the working's last value
  if (parts.length === 1) {
    if (!ctx.last) return { value, problem: `The answer ${quote(answer)} is not something the working found.` };
    return linkHolds(engine, ctx.resolve(answer), ctx.last.value) === "ok" ? ok : { value, problem: disagrees };
  }
  const closed = closedHolds(answer);
  if (closed === "ok") return ok;
  if (closed === "mismatch") return { value, problem: disagrees };
  // an equation's solution: the column ticks it
  const v = columnTicks();
  if (v === "ok") return ok;
  if (v === "mismatch") return { value, problem: disagrees };
  const open = parts.map(ctx.resolve).find((p) => namesOf(p).size > 0);
  return open ? { value, problem: `The answer ${quote(answer)} uses ${[...namesOf(open)].map(quote).join(", ")}, which the working never finds.` } : { value, problem: disagrees };
}

// ------------------------------------------------------------------ the hand

/** Every line writable by the hand (no glyph missing). */
export function handCanWrite(lines: readonly string[]): boolean {
  try {
    return layoutSteps(lines, { size: TEACH_CHECK.handSize, seed: 1 }).unsupported.length === 0;
  } catch {
    return false;
  }
}

/** Symbols in a sentence the hand has no glyph for (it would leave them out). Decoration is not counted. */
export function unwritableWords(text: string): string[] {
  const out = new Set<string>();
  for (const ch of text.normalize("NFC")) {
    if (/\s/.test(ch) || /[•◦‣*_­]/.test(ch)) continue;
    if (normaliseWords(ch) === "") out.add(ch);
  }
  return [...out];
}
