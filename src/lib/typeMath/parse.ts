/**
 * Plain typing ↔ the LaTeX the board speaks (docs/TYPE-MATH.md). Pure: no DOM, no tldraw, no
 * dependencies. Loaded with the bar only, never with the board, and cheap enough for every keystroke.
 *
 * A typed line must behave exactly like a line the pen wrote and Mathpix read, so what comes out is
 * the LaTeX the engine is tested on (`src/__eval__/corpus.ts`, `chat/problemForms.ts`) and the hand
 * writes (`src/lib/hand/__tests__/coverage.test.ts`): `2x + 3 = 11` (spaces round signs), `\frac{1}{2}`,
 * `2\frac{1}{2}` (a mixed number: the engine's own rule, `parseFrac` in engine/latex.ts), `\times`,
 * `\div`, `x^{2}`, `\sqrt{x + 1}`, `\sqrt[3]{8}`, `|x - 3|`, `30^{\circ}`, `\$4.50`, `25\%`, `1{,}000`,
 * `3 R 2` (a remainder, `primaryWork.ts`), `\square` (a blank, `blanks.ts`), and `\le`, `\ge`,
 * `\neq` — what the engine writes itself, and the only spelling of ≠ `operationLine.ts` knows.
 * `\left( \right)` only round a fraction, as Mathpix writes them: the hand stretches those brackets.
 *
 * How a kid's typing is read (calculator-like, and shown live in the bar's preview, so a surprise
 * is seen before Enter):
 *  - `/` makes a fraction. Its top is the term just before it (`3x/4`, `2(x+1)/3`: a product's
 *    value is the same either way), back to the last space (`2 x/3` is 2 · x/3); its bottom is the
 *    ONE thing just after it: `1/2x` is ½x (`1/2x + 3 = 7`, how a class writes half of x) —
 *    `1/(2x)` for the other. Brackets round a whole top or bottom go (`(x+1)/(x-1)`).
 *  - A whole number, a space, a proper fraction is a mixed number: `2 1/2`, `2½`. `2 5/4` is
 *    refused; two numbers with only a space between them (`2 3`, `1 000`) are refused.
 *  - `x` between two numbers is ×, `3x4`, `3 x 4`, but only on a line with no other letter: one
 *    letter anywhere and every x is a letter (`3x+4=10`, `2x^2`, and `3x4y` is refused: x4).
 *    A letter right before a number is refused with "Use ^ for a power" (`x2`): we write 2x.
 *  - `^` takes one thing too: `x^2y` is x²·y, `x^(n+1)`, `x^-3`, `2^10`. `√16`, `√x^2` (√ of x²),
 *    `√2x` is √2·x; `√(…)` / `sqrt(…)` hold the whole bracket. `sin 2x`, `ln x` take the term after
 *    them, as the engine reads `\sin 2x`.
 *  - `:` and `÷` are ÷; `*`, `·`, `×` are ×; `of` between two numbers is × (`25% of 80`);
 *    `R` between whole numbers at the end of a line is a remainder. `?` on a line of numbers is the
 *    worksheet's blank (`\square`, `7 × 8 = ?`); with a letter it stays `?` (`x = ?`, `AB = ?`:
 *    what is asked for, as courseKit.ts and coordinates.ts read it).
 *  - A line may start with `=` (`= 7`, an answer under the line above) and end with one (`36 + 2 =`,
 *    `2x + 5 =`: the board writes the answer after it). Starting with `÷` or `×` it is an operation
 *    under an equation (`÷2`, `÷2 ÷2`); `-3 -3` reads as written and the engine knows it.
 *  - Inside brackets a comma always separates (`(2,500)` is a point); outside, `1,000` is a number.
 *
 * LaTeX in the box (the readback editor, a teacher) is read too, and written back in the same
 * dialect. LaTeX this reader does not model (`\int`, units, `\begin…`) is passed through as typed;
 * the writer still checks the hand can write it (`layoutMath(…).unsupported`).
 */

import type { TypedParse } from "./contracts";

// ---------------------------------------------------------------- the maths, as a tree

type Rel = "=" | "<" | ">" | "le" | "ge" | "ne" | "approx";
type Op = "+" | "-" | "pm" | "times" | "div" | "rem";
type Fn = "sin" | "cos" | "tan" | "log" | "ln";

type N =
  | { t: "num"; s: string; money?: boolean }
  | { t: "var"; s: string; sub?: N }
  /** `blank` a worksheet's box (`\square`), `ask` a `?` (`x = ?`: the value asked for, courseKit.ts) */
  | { t: "sym"; s: "pi" | "theta" | "blank" | "ask" }
  | { t: "hole" }
  | { t: "group"; o: string; c: string; a: N }
  | { t: "abs"; a: N }
  | { t: "frac"; n: N; d: N }
  | { t: "mixed"; w: string; n: string; d: string; money?: boolean }
  | { t: "pow"; b: N; e: N }
  | { t: "post"; a: N; s: "%" | "!" | "deg" }
  | { t: "root"; a: N; cube?: boolean }
  | { t: "fn"; s: Fn; a: N; p?: N; base?: N }
  | { t: "sign"; s: "-" | "+" | "pm"; a: N }
  | { t: "prod"; f: N[]; gap: boolean[] }
  | { t: "bin"; op: Op; l: N; r: N }
  | { t: "rel"; sides: (N | null)[]; ops: Rel[] }
  | { t: "list"; items: N[]; seps: string[] }
  | { t: "opline"; items: { op: "times" | "div"; a: N }[] };

const HOLE: N = { t: "hole" };
/** brackets round a whole top, bottom, power or root go: `(x+1)/(x-1)` is \frac{x + 1}{x - 1} */
const bare = (n: N): N => (n.t === "group" && n.a.t !== "list" ? n.a : n);

// ---------------------------------------------------------------- tokens

type Kind = "num" | "let" | "word" | "op" | "rel" | "open" | "close" | "lb" | "rb" | "bar" | "sep" | "blank" | "frac" | "glyph" | "mixed";

interface Tok {
  k: Kind;
  /** what it is: digits, a letter, a word, an operator, a relation, a bracket */
  s: string;
  /** what the kid typed, for the hint ("Something goes after the ÷") */
  raw: string;
  /** a space before it: a mixed number's, or a fraction's top starting after it */
  sp: boolean;
  /** a mixed number or a ½ key */
  w?: string;
  n?: string;
  d?: string;
}

/** words the reader of LaTeX turns into marks the tokens read (`\text{ or }`, `\frac`) */
const OR = "";
const AND = "";
const OF = "";
const FRAC = "";

const SINGLE = new Map<string, [Kind, string, string?]>([
  ["+", ["op", "+"]], ["-", ["op", "-"]], ["−", ["op", "-"]], ["–", ["op", "-"]], ["—", ["op", "-"]],
  ["*", ["op", "times"]], ["×", ["op", "times"]], ["·", ["op", "times"]], ["⋅", ["op", "times"]], ["∙", ["op", "times"]],
  ["÷", ["op", "div"]], [":", ["op", "div"]], ["/", ["op", "/"]], ["^", ["op", "^"]], ["_", ["op", "_"]],
  ["!", ["op", "!"]], ["%", ["op", "%"]], ["°", ["op", "deg"]], ["$", ["op", "$"]], ["±", ["op", "pm"]],
  ["(", ["open", "("]], ["[", ["open", "["]], [")", ["close", ")"]], ["]", ["close", "]"]], ["{", ["lb", "{"]], ["}", ["rb", "}"]],
  ["|", ["bar", "|"]], [",", ["sep", ","]], ["?", ["blank", "?"]], ["□", ["blank", "□"]],
  ["√", ["word", "sqrt"]], ["∛", ["word", "cbrt"]], ["π", ["word", "pi"]], ["θ", ["word", "theta"]],
  [OR, ["sep", "or", "or"]], [AND, ["sep", "and", "and"]], [OF, ["op", "times", "of"]], [FRAC, ["frac", "frac", "\\frac"]],
]);
/** longest first: `<=` before `<`, `!=` before the `!` of 5! */
const RELS: [string, Rel][] = [
  ["<=", "le"], ["=<", "le"], [">=", "ge"], ["=>", "ge"], ["!=", "ne"], ["==", "="],
  ["≤", "le"], ["≥", "ge"], ["≠", "ne"], ["≈", "approx"], ["=", "="], ["<", "<"], [">", ">"],
];
const GLYPHS = new Map<string, [string, string]>([["½", ["1", "2"]], ["¼", ["1", "4"]], ["¾", ["3", "4"]], ["⅓", ["1", "3"]], ["⅔", ["2", "3"]]]);
const THOUSANDS = /^\d{1,3}(?:,\d{3})+(?!\d)(?:\.\d+)?/;
const WHOLE = /^[1-9][\d,]*$/;
const DIGITS = /^\d+$/;

/** the words a run of letters may hold, longest first: `2pir` is 2πr, `sinx` is sin x (Desmos does the same) */
const WORDS = ["theta", "sqrt", "cbrt", "sin", "cos", "tan", "log", "abs", "ln", "pi"];
/** only ever a whole run: `of` is not the o·f of `prof` */
const WHOLE_WORDS = new Set(["of", "or", "and", "deg"]);
const FNS = new Set(["sin", "cos", "tan", "log", "ln", "sqrt", "cbrt", "abs"]);
/** functions the engine knows that this reader does not: LaTeX holding one is passed through */
const ENGINE_ONLY = /^(?:sec|csc|cot|arcsin|arccos|arctan|asin|acos|atan|sinh|cosh|tanh|coth|lg|exp|max|min|gcd|lcm|floor|ceil|round|mean|median|std|norm|dot|det|to|or|and|deg)$/;

/** A run of letters as words and single letters; null for a word the engine reads that this does not. */
function letters(run: string, tex: boolean): string[] | null {
  if (tex) {
    // the engine's rule: a function only as a whole run (`\sin x`), every other run single letters
    if (FNS.has(run) || run === "of") return [run];
    return ENGINE_ONLY.test(run) ? null : run.split("");
  }
  if (WHOLE_WORDS.has(run)) return [run];
  const out: string[] = [];
  for (let i = 0; i < run.length; ) {
    const w = WORDS.find((x) => run.startsWith(x, i));
    out.push(w ?? run[i]);
    i += w ? w.length : 1;
  }
  return out;
}

/** What went wrong: a hint for the kid, or LaTeX this reader does not model (kept as typed). */
class Trouble {
  hint = "";
  unknown = false;
  fail(hint: string): void {
    if (!this.hint) this.hint = hint;
  }
}

const named = (raw: string) => (/^[a-z]+$/i.test(raw) ? raw : `the ${raw}`);

function tokenize(src: string, tex: boolean, why: Trouble): Tok[] {
  const toks: Tok[] = [];
  let sp = false;
  let depth = 0;
  const push = (k: Kind, s: string, raw: string, more?: Partial<Tok>) => {
    toks.push({ k, s, raw, sp, ...more });
    sp = false;
  };
  for (let i = 0; i < src.length; ) {
    const c = String.fromCodePoint(src.codePointAt(i)!);
    if (c === " ") {
      sp = true;
      i++;
      continue;
    }
    if (/[\d.]/.test(c)) {
      const rest = src.slice(i);
      // `1,000`: thousands outside brackets (inside them a comma separates); LaTeX as the engine reads it, everywhere
      const s = ((depth === 0 || tex) && THOUSANDS.exec(rest)) || /^\d*\.?\d*/.exec(rest)!;
      if (s[0].endsWith(".")) why.fail("Something goes after the point");
      push("num", s[0], s[0]);
      i += s[0].length;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      const run = /^[a-zA-Z]+/.exec(src.slice(i))![0];
      const parts = letters(run, tex);
      if (!parts) why.unknown = true;
      for (const p of parts ?? []) {
        if (p.length === 1) push("let", p, p);
        else if (p === "of") push("op", "times", p);
        else if (p === "or" || p === "and") push("sep", p, p);
        else push("word", p, p);
      }
      i += run.length;
      continue;
    }
    const rel = RELS.find(([r]) => src.startsWith(r, i));
    if (rel) {
      push("rel", rel[1], rel[0]);
      i += rel[0].length;
      continue;
    }
    i += c.length;
    if (c === "²" || c === "³") {
      push("op", "^", c);
      push("num", c === "²" ? "2" : "3", c);
      continue;
    }
    const glyph = GLYPHS.get(c);
    if (glyph) {
      push("glyph", "", c, { n: glyph[0], d: glyph[1] });
      continue;
    }
    const one = SINGLE.get(c);
    if (one) {
      if (one[0] === "open" || one[0] === "lb") depth++;
      if (one[0] === "close" || one[0] === "rb") depth = Math.max(0, depth - 1);
      push(one[0], one[1], one[2] ?? c);
      continue;
    }
    if (tex) why.unknown = true;
    else why.fail(`Take out the ${c}`);
  }
  return toks;
}

/** What is only seen across tokens: mixed numbers, a remainder, x as times, a letter before a number. */
function tidy(toks: Tok[], tex: boolean, why: Trouble): Tok[] {
  for (let i = 1; i < toks.length; i++) {
    const a = toks[i - 1];
    const b = toks[i];
    const before = toks[i - 2];
    // a whole number that is not an exponent, a subscript or a fraction's bottom
    const free = a.k === "num" && WHOLE.test(a.s) && !(before?.k === "op" && (before.s === "^" || before.s === "_" || before.s === "/"));
    if (b.k === "glyph" && free) {
      toks.splice(i - 1, 2, { k: "mixed", s: "", raw: a.raw + b.raw, sp: a.sp, w: a.s, n: b.n, d: b.d });
      i--;
      continue;
    }
    if (b.k !== "num" || a.k !== "num" || !b.sp) continue;
    const slash = toks[i + 1];
    const d = toks[i + 2];
    const after = toks[i + 3];
    if (free && DIGITS.test(b.s) && slash?.k === "op" && slash.s === "/" && d?.k === "num" && DIGITS.test(d.s) && !(after?.k === "op" && after.s === "^")) {
      // `2 1/2`: the engine reads 2\frac{1}{2} as a mixed number only when its fraction is proper
      if (!(Number(b.s) > 0 && Number(b.s) < Number(d.s))) why.fail("The fraction in a mixed number is less than 1");
      toks.splice(i - 1, 4, { k: "mixed", s: "", raw: `${a.s} ${b.s}/${d.s}`, sp: a.sp, w: a.s, n: b.s, d: d.s });
      i--;
      continue;
    }
    if (free && DIGITS.test(b.s) && slash?.k === "op" && slash.s === "/" && !d) {
      // `2 1/`: a mixed number still being typed (the preview shows its empty bottom)
      why.fail("Something goes after the /");
      toks.splice(i - 1, 3, { k: "mixed", s: "", raw: `${a.s} ${b.s}/`, sp: a.sp, w: a.s, n: b.s, d: "\\square" });
      break;
    }
    why.fail("Two numbers need a sign between them");
  }

  // `3 R 2`, `17 ÷ 5 = 3 R 2`: a remainder (the young judge reads it there, at the end of the line)
  const n = toks.length;
  const r = toks[n - 2];
  if (n >= 3 && r.k === "let" && (r.s === "R" || r.s === "r") && toks[n - 3].k === "num" && DIGITS.test(toks[n - 3].s) && toks[n - 1].k === "num" && DIGITS.test(toks[n - 1].s)) {
    const lead = toks[n - 4];
    if (!lead || (lead.k === "rel" && lead.s === "=")) toks[n - 2] = { ...r, k: "op", s: "rem" };
  }
  if (tex) return toks; // LaTeX: the engine's own rule for x ran on the string (`engineTimes`), and `x2` is x·2 to it

  // `x = ?` asks for x (courseKit.ts, coordinates.ts read the `?`); on a line of numbers a `?` is the
  // worksheet's blank, the board's own `\square` (`7 × 8 = ?`: Solve writes 56 in it, blanks.ts)
  if (!toks.some((t) => t.k === "let")) for (const t of toks) if (t.k === "blank") t.s = "□";

  // `3x4`, `3 x 4`: x is the times sign when it sits between numbers and the line has no other letter
  const lets = toks.filter((t) => t.k === "let");
  if (lets.length && lets.every((t) => t.s === "x" || t.s === "X") && toks.every((t, i) => t.k !== "let" || (toks[i - 1]?.k === "num" && toks[i + 1]?.k === "num"))) {
    for (const t of lets) Object.assign(t, { k: "op", s: "times" });
  }
  // `x2`: a power without its ^ (or a times without its ×); on paper the number comes first
  for (let i = 0; i + 1 < toks.length; i++) {
    if (toks[i].k === "let" && toks[i + 1].k === "num") why.fail(`Use ^ for a power: ${toks[i].s}^${toks[i + 1].s}`);
  }
  return toks;
}

// ---------------------------------------------------------------- LaTeX in, as the tokens read it

const COMMANDS = new Map<string, string>([
  ["frac", FRAC], ["dfrac", FRAC], ["tfrac", FRAC], ["cfrac", FRAC],
  ["times", "×"], ["cdot", "×"], ["ast", "×"], ["div", "÷"], ["pm", "±"],
  ["le", "≤"], ["leq", "≤"], ["leqslant", "≤"], ["ge", "≥"], ["geq", "≥"], ["geqslant", "≥"],
  ["ne", "≠"], ["neq", "≠"], ["approx", "≈"], ["lt", "<"], ["gt", ">"],
  ["pi", "π"], ["theta", "θ"], ["square", "□"], ["Box", "□"], ["lvert", "|"], ["rvert", "|"], ["vert", "|"],
  ["sin", " sin "], ["cos", " cos "], ["tan", " tan "], ["log", " log "], ["ln", " ln "],
  ["quad", " "], ["qquad", " "], ["displaystyle", " "], ["textstyle", " "],
]);
const ESCAPES = new Map<string, string>([["%", "%"], ["$", "$"], [",", " "], [";", " "], [":", " "], ["!", " "], [" ", " "]]);
const DELIMS = new Map<string, string>([["(", "("], [")", ")"], ["[", "["], ["]", "]"], ["|", "|"], ["\\lvert", "|"], ["\\rvert", "|"], ["\\vert", "|"]]);

/**
 * `2x2`, `3 x 4 = 12`: the engine reads the letter x as × when EVERY x on the line sits between two
 * numbers (`timesBetweenNumbers`, engine/latex.ts). A pen line is read here exactly as it was there.
 */
function engineTimes(s: string): string {
  if (!s.includes("x")) return s;
  const at: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      const cmd = /^\\[a-zA-Z]+/.exec(s.slice(i));
      i += cmd ? cmd[0].length - 1 : 1;
      continue;
    }
    if (s[i] !== "x") continue;
    let b = i - 1;
    while (s[b] === " ") b--;
    let a = i + 1;
    while (s[a] === " ") a++;
    if (!/\d/.test(s[b] ?? "") || !/\d/.test(s[a] ?? "")) return s;
    at.push(i);
  }
  return at.reduceRight((out, i) => `${out.slice(0, i)}×${out.slice(i + 1)}`, s);
}

/** LaTeX as the symbols the tokens read (`\le` → ≤, `\frac` → its mark), or `unknown` when it holds anything else. */
function untex(src: string, why: Trouble): string {
  const no = () => {
    why.unknown = true;
    return " ";
  };
  return engineTimes(src)
    .replace(/^\\boxed\s*\{([\s\S]*)\}$/, "$1")
    .replace(/\{,\}/g, ",")
    .replace(/~/g, " ")
    .replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ(?![a-zA-Z])|\\degree(?![a-zA-Z])/g, "°")
    .replace(/\\(?:text|mathrm|textrm|operatorname|mbox|mathit)\s*\{([^{}]*)\}/g, (_m, inner: string) => {
      const w = inner.replace(/\\[,;:! ]/g, " ").trim();
      if (w === "or") return ` ${OR} `;
      if (w === "and") return ` ${AND} `;
      if (w === "of") return ` ${OF} `;
      if (!w || /^[a-zA-Z]$/.test(w) || FNS.has(w)) return ` ${w} `;
      return no();
    })
    .replace(/\\sqrt\s*(?:\[([^\]]*)\])?\s*(\{)?/g, (_m, k: string | undefined, brace: string | undefined) => {
      // `\sqrt x` (no braces) the engine reads greedily; rare from Mathpix, so kept as written
      if (!brace || (k !== undefined && k.trim() !== "3")) return no();
      return k === undefined ? "√{" : "∛{";
    })
    .replace(/\\(?:left|right)\s*(\\[a-zA-Z]+|\\.|[^\s\\]?)/g, (_m, d: string) => DELIMS.get(d) ?? no())
    .replace(/\\([a-zA-Z]+)|\\([\s\S]?)/g, (_m, name: string | undefined, ch: string | undefined) => {
      if (name !== undefined) return COMMANDS.get(name) ?? no();
      const esc = ESCAPES.get(ch ?? "");
      if (esc === undefined) why.fail("Take out the \\");
      return esc ?? " ";
    });
}

// ---------------------------------------------------------------- reading

class Reader {
  private i = 0;
  /** bars open round the cursor: a `|` after something closes the innermost */
  private abs = 0;
  /** the sign, bracket or word just read: "Something goes after the +" */
  private last: string | null = null;

  constructor(
    private readonly toks: Tok[],
    private readonly why: Trouble,
  ) {}

  private peek(ahead = 0): Tok | undefined {
    return this.toks[this.i + ahead];
  }

  private is(k: Kind, ahead = 0): boolean {
    return this.peek(ahead)?.k === k;
  }

  private isOp(...s: string[]): boolean {
    const t = this.peek();
    return t?.k === "op" && s.includes(t.s);
  }

  private next(): Tok {
    const t = this.toks[this.i++];
    this.last = t.k === "op" || t.k === "rel" || t.k === "sep" || t.k === "open" || t.k === "lb" || t.k === "bar" || t.k === "word" ? t.raw : null;
    return t;
  }

  line(): N {
    // `÷2`, `÷2 ÷2`, `×3`: what is done to both sides of the equation above (engine/operationLine.ts)
    const node = this.isOp("times", "div", "/") ? this.opline() : this.clauses();
    const t = this.peek();
    if (t) {
      if (t.k === "close" || t.k === "rb") this.why.fail(`There's a ${t.raw} with no ${t.raw === "]" ? "[" : t.raw === "}" ? "{" : "("} before it`);
      else if (t.k === "op" && t.s === "_") this.why.fail("Take out the _");
      else this.why.fail(`Something goes before ${named(t.raw)}`);
    }
    return node;
  }

  private opline(): N {
    const items: { op: "times" | "div"; a: N }[] = [];
    while (this.isOp("times", "div", "/")) items.push({ op: this.next().s === "times" ? "times" : "div", a: this.unary() });
    return { t: "opline", items };
  }

  private clauses(): N {
    const items = [this.clause()];
    const seps: string[] = [];
    while (this.is("sep")) {
      seps.push(this.next().s);
      items.push(this.clause());
    }
    return items.length === 1 ? items[0] : { t: "list", items, seps };
  }

  private endOfClause(): boolean {
    const t = this.peek();
    return !t || t.k === "sep" || t.k === "close" || t.k === "rb" || (t.k === "bar" && this.abs > 0);
  }

  /** `3 + 4 = 7 = 7`, `x ≤ 5`, `= 7` (an answer under the line above), `36 + 2 =` (asking for one) */
  private clause(): N {
    const sides: (N | null)[] = [];
    const ops: Rel[] = [];
    const lead = this.peek();
    if (lead?.k === "rel") {
      if (lead.s !== "=") this.why.fail(`Something goes before the ${lead.raw}`);
      sides.push(null);
    } else sides.push(this.sum());
    while (this.is("rel")) {
      const r = this.next();
      ops.push(r.s as Rel);
      if (this.endOfClause() || this.is("rel")) {
        // only `=` may end a line, and never alone
        if (r.s !== "=" || sides[sides.length - 1] === null || this.is("rel")) this.why.fail(`Something goes after the ${r.raw}`);
        sides.push(this.is("rel") ? HOLE : null);
      } else sides.push(this.sum());
    }
    return ops.length ? { t: "rel", sides, ops } : (sides[0] ?? HOLE);
  }

  private sum(): N {
    let l = this.term();
    while (this.isOp("+", "-", "pm", "rem")) {
      const op = this.next().s as Op;
      l = { t: "bin", op, l, r: this.term() };
    }
    return l;
  }

  private term(): N {
    let l = this.unary();
    while (this.isOp("times", "div")) {
      const op = this.next().s as Op;
      l = { t: "bin", op, l, r: this.unary() };
    }
    return l;
  }

  private unary(): N {
    if (!this.isOp("-", "+", "pm")) return this.product();
    const s = this.next().s as "-" | "+" | "pm";
    return { t: "sign", s, a: this.unary() };
  }

  /** what can start a factor; inside |…|, a bar after something closes it */
  private startsFactor(more: boolean): boolean {
    const t = this.peek();
    if (!t) return false;
    switch (t.k) {
      case "num":
      case "let":
      case "blank":
      case "frac":
      case "glyph":
      case "mixed":
      case "open":
      case "lb":
        return true;
      case "word":
        return t.s !== "deg";
      case "bar":
        return !(more && this.abs > 0);
      case "op":
        return t.s === "$";
      default:
        return false;
    }
  }

  /** `3x`, `2(x+1)`, `(x+1)(x-2)`, `2πr` side by side, and `/` among them (see the file comment) */
  private product(): N {
    const f: N[] = [];
    const gap: boolean[] = [];
    let run = 0;
    while (this.startsFactor(f.length > 0)) {
      const spaced = f.length > 0 && this.peek()!.sp;
      if (spaced) run = f.length;
      const x = this.power();
      const prev = f[f.length - 1];
      if (x.t === "frac" && prev?.t === "num" && mixedParts(prev, x)) {
        // `2\frac{1}{2}`: one mixed number, as the engine reads it
        f[f.length - 1] = { t: "mixed", w: prev.s, ...mixedParts(prev, x)!, ...(prev.money ? { money: true } : {}) };
      } else {
        f.push(x);
        gap.push(spaced);
      }
      while (this.isOp("/")) {
        this.next();
        const top = f.splice(run);
        const topGap = gap.splice(run);
        const n: N = top.length === 1 ? top[0] : { t: "prod", f: top, gap: [false, ...topGap.slice(1)] };
        f.push({ t: "frac", n: bare(n), d: bare(this.fracOperand()) });
        gap.push(topGap[0] ?? false);
        run = f.length - 1;
      }
    }
    if (!f.length) return this.missing();
    return f.length === 1 ? f[0] : { t: "prod", f, gap };
  }

  private fracOperand(): N {
    if (this.isOp("-", "+")) {
      const s = this.next().s as "-" | "+";
      return { t: "sign", s, a: this.fracOperand() };
    }
    return this.startsFactor(false) ? this.power() : this.missing();
  }

  private power(): N {
    let b = this.postfix(this.primary());
    if (this.isOp("^")) {
      this.next();
      b = this.postfix({ t: "pow", b, e: this.exponent() });
    }
    return b;
  }

  /** `x^2`, `x^-3`, `x^(n+1)`, `2^3^2` (2 to the 9th) */
  private exponent(): N {
    if (this.isOp("-", "+")) {
      const s = this.next().s as "-" | "+";
      return { t: "sign", s, a: this.exponent() };
    }
    return this.startsFactor(false) ? bare(this.power()) : this.missing();
  }

  private postfix(a: N): N {
    for (;;) {
      const t = this.peek();
      if (t?.k === "op" && (t.s === "!" || t.s === "%" || t.s === "deg")) {
        this.next();
        a = { t: "post", a, s: t.s === "deg" ? "deg" : (t.s as "!" | "%") };
      } else if (t?.k === "word" && t.s === "deg") {
        this.next();
        a = { t: "post", a, s: "deg" };
      } else return a;
    }
  }

  private primary(): N {
    const t = this.next();
    switch (t.k) {
      case "num":
        return { t: "num", s: t.s };
      case "mixed":
        return { t: "mixed", w: t.w!, n: t.n!, d: t.d! };
      case "glyph":
        return { t: "frac", n: { t: "num", s: t.n! }, d: { t: "num", s: t.d! } };
      case "blank":
        return { t: "sym", s: t.s === "?" ? "ask" : "blank" };
      case "let":
        if (!this.isOp("_")) return { t: "var", s: t.s };
        this.next();
        return { t: "var", s: t.s, sub: this.script() };
      case "open":
      case "lb":
        return this.group(t);
      case "bar":
        return this.bars();
      case "frac":
        return { t: "frac", n: this.braced(), d: this.braced() };
      case "word":
        return this.word(t);
      case "op": {
        // `$4.50`, `$2 1/2`
        if (this.is("num") || this.is("mixed")) return { ...(this.primary() as N & { t: "num" }), money: true };
        this.why.fail("A number goes after the $");
        return HOLE;
      }
      default:
        return HOLE;
    }
  }

  /** `x_1`, `x_{12}`, `log_2`, `a_(n+1)` */
  private script(): N {
    const t = this.peek();
    if (t?.k === "num" || t?.k === "let") {
      this.next();
      return t.k === "num" ? { t: "num", s: t.s } : { t: "var", s: t.s };
    }
    return t?.k === "open" || t?.k === "lb" ? bare(this.group(this.next())) : this.missing();
  }

  private group(open: Tok): N {
    const brace = open.k === "lb";
    const shut = () => this.is(brace ? "rb" : "close");
    const saved = this.abs;
    this.abs = 0;
    let a: N = HOLE;
    if (shut()) this.why.fail("Something goes in the brackets");
    else a = this.clauses();
    this.abs = saved;
    // `[1, 4)`: an interval closes with the other bracket
    let c = open.s === "[" ? "]" : ")";
    if (shut()) {
      const t = this.next();
      if (!brace) c = t.s;
    } else this.why.fail(brace ? "Close the {" : "Close the bracket");
    return { t: "group", o: brace ? "(" : open.s, c, a };
  }

  private bars(): N {
    this.abs++;
    const a = this.sum();
    this.abs--;
    if (this.is("bar")) this.next();
    else this.why.fail("Close the | bar");
    return { t: "abs", a };
  }

  /** `\frac`'s two arguments */
  private braced(): N {
    if (!this.is("lb")) {
      this.why.unknown = true;
      return HOLE;
    }
    return bare(this.group(this.next()));
  }

  private word(t: Tok): N {
    if (t.s === "pi" || t.s === "theta") return { t: "sym", s: t.s };
    const call = this.is("open") || this.is("lb");
    const arg = () => (call ? bare(this.group(this.next())) : this.rootOperand());
    if (t.s === "sqrt") return { t: "root", a: arg() };
    if (t.s === "cbrt") return { t: "root", a: arg(), cube: true };
    if (t.s === "abs") return { t: "abs", a: arg() };
    return this.fn(t);
  }

  /** `√16`, `√x^2` (all of x²), `√-4`: the one thing after it, with its power */
  private rootOperand(): N {
    if (this.isOp("-", "+")) {
      const s = this.next().s as "-" | "+";
      return { t: "sign", s, a: this.rootOperand() };
    }
    return this.startsFactor(false) ? bare(this.power()) : this.missing();
  }

  /** `sin(30°)`, `sin 2x`, `sin^2(x)`, `log_2(8)`, `log2(8)`, `ln|x|` */
  private fn(t: Tok): N {
    let base: N | undefined;
    let p: N | undefined;
    if (this.isOp("_")) {
      this.next();
      base = this.script();
    } else if (t.s === "log" && this.is("num") && !this.peek()!.sp && this.is("open", 1)) base = this.primary();
    if (this.isOp("^")) {
      this.next();
      p = this.exponent();
    }
    let a: N;
    if (this.is("open") || this.is("lb")) a = bare(this.group(this.next()));
    else if (this.is("bar")) a = this.power();
    else if (this.startsArg()) a = this.implicitArg();
    else {
      this.why.fail(`Something goes after ${named(t.raw)}`);
      a = HOLE;
    }
    return { t: "fn", s: t.s as Fn, a, ...(p ? { p } : {}), ...(base ? { base } : {}) };
  }

  /** the engine's `startsAtom`: what a function takes with no bracket (never a bracket or another function) */
  private startsArg(): boolean {
    const t = this.peek();
    return !!t && (t.k === "num" || t.k === "let" || t.k === "glyph" || t.k === "frac" || t.k === "lb" || (t.k === "word" && (t.s === "pi" || t.s === "theta" || t.s === "sqrt" || t.s === "cbrt")));
  }

  private implicitArg(): N {
    const f: N[] = [];
    const gap: boolean[] = [];
    while (this.startsArg()) {
      gap.push(f.length > 0 && this.peek()!.sp);
      f.push(this.power());
    }
    return f.length === 1 ? f[0] : { t: "prod", f, gap };
  }

  private missing(): N {
    const t = this.peek();
    const after = this.last;
    const closer = t?.k === "close" || t?.k === "rb";
    let hint: string;
    if (after === "|") hint = "Something goes between the | bars";
    else if (after === "(" || after === "[" || after === "{") hint = !t ? "Close the bracket" : closer ? "Something goes in the brackets" : `Something goes before ${named(t.raw)}`;
    else if (after === "$") hint = "A number goes after the $";
    else if (after) hint = `Something goes after ${named(after)}`;
    else if (t && closer) hint = `There's a ${t.raw} with no ${t.raw === "]" ? "[" : t.raw === "}" ? "{" : "("} before it`;
    else hint = t ? `Something goes before ${named(t.raw)}` : "Something's missing";
    this.why.fail(hint);
    return HOLE;
  }
}

/** `2\frac{1}{2}`: the engine's mixed number — a whole number before a proper fraction of whole numbers */
function mixedParts(whole: { s: string }, x: { n: N; d: N }): { n: string; d: string } | null {
  if (!WHOLE.test(whole.s) || x.n.t !== "num" || x.d.t !== "num" || !DIGITS.test(x.n.s) || !DIGITS.test(x.d.s)) return null;
  const top = Number(x.n.s);
  return top > 0 && top < Number(x.d.s) ? { n: x.n.s, d: x.d.s } : null;
}

function read(src: string, tex: boolean): { node: N; why: Trouble } {
  const why = new Trouble();
  const s = tex ? untex(src, why) : src;
  if (why.unknown) return { node: HOLE, why };
  const toks = tidy(tokenize(s, tex, why), tex, why);
  return { node: why.unknown ? HOLE : new Reader(toks, why).line(), why };
}

// ---------------------------------------------------------------- writing LaTeX

const REL_TEX: Record<Rel, string> = { "=": "=", "<": "<", ">": ">", le: "\\le", ge: "\\ge", ne: "\\neq", approx: "\\approx" };
const OP_TEX: Record<Op, string> = { "+": "+", "-": "-", pm: "\\pm", times: "\\times", div: "\\div", rem: "R" };
const SEP_TEX: Record<string, string> = { ",": ", ", or: " \\text{ or } ", and: " \\text{ and } " };

/** A fraction inside: its brackets are written `\left( \right)` so the hand draws them tall. */
function tall(n: N): boolean {
  switch (n.t) {
    case "frac":
    case "mixed":
      return true;
    case "group":
    case "abs":
    case "root":
    case "sign":
    case "post":
    case "fn":
      return tall(n.a);
    case "pow":
      return tall(n.b);
    case "prod":
      return n.f.some(tall);
    case "bin":
      return tall(n.l) || tall(n.r);
    case "rel":
      return n.sides.some((s) => s !== null && tall(s));
    case "list":
      return n.items.some(tall);
    default:
      return false;
  }
}

/** the letters a written piece starts with */
const lead = (s: string) => /^[a-zA-Z]+/.exec(s)?.[0] ?? "";
const fence = (o: string, body: string, c: string, big: boolean) => (big ? `\\left${o}${body}\\right${c}` : `${o}${body}${c}`);
/** a superscript's base: `{x^{2}}^{\circ}`, never a double superscript */
const base = (n: N) => (n.t === "pow" || (n.t === "post" && n.s === "deg") ? `{${tex(n)}}` : tex(n));

function tex(n: N): string {
  switch (n.t) {
    case "num":
      return (n.money ? "\\$" : "") + n.s.replace(/,/g, "{,}");
    case "var":
      return n.s + (n.sub ? `_{${tex(n.sub)}}` : "");
    case "sym":
      return n.s === "blank" ? "\\square" : n.s === "ask" ? "?" : `\\${n.s}`;
    case "hole":
      return "\\square";
    case "group":
      return fence(n.o, tex(n.a), n.c, tall(n.a));
    case "abs":
      return fence("|", tex(n.a), "|", tall(n.a));
    case "frac":
      return `\\frac{${tex(n.n)}}{${tex(n.d)}}`;
    case "mixed":
      return `${n.money ? "\\$" : ""}${n.w.replace(/,/g, "{,}")}\\frac{${n.n}}{${n.d}}`;
    case "pow":
      return `${base(n.b)}^{${tex(n.e)}}`;
    case "post":
      return n.s === "deg" ? `${base(n.a)}^{\\circ}` : tex(n.a) + (n.s === "%" ? "\\%" : "!");
    case "root":
      return `\\sqrt${n.cube ? "[3]" : ""}{${tex(n.a)}}`;
    case "fn":
      return `\\${n.s}${n.base ? `_{${tex(n.base)}}` : ""}${n.p ? `^{${tex(n.p)}}` : ""}${fence("(", tex(n.a), ")", tall(n.a))}`;
    case "sign":
      return n.s === "pm" ? `\\pm ${tex(n.a)}` : n.s + tex(n.a);
    case "prod": {
      const parts = n.f.map(tex);
      const seps = parts.map((s, k) => {
        if (k === 0) return "";
        const prev = parts[k - 1];
        // `\pi r`, and letters typed apart stay apart (`a t`: never read as one unit)
        if (/^[a-zA-Z]/.test(s) && (/\\[a-zA-Z]+$/.test(prev) || (n.gap[k] && /[a-zA-Z]$/.test(prev)))) return " ";
        return /[\d.]$/.test(prev) && /^[\d.]/.test(s) ? "\\ " : "";
      });
      // letters side by side the engine would read as one word (`o` `f` is "of", `l` `n` is ln): kept apart
      for (let k = 0; k < parts.length; ) {
        let j = k;
        while (j + 1 < parts.length && seps[j + 1] === "" && /^[a-zA-Z]+$/.test(parts[j]) && /^[a-zA-Z]/.test(parts[j + 1])) j++;
        const run = parts.slice(k, j + 1).map(lead).join("");
        if (j > k && letters(run, true)?.length !== run.length) for (let q = k + 1; q <= j; q++) seps[q] = " ";
        k = j + 1;
      }
      return parts.map((p, k) => seps[k] + p).join("");
    }
    case "bin":
      return `${tex(n.l)} ${OP_TEX[n.op]} ${tex(n.r)}`;
    case "rel": {
      let out = n.sides[0] ? tex(n.sides[0]) : "";
      n.ops.forEach((op, k) => {
        const side = n.sides[k + 1];
        out += `${out ? " " : ""}${REL_TEX[op]}${side ? ` ${tex(side)}` : ""}`;
      });
      return out;
    }
    case "list":
      return n.items.map((x, k) => (k ? SEP_TEX[n.seps[k - 1]] : "") + tex(x)).join("");
    case "opline":
      return n.items.map((x) => `${x.op === "div" ? "\\div" : "\\times"} ${tex(x.a)}`).join(" \\quad ");
  }
}

// ---------------------------------------------------------------- writing plain text

const REL_PLAIN: Record<Rel, string> = { "=": "=", "<": "<", ">": ">", le: "≤", ge: "≥", ne: "≠", approx: "≈" };
const OP_PLAIN: Record<Op, string> = { "+": "+", "-": "-", pm: "±", times: "×", div: "÷", rem: "R" };
const SEP_PLAIN: Record<string, string> = { ",": ", ", or: " or ", and: " and " };

/** `d`: inside brackets (where a comma separates, so 1,000 is written 1000); `abs`: inside |…| */
interface Ctx {
  d: number;
  abs: boolean;
}
const inside = (c: Ctx): Ctx => ({ d: c.d + 1, abs: false });
const ATOMS = new Set<N["t"]>(["num", "var", "sym", "group", "abs", "fn"]);

/** one thing to the reader: a fraction's bottom, a root's inside need no brackets (any space is inside its own) */
function single(n: N): boolean {
  return ATOMS.has(n.t) || n.t === "pow" || n.t === "post" || n.t === "root" || (n.t === "sign" && n.s !== "pm" && ATOMS.has(n.a.t));
}

/** an exponent of one number or letter needs no brackets: `x^2`, `x^-3`, `x^n` */
function power(e: N, c: Ctx): string {
  const one = e.t === "num" || (e.t === "var" && !e.sub) || e.t === "sym" || (e.t === "sign" && e.s === "-" && (e.a.t === "num" || e.a.t === "var" || e.a.t === "sym"));
  return `^${one ? plain(e, c) : `(${plain(e, inside(c))})`}`;
}

/** factors side by side, and whether any is set apart (a fraction's top must be one unbroken term) */
function sideBySide(n: Extract<N, { t: "prod" }>, c: Ctx): { s: string; apart: boolean } {
  const parts = n.f.map((f) => plain(f, c));
  const seps = parts.map((s, k) => {
    if (k === 0) return "";
    // a number never follows a letter or a number side by side (`x × 2`, `1/2 × 3/4`: `x2` is
    // refused, `2 3` too; `(x + 1)2` is fine), and a fraction's top starts after a space (`2 x/3`)
    if (/^[\d.]/.test(s) && /[\w.]$/.test(parts[k - 1])) return " × ";
    if (n.f[k].t === "frac") return " ";
    const prev = n.f[k - 1];
    // letters typed apart stay apart (`a t`), and a subscript's letter never runs into the next (`a_n b`)
    if (/[a-zA-Z]$/.test(parts[k - 1]) && /^[a-zA-Z]/.test(s) && (n.gap[k] || prev.t !== "var" || prev.sub)) return " ";
    return "";
  });
  // letters written together must read back as the same letters: `p` `i` is π, `o` `f` alone is "of"
  for (let k = 0; k < parts.length; ) {
    let j = k;
    while (j + 1 < parts.length && seps[j + 1] === "" && /[a-zA-Z]$/.test(parts[j]) && lead(parts[j + 1])) j++;
    const chain = parts.slice(k, j + 1).map(lead);
    if (j > k && letters(chain.join(""), false)!.join("|") !== chain.flatMap((l) => letters(l, false)!).join("|")) {
      for (let q = k + 1; q <= j; q++) seps[q] = " ";
    }
    k = j + 1;
  }
  return { s: parts.map((p, k) => seps[k] + p).join(""), apart: seps.some(Boolean) };
}

function plain(n: N, c: Ctx = { d: 0, abs: false }): string {
  const wrap = (x: N) => `(${plain(x, inside(c))})`;
  switch (n.t) {
    case "num":
      return (n.money ? "$" : "") + (c.d ? n.s.replace(/,/g, "") : n.s);
    case "var":
      return n.s + (n.sub ? `_${n.sub.t === "num" || n.sub.t === "var" ? plain(n.sub, c) : wrap(n.sub)}` : "");
    case "sym":
      return n.s === "pi" ? "π" : n.s === "theta" ? "θ" : n.s === "ask" ? "?" : "□";
    case "hole":
      return "";
    case "group":
      return n.o + plain(n.a, inside(c)) + n.c;
    case "abs":
      return c.abs ? `abs${wrap(n.a)}` : `|${plain(n.a, { ...c, abs: true })}|`;
    case "frac": {
      // the top: one unbroken term (`3x`, `2(x + 1)`, `2√3`); the bottom: one thing (`2`, `x^2`, `√2`)
      const top = n.n.t === "prod" ? sideBySide(n.n, c) : { s: plain(n.n, c), apart: false };
      const tight = single(n.n) || (n.n.t === "prod" && !top.apart && n.n.f.every(single));
      return `${tight && n.n.t !== "sign" ? top.s : wrap(n.n)}/${single(n.d) ? plain(n.d, c) : wrap(n.d)}`;
    }
    case "mixed":
      return `${n.money ? "$" : ""}${c.d ? n.w.replace(/,/g, "") : n.w} ${n.n}/${n.d}`;
    case "pow":
    case "post": {
      const b = n.t === "pow" ? n.b : n.a;
      // `√(2)^2`: a root's bracket keeps the power outside it
      const bs = b.t === "root" ? `${b.cube ? "∛" : "√"}${wrap(b.a)}` : ATOMS.has(b.t) ? plain(b, c) : wrap(b);
      return n.t === "post" ? bs + (n.s === "deg" ? "°" : n.s) : bs + power(n.e, c);
    }
    case "root": {
      const s = plain(n.a, c);
      // `√(x+1)^2` would be (√(x+1))²: an inside that starts with a bracket gets its own
      return (n.cube ? "∛" : "√") + (single(n.a) && (n.a.t === "group" || !s.startsWith("(")) ? s : wrap(n.a));
    }
    case "fn":
      return `${n.s}${n.base ? `_${n.base.t === "num" || n.base.t === "var" ? plain(n.base, c) : wrap(n.base)}` : ""}${n.p ? power(n.p, c) : ""}${wrap(n.a)}`;
    case "sign":
      return (n.s === "pm" ? "±" : n.s) + plain(n.a, c);
    case "prod":
      return sideBySide(n, c).s;
    case "bin":
      return `${plain(n.l, c)} ${OP_PLAIN[n.op]} ${plain(n.r, c)}`;
    case "rel": {
      let out = n.sides[0] ? plain(n.sides[0], c) : "";
      n.ops.forEach((op, k) => {
        const side = n.sides[k + 1];
        out += `${out ? " " : ""}${REL_PLAIN[op]}${side ? ` ${plain(side, c)}` : ""}`;
      });
      return out;
    }
    case "list":
      return n.items.map((x, k) => (k ? SEP_PLAIN[n.seps[k - 1]] : "") + plain(x, c)).join("");
    case "opline":
      return n.items.map((x) => `${x.op === "div" ? "÷" : "×"}${plain(x.a, c)}`).join(" ");
  }
}

// ---------------------------------------------------------------- the contract

/** a line of maths is never this long; a pasted paragraph is not maths */
const MAX_TYPED = 400;

/** LaTeX this reader does not model, kept as typed: only its braces are checked. */
function passThrough(src: string): TypedParse {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth < 0) return { ok: false, hint: "There's a } with no { before it", partial: "" };
  }
  return depth > 0 ? { ok: false, hint: "Close the {", partial: src + "}".repeat(depth) } : { ok: true, latex: src };
}

/**
 * What the kid typed, as the LaTeX the board writes and the tutor reads. `ok: false` while the line
 * is unfinished or unclear: a short hint for the kid and the best LaTeX for the preview (brackets
 * closed, a box where something is missing). Never throws.
 */
export function plainToLatex(text: string): TypedParse {
  try {
    const src = (text ?? "").replace(/\s+/g, " ").trim();
    if (!src) return { ok: false, hint: "", partial: "" };
    if (src.length > MAX_TYPED) return { ok: false, hint: "That line is too long: split it in two", partial: "" };
    const { node, why } = read(src, src.includes("\\"));
    if (why.unknown) return passThrough(src);
    const latex = tex(node);
    return why.hint ? { ok: false, hint: why.hint, partial: latex } : { ok: true, latex };
  } catch {
    return { ok: false, hint: "Check the line", partial: "" };
  }
}

/**
 * A line's reading (Mathpix's, the vision reader's, a typed line's) as plain text a kid can read and
 * edit, which `plainToLatex` turns back into the same maths. LaTeX this reader does not model, or
 * an unfinished reading, comes back as it is. Never throws.
 */
export function latexToPlain(latex: string): string {
  const src = (latex ?? "").trim();
  try {
    if (!src || src.length > 4 * MAX_TYPED) return src;
    const { node, why } = read(src.replace(/\s+/g, " "), true);
    return why.unknown || why.hint ? src : plain(node);
  } catch {
    return src;
  }
}
