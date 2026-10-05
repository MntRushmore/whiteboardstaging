/**
 * A small, forgiving reader for the LaTeX the learning record sees (a problem as the tutor wrote it,
 * a student line as Mathpix read it): a tree of terms and factors the skill classifier
 * (`skills.ts`) reads the form of a problem from, and the mistake classifier (`mistakes.ts`) edits
 * and evaluates to test what went wrong between two lines.
 *
 * Why not the engine's own reader: the classifier must run with no engine at all (it files every
 * attempt, in under a millisecond), and both classifiers need the STRUCTURE a student wrote —
 * which term carries the sign, which bracket was multiplied, what was over what — which the
 * engine's mathjs source flattens away. The mistake classifier still checks that this reading
 * agrees with the engine's before it trusts it.
 *
 * It reads ordinary school maths: numbers, letters, + − × ÷ ±, implicit products, powers, \frac,
 * \sqrt, |…|, brackets, trig and logs, f(x) calls, degrees, % and mixed numbers. Anything else
 * (calculus, \text, units, matrices) is not read: `readLatex` returns null and the callers fall
 * back to what the raw text says. Pure, no imports.
 */

export type RelOp = "=" | "<" | ">" | "<=" | ">=" | "!=";

export interface Term {
  /** written with a minus in front (`- 3x`, or a leading `-`) */
  neg: boolean;
  node: Node;
  /** written with ± (read as + when evaluating) */
  pm?: boolean;
}

export interface Factor {
  node: Node;
  /** divided by (`÷`, `/`) rather than multiplied */
  div: boolean;
  /** a written × · ÷ / rather than two things side by side */
  explicit: boolean;
}

export type Node =
  | { t: "num"; v: number; raw: string }
  | { t: "var"; name: string }
  | { t: "const"; name: "pi" | "e" | "i" | "inf" }
  /** a sum of signed terms; also a single negated term (`-2x` is one term with `neg`) */
  | { t: "add"; terms: Term[] }
  | { t: "mul"; factors: Factor[] }
  | { t: "pow"; base: Node; exp: Node }
  | { t: "frac"; num: Node; den: Node }
  /** `2\frac{1}{2}` */
  | { t: "mixed"; whole: number; num: number; den: number }
  | { t: "sqrt"; arg: Node; index: Node | null }
  | { t: "abs"; arg: Node }
  /** written brackets: `(x + 2)`, `[x + 2]` */
  | { t: "paren"; node: Node }
  /** `(2, 3)` */
  | { t: "tuple"; items: Node[] }
  /** `\sin x`, `\log_{2}(x)`, `\sin^{2} x`, `f(x)`, `f^{-1}(x)` */
  | { t: "fn"; name: string; arg: Node; base: Node | null; power: Node | null }
  /** `30^{\circ}` */
  | { t: "deg"; node: Node }
  | { t: "pct"; node: Node }
  | { t: "fact"; node: Node };

export interface Relation {
  /** the sides between the relation signs; null for an empty side (`2x + 3 =`, `= 8`, `x = ?`) */
  sides: (Node | null)[];
  ops: RelOp[];
}

/** One line: its comma-separated parts (`x = 2, x = 3`; one part for most lines). */
export interface Reading {
  items: Relation[];
}

// ------------------------------------------------------------------ cleaning

/** Commands whose braces hold words, not maths. */
const TEXT_COMMANDS = new Set(["text", "textbf", "textit", "textrm", "textsf", "mbox", "mathrm", "operatorname", "textnormal", "mathsf"]);

/** Trig, logs and the other named functions the reader knows. */
export const FUNCTION_COMMANDS: ReadonlySet<string> = new Set([
  "sin",
  "cos",
  "tan",
  "sec",
  "csc",
  "cot",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "log",
  "ln",
  "lg",
  "exp",
]);
export const TRIG_FUNCTIONS: ReadonlySet<string> = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh"]);

const GREEK = new Set(["alpha", "beta", "gamma", "delta", "theta", "phi", "varphi", "lambda", "mu", "sigma", "omega", "rho", "tau", "vartheta"]);

/**
 * The line with LaTeX's spelling variants made one (`\dfrac` → `\frac`, `\cdot` → `*`, `\leq` →
 * `≤`, `\left(` → `(`), spacing gone, and the unicode a keyboard types read as LaTeX.
 */
export function normalizeLatex(latex: string): string {
  return latex
    .replace(/\\(?:left|right|bigl|bigr|Bigl|Bigr|biggl|biggr|big|Big|bigg|Bigg)\s*(\\\{|\\\}|\\[lr]?vert|\\\||\.|[()[\]|])/g, (_, d: string) =>
      d === "." ? "" : d === "\\{" ? "(" : d === "\\}" ? ")" : d.startsWith("\\") ? "|" : d,
    )
    .replace(/\\(?:dfrac|tfrac|cfrac)/g, "\\frac")
    .replace(/\\(?:cdot|times|ast)(?![a-zA-Z])/g, "*")
    .replace(/\\div(?![a-zA-Z])/g, "÷")
    .replace(/\\(?:leqslant|leq|le)(?![a-zA-Z])/g, "≤")
    .replace(/\\(?:geqslant|geq|ge)(?![a-zA-Z])/g, "≥")
    .replace(/\\(?:neq|ne)(?![a-zA-Z])/g, "≠")
    .replace(/\\lt(?![a-zA-Z])/g, "<")
    .replace(/\\gt(?![a-zA-Z])/g, ">")
    .replace(/\\(?:lvert|rvert|vert|mid)(?![a-zA-Z])|\\\|/g, "|")
    .replace(/\\(?:stackrel|overset)\s*\{\s*\?\s*\}\s*\{\s*=\s*\}/g, "=")
    .replace(/\\(?:mathbf|mathit|boldsymbol|bm|mathnormal)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\mathrm\s*\{\s*d\s*\}/g, "d")
    .replace(/\\\{/g, "(")
    .replace(/\\\}/g, ")")
    .replace(/\\(?:quad|qquad|enspace|thinspace|displaystyle|limits|nolimits)(?![a-zA-Z])|\\[,;:! ]|~/g, " ")
    .replace(/[−–]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/π/g, "\\pi ")
    .replace(/√/g, "\\sqrt")
    .replace(/°/g, "^{\\circ}")
    .replace(/²/g, "^{2}")
    .replace(/³/g, "^{3}");
}

/** The words a line's \text (and \mathrm, \operatorname) commands hold, in order. */
export function textWords(latex: string): string[] {
  const out: string[] = [];
  const re = /\\(?:text|textbf|textit|textrm|textsf|mbox|textnormal)\s*\{([^{}]*)\}/g;
  for (let m = re.exec(latex); m; m = re.exec(latex)) out.push(...(m[1].match(/[A-Za-z]+(?:'[a-z]+)?/g) ?? []));
  return out;
}

// ------------------------------------------------------------------ tokens

type Tok =
  | { k: "num"; v: number; raw: string }
  | { k: "id"; name: string }
  | { k: "cmd"; name: string }
  | { k: "op"; v: "+" | "-" | "*" | "/" | "^" | "_" | "!" | "%" | "pm" | "'" }
  | { k: "rel"; v: RelOp }
  | { k: "open"; v: "(" | "[" | "{" }
  | { k: "close"; v: ")" | "]" | "}" }
  | { k: "bar" }
  | { k: "sep" }
  | { k: "q" };

class Unreadable extends Error {}

function fail(why: string): never {
  throw new Unreadable(why);
}

/** The brace group starting at `open` (an index of `{`): its contents and the index after it. */
function braceGroup(s: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return { body: s.slice(open + 1, i), end: i + 1 };
    }
  }
  return fail("unclosed brace");
}

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    const prev = out[out.length - 1];
    // TeX takes one character after ^ or _ with no braces: x^23 is x^{2}3
    const script = prev?.k === "op" && (prev.v === "^" || prev.v === "_");
    if ((c >= "0" && c <= "9") || (c === "." && /\d/.test(s[i + 1] ?? ""))) {
      if (script) {
        out.push({ k: "num", v: Number(c), raw: c });
        i++;
        continue;
      }
      const m = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(s.slice(i))!;
      out.push({ k: "num", v: Number(m[0]), raw: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      out.push({ k: "id", name: c });
      i++;
      continue;
    }
    if (c === "\\") {
      const m = /^\\([A-Za-z]+)/.exec(s.slice(i));
      if (!m) {
        if (s[i + 1] === "%") {
          out.push({ k: "op", v: "%" });
          i += 2;
          continue;
        }
        return fail(`unknown escape ${s.slice(i, i + 2)}`);
      }
      const name = m[1];
      i += m[0].length;
      if (TEXT_COMMANDS.has(name)) {
        while (s[i] === " ") i++;
        if (s[i] !== "{") return fail("text without braces");
        const g = braceGroup(s, i);
        i = g.end;
        // only words that say nothing (punctuation, spaces) may be skipped; real words are not maths
        if (/[A-Za-z0-9]/.test(g.body)) return fail("words");
        continue;
      }
      if (name === "pm" || name === "mp") out.push({ k: "op", v: "pm" });
      else if (name === "degree") out.push({ k: "cmd", name: "circ" });
      else out.push({ k: "cmd", name });
      continue;
    }
    switch (c) {
      case "+":
      case "-":
      case "*":
      case "/":
      case "^":
      case "_":
      case "!":
      case "%":
      case "'":
        out.push({ k: "op", v: c });
        break;
      case "÷":
        out.push({ k: "op", v: "/" });
        break;
      case "=":
        out.push({ k: "rel", v: "=" });
        break;
      case "<":
      case ">":
        if (s[i + 1] === "=") {
          out.push({ k: "rel", v: c === "<" ? "<=" : ">=" });
          i++;
        } else out.push({ k: "rel", v: c });
        break;
      case "≤":
        out.push({ k: "rel", v: "<=" });
        break;
      case "≥":
        out.push({ k: "rel", v: ">=" });
        break;
      case "≠":
        out.push({ k: "rel", v: "!=" });
        break;
      case "(":
      case "[":
      case "{":
        out.push({ k: "open", v: c });
        break;
      case ")":
      case "]":
      case "}":
        out.push({ k: "close", v: c });
        break;
      case "|":
        out.push({ k: "bar" });
        break;
      case ",":
      case ";":
        out.push({ k: "sep" });
        break;
      case "?":
        out.push({ k: "q" });
        break;
      default:
        return fail(`unknown character ${c}`);
    }
    i++;
  }
  return out;
}

// ------------------------------------------------------------------ parsing

const DEG = Symbol("deg");

/** Commands that start a factor (a value), besides the named functions. */
const FACTOR_COMMANDS = new Set(["frac", "sqrt", "pi", "infty", "angle", "measuredangle", "triangle", ...GREEK]);

class Parser {
  private i = 0;
  private absDepth = 0;
  constructor(private readonly toks: readonly Tok[]) {}

  private peek(offset = 0): Tok | undefined {
    return this.toks[this.i + offset];
  }

  private isOp(t: Tok | undefined, v: string): boolean {
    return t?.k === "op" && t.v === v;
  }

  private expectClose(): void {
    const t = this.toks[this.i++];
    if (t?.k !== "close") fail("expected a closing bracket");
  }

  reading(): Reading {
    const items: Relation[] = [this.relation()];
    while (this.i < this.toks.length) {
      const t = this.toks[this.i];
      if (t.k !== "sep") fail("unexpected token");
      this.i++;
      items.push(this.relation());
    }
    return { items };
  }

  private side(): Node | null {
    const t = this.peek();
    if (t?.k === "q") {
      this.i++;
      return null;
    }
    if (!t || t.k === "rel" || t.k === "sep") return null;
    return this.expr();
  }

  private relation(): Relation {
    const sides: (Node | null)[] = [this.side()];
    const ops: RelOp[] = [];
    for (let t = this.peek(); t?.k === "rel"; t = this.peek()) {
      this.i++;
      ops.push(t.v);
      sides.push(this.side());
    }
    return { sides, ops };
  }

  expr(): Node {
    const terms: Term[] = [];
    let t = this.peek();
    let neg = false;
    let pm = false;
    if (this.isOp(t, "+")) this.i++;
    else if (this.isOp(t, "-")) {
      this.i++;
      neg = true;
    } else if (this.isOp(t, "pm")) {
      this.i++;
      pm = true;
    }
    terms.push(pm ? { neg, node: this.term(), pm } : { neg, node: this.term() });
    for (t = this.peek(); t?.k === "op" && (t.v === "+" || t.v === "-" || t.v === "pm"); t = this.peek()) {
      this.i++;
      const node = this.term();
      terms.push(t.v === "pm" ? { neg: false, node, pm: true } : { neg: t.v === "-", node });
    }
    if (terms.length === 1 && !terms[0].neg && !terms[0].pm) return terms[0].node;
    return { t: "add", terms };
  }

  private term(): Node {
    const factors: Factor[] = [{ node: this.power(), div: false, explicit: false }];
    for (;;) {
      const t = this.peek();
      if (t?.k === "op" && (t.v === "*" || t.v === "/")) {
        this.i++;
        factors.push({ node: this.signedPower(), div: t.v === "/", explicit: true });
        continue;
      }
      if (this.startsFactor(t)) {
        factors.push({ node: this.power(), div: false, explicit: false });
        continue;
      }
      break;
    }
    return factors.length === 1 ? factors[0].node : { t: "mul", factors };
  }

  /** A factor after × or ÷, which may carry its own sign: `3 × -2`. */
  private signedPower(): Node {
    const t = this.peek();
    if (this.isOp(t, "-") || this.isOp(t, "+")) {
      this.i++;
      const node = this.power();
      return this.isOp(t, "-") ? { t: "add", terms: [{ neg: true, node }] } : node;
    }
    return this.power();
  }

  private startsFactor(t: Tok | undefined): boolean {
    if (!t) return false;
    if (t.k === "num" || t.k === "id") return true;
    if (t.k === "open") return true;
    // inside |…| a bar closes it; outside it opens one (`3|x - 1|`)
    if (t.k === "bar") return this.absDepth === 0;
    if (t.k === "cmd") return FACTOR_COMMANDS.has(t.name) || FUNCTION_COMMANDS.has(t.name);
    return false;
  }

  private power(): Node {
    let base = this.postfix(this.atom());
    while (this.isOp(this.peek(), "^")) {
      this.i++;
      const exp = this.script();
      base = this.postfix(exp === DEG ? { t: "deg", node: base } : { t: "pow", base, exp });
    }
    return base;
  }

  private postfix(node: Node): Node {
    for (;;) {
      const t = this.peek();
      if (this.isOp(t, "!")) {
        this.i++;
        node = { t: "fact", node };
      } else if (this.isOp(t, "%")) {
        this.i++;
        node = { t: "pct", node };
      } else if (this.isOp(t, "'")) {
        return fail("a prime (a derivative)");
      } else if (t?.k === "cmd" && t.name === "circ" && this.isDegreeAfter(node)) {
        this.i++;
        node = { t: "deg", node };
      } else return node;
    }
  }

  private isDegreeAfter(node: Node): boolean {
    return node.t === "num" || node.t === "var" || node.t === "paren";
  }

  /** What follows ^ or _: a brace group, or one character; `{\circ}` is a degree sign. */
  private script(): Node | typeof DEG {
    const t = this.toks[this.i++];
    if (!t) return fail("nothing after ^");
    if (t.k === "open" && t.v === "{") {
      const inner = this.peek();
      if (inner?.k === "cmd" && inner.name === "circ" && this.peek(1)?.k === "close") {
        this.i += 2;
        return DEG;
      }
      const node = this.expr();
      this.expectClose();
      return node;
    }
    if (t.k === "cmd" && t.name === "circ") return DEG;
    if (t.k === "num") return { t: "num", v: t.v, raw: t.raw };
    if (t.k === "id") return { t: "var", name: t.name };
    if (t.k === "op" && t.v === "-") {
      const n = this.toks[this.i++];
      if (n?.k === "num") return { t: "add", terms: [{ neg: true, node: { t: "num", v: n.v, raw: n.raw } }] };
    }
    return fail("unreadable script");
  }

  /** A subscript as a name part: `x_{1}` → `1`, `a_n` → `n`. */
  private subscriptName(): string {
    const t = this.toks[this.i++];
    if (!t) return fail("nothing after _");
    if (t.k === "num") return t.raw;
    if (t.k === "id") return t.name;
    if (t.k === "open" && t.v === "{") {
      let name = "";
      for (let n = this.toks[this.i++]; n && n.k !== "close"; n = this.toks[this.i++]) {
        if (n.k === "num") name += n.raw;
        else if (n.k === "id") name += n.name;
        else if (n.k === "op" && (n.v === "+" || n.v === "-")) name += n.v;
        else if (n.k === "cmd") name += n.name;
        else return fail("unreadable subscript");
      }
      return name;
    }
    return fail("unreadable subscript");
  }

  /** A brace group as a node (`\frac{…}{…}`), or a single token (`\frac12`). */
  private group(): Node {
    const t = this.peek();
    if (t?.k === "open" && t.v === "{") {
      this.i++;
      const node = this.expr();
      this.expectClose();
      return node;
    }
    if (t?.k === "num") {
      this.i++;
      // \frac12: TeX takes one digit
      if (t.raw.length > 1 && /^\d+$/.test(t.raw)) {
        const rest = t.raw.slice(1);
        (this.toks as Tok[]).splice(this.i, 0, { k: "num", v: Number(rest), raw: rest });
        return { t: "num", v: Number(t.raw[0]), raw: t.raw[0] };
      }
      return { t: "num", v: t.v, raw: t.raw };
    }
    if (t?.k === "id") {
      this.i++;
      return { t: "var", name: t.name };
    }
    return this.atom();
  }

  private atom(): Node {
    const t = this.toks[this.i++];
    if (!t) return fail("unexpected end");
    switch (t.k) {
      case "num": {
        const next = this.peek();
        // a mixed number: 2\frac{1}{2}
        if (next?.k === "cmd" && next.name === "frac" && /^\d+$/.test(t.raw)) {
          const save = this.i;
          this.i++;
          const num = this.group();
          const den = this.group();
          if (num.t === "num" && den.t === "num" && Number.isInteger(num.v) && Number.isInteger(den.v)) return { t: "mixed", whole: t.v, num: num.v, den: den.v };
          this.i = save;
        }
        return { t: "num", v: t.v, raw: t.raw };
      }
      case "id": {
        let name = t.name;
        if (this.isOp(this.peek(), "_")) {
          this.i++;
          name = `${name}_${this.subscriptName()}`;
        }
        // f(x), g(f(x)), f^{-1}(x): a function only for f, g, h (3(x + 2) and a(x - h) are products)
        if ((name === "f" || name === "g" || name === "h") && (this.peek()?.k === "open" || this.isInverseCall())) {
          let fn = name;
          if (this.isOp(this.peek(), "^")) {
            this.i += 5; // ^ { - 1 }
            fn = `${name}^{-1}`;
          }
          const open = this.peek();
          if (open?.k === "open" && open.v === "(") {
            this.i++;
            const arg = this.expr();
            this.expectClose();
            return { t: "fn", name: fn, arg, base: null, power: null };
          }
          return fail("a function name without its argument");
        }
        if (name === "e") return { t: "const", name: "e" };
        if (name === "i") return { t: "const", name: "i" };
        return { t: "var", name };
      }
      case "cmd": {
        if (t.name === "frac") {
          const num = this.group();
          const den = this.group();
          return { t: "frac", num, den };
        }
        if (t.name === "sqrt") {
          let index: Node | null = null;
          const open = this.peek();
          if (open?.k === "open" && open.v === "[") {
            this.i++;
            index = this.expr();
            this.expectClose();
          }
          return { t: "sqrt", arg: this.group(), index };
        }
        if (t.name === "pi") return { t: "const", name: "pi" };
        if (t.name === "infty") return { t: "const", name: "inf" };
        // ∠A, m∠ABC, △ABC: a name (a quantity in an angle sum)
        if (t.name === "angle" || t.name === "measuredangle" || t.name === "triangle") {
          let name = t.name === "triangle" ? "△" : "∠";
          for (let n = this.peek(); n && (n.k === "id" || n.k === "num"); n = this.peek()) {
            name += n.k === "id" ? n.name : n.raw;
            this.i++;
          }
          if (name.length === 1) return fail("an angle with no name");
          return { t: "var", name };
        }
        if (GREEK.has(t.name)) return { t: "var", name: t.name };
        if (FUNCTION_COMMANDS.has(t.name)) return this.fn(t.name);
        return fail(`unknown command \\${t.name}`);
      }
      case "open": {
        if (t.v === "{") {
          const node = this.expr();
          this.expectClose();
          return node;
        }
        const first = this.expr();
        if (this.peek()?.k === "sep") {
          const items = [first];
          while (this.peek()?.k === "sep") {
            this.i++;
            items.push(this.expr());
          }
          this.expectClose();
          return { t: "tuple", items };
        }
        this.expectClose();
        return { t: "paren", node: first };
      }
      case "bar": {
        this.absDepth++;
        const arg = this.expr();
        this.absDepth--;
        if (this.toks[this.i++]?.k !== "bar") fail("unclosed |");
        return { t: "abs", arg };
      }
      case "op":
        // a sign where a factor goes: `(-3)` is read by expr; this is `2^-1`-like slop
        if (t.v === "-") return { t: "add", terms: [{ neg: true, node: this.power() }] };
        return fail("unexpected operator");
      default:
        return fail("unexpected token");
    }
  }

  private isInverseCall(): boolean {
    // ^ { - 1 } (
    const [a, b, c, d, e, f] = [this.peek(), this.peek(1), this.peek(2), this.peek(3), this.peek(4), this.peek(5)];
    return this.isOp(a, "^") && b?.k === "open" && this.isOp(c, "-") && d?.k === "num" && d.v === 1 && e?.k === "close" && f?.k === "open";
  }

  private fn(name: string): Node {
    let base: Node | null = null;
    let power: Node | null = null;
    for (let k = 0; k < 2; k++) {
      if (this.isOp(this.peek(), "_") && !base) {
        this.i++;
        const b = this.script();
        if (b === DEG) return fail("degree as a base");
        base = b;
      } else if (this.isOp(this.peek(), "^") && !power) {
        this.i++;
        const p = this.script();
        if (p === DEG) return fail("degree as a power");
        power = p;
      }
    }
    const open = this.peek();
    let arg: Node;
    if (open?.k === "open" && open.v === "(") {
      this.i++;
      arg = { t: "paren", node: this.expr() };
      this.expectClose();
    } else arg = this.fnArg();
    return { t: "fn", name, arg, base, power };
  }

  /** `\sin 2x`, `\log x`, `\sin 30^{\circ}`: factors up to an operator, a relation or another function. */
  private fnArg(): Node {
    const factors: Factor[] = [];
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.k === "cmd" && FUNCTION_COMMANDS.has(t.name)) break;
      const value = t.k === "num" || t.k === "id" || (t.k === "cmd" && FACTOR_COMMANDS.has(t.name)) || (t.k === "open" && t.v === "{");
      if (!value) break;
      factors.push({ node: this.power(), div: false, explicit: false });
    }
    if (factors.length === 0) return fail("a function with no argument");
    return factors.length === 1 ? factors[0].node : { t: "mul", factors };
  }
}

/**
 * A line read into its tree, or null when it holds something this reader does not read (words,
 * units, calculus, an environment). Never throws.
 */
export function readLatex(latex: string): Reading | null {
  try {
    const toks = tokenize(normalizeLatex(latex));
    if (toks.length === 0) return null;
    return new Parser(toks).reading();
  } catch {
    return null;
  }
}

/** The single relation (or expression) of a line with no commas; null otherwise. */
export function readRelation(latex: string): Relation | null {
  const r = readLatex(latex);
  return r && r.items.length === 1 ? r.items[0] : null;
}

// ------------------------------------------------------------------ evaluating

export type Scope = Readonly<Record<string, number>>;

function hasDegrees(node: Node): boolean {
  return someNode(node, (n) => n.t === "deg");
}

const FACTORIALS = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];

/**
 * A value to use for a node instead of its own (undefined: its own). How the mistake classifier
 * tries an edit — a sign flipped, a number changed, a bracket multiplied out wrongly — without
 * copying the tree.
 */
export type Override = (node: Node, scope: Scope) => number | undefined;

/**
 * The node's value with its letters from `scope` (NaN for an unknown letter or an undefined value).
 * Angles in degrees when written with °.
 */
export function evaluate(node: Node, scope: Scope, override?: Override): number {
  if (override) {
    const v = override(node, scope);
    if (v !== undefined) return v;
  }
  switch (node.t) {
    case "num":
      return node.v;
    case "var":
      return scope[node.name] ?? Number.NaN;
    case "const":
      return node.name === "pi" ? Math.PI : node.name === "e" ? Math.E : Number.NaN;
    case "add": {
      let s = 0;
      for (const term of node.terms) s += term.neg ? -evaluate(term.node, scope, override) : evaluate(term.node, scope, override);
      return s;
    }
    case "mul": {
      let p = 1;
      for (const f of node.factors) p = f.div ? p / evaluate(f.node, scope, override) : p * evaluate(f.node, scope, override);
      return p;
    }
    case "pow": {
      const b = evaluate(node.base, scope, override);
      const e = evaluate(node.exp, scope, override);
      return Math.pow(b, e);
    }
    case "frac":
      return evaluate(node.num, scope, override) / evaluate(node.den, scope, override);
    case "mixed":
      return node.whole + node.num / node.den;
    case "sqrt": {
      const a = evaluate(node.arg, scope, override);
      if (!node.index) return Math.sqrt(a);
      const n = evaluate(node.index, scope, override);
      if (a < 0 && Number.isInteger(n) && n % 2 === 1) return -Math.pow(-a, 1 / n);
      return Math.pow(a, 1 / n);
    }
    case "abs":
      return Math.abs(evaluate(node.arg, scope, override));
    case "paren":
      return evaluate(node.node, scope, override);
    case "tuple":
      return Number.NaN;
    case "fn": {
      let a = evaluate(node.arg, scope, override);
      if (TRIG_FUNCTIONS.has(node.name) && hasDegrees(node.arg)) a = (a * Math.PI) / 180;
      const inverse = node.power && node.power.t === "add" && node.power.terms.length === 1 && node.power.terms[0].neg && evaluate(node.power.terms[0].node, scope, override) === 1;
      let v: number;
      switch (node.name) {
        case "sin":
          v = inverse ? Math.asin(a) : Math.sin(a);
          break;
        case "cos":
          v = inverse ? Math.acos(a) : Math.cos(a);
          break;
        case "tan":
          v = inverse ? Math.atan(a) : Math.tan(a);
          break;
        case "sec":
          v = 1 / Math.cos(a);
          break;
        case "csc":
          v = 1 / Math.sin(a);
          break;
        case "cot":
          v = 1 / Math.tan(a);
          break;
        case "arcsin":
          v = Math.asin(a);
          break;
        case "arccos":
          v = Math.acos(a);
          break;
        case "arctan":
          v = Math.atan(a);
          break;
        case "sinh":
          v = Math.sinh(a);
          break;
        case "cosh":
          v = Math.cosh(a);
          break;
        case "tanh":
          v = Math.tanh(a);
          break;
        case "ln":
          v = Math.log(a);
          break;
        case "log":
        case "lg":
          v = node.base ? Math.log(a) / Math.log(evaluate(node.base, scope, override)) : Math.log10(a);
          break;
        case "exp":
          v = Math.exp(a);
          break;
        default:
          return Number.NaN;
      }
      if (node.power && !inverse) v = Math.pow(v, evaluate(node.power, scope, override));
      return v;
    }
    case "deg":
      return evaluate(node.node, scope, override);
    case "pct":
      return evaluate(node.node, scope, override) / 100;
    case "fact": {
      const n = evaluate(node.node, scope, override);
      return Number.isInteger(n) && n >= 0 && n < FACTORIALS.length ? FACTORIALS[n] : Number.NaN;
    }
  }
}

// ------------------------------------------------------------------ looking at a tree

/** The node's direct children. */
export function childrenOf(node: Node): Node[] {
  switch (node.t) {
    case "add":
      return node.terms.map((t) => t.node);
    case "mul":
      return node.factors.map((f) => f.node);
    case "pow":
      return [node.base, node.exp];
    case "frac":
      return [node.num, node.den];
    case "sqrt":
      return node.index ? [node.arg, node.index] : [node.arg];
    case "abs":
      return [node.arg];
    case "paren":
    case "deg":
    case "pct":
    case "fact":
      return [node.node];
    case "tuple":
      return node.items;
    case "fn":
      return [node.arg, ...(node.base ? [node.base] : []), ...(node.power ? [node.power] : [])];
    default:
      return [];
  }
}

/** True when `pred` holds for the node or any node under it. */
export function someNode(node: Node, pred: (n: Node) => boolean): boolean {
  if (pred(node)) return true;
  return childrenOf(node).some((c) => someNode(c, pred));
}

/** Every node, parents before children. */
export function allNodes(node: Node, out: Node[] = []): Node[] {
  out.push(node);
  for (const c of childrenOf(node)) allNodes(c, out);
  return out;
}

/** The letters a node uses, each once, in order of appearance (`x`, `y`, `x_1`, `theta`). */
export function variablesOf(node: Node | null): string[] {
  if (!node) return [];
  const out: string[] = [];
  for (const n of allNodes(node)) if (n.t === "var" && !out.includes(n.name)) out.push(n.name);
  return out;
}

export function hasVariable(node: Node | null): boolean {
  return node !== null && someNode(node, (n) => n.t === "var");
}

/** The node with its written brackets (and single-term sums) taken off: `((x + 1))` → `x + 1`. */
export function unwrap(node: Node): Node {
  let n = node;
  while (n.t === "paren") n = n.node;
  return n;
}

/** A constant integer value, or null. */
function integerValue(node: Node): number | null {
  if (hasVariable(node)) return null;
  const v = evaluate(node, {});
  return Number.isFinite(v) && Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : null;
}

/**
 * The node's degree as a polynomial in its letters (all of them together: `x^{2}y` is 3), or null
 * when it is not a polynomial — a letter under a fraction bar, in a power, a root, |…| or a function.
 * Written form, nothing cancelled: `3(x - 1) - 3x` is 1.
 */
export function polyDegree(node: Node, only?: string): number | null {
  const isVar = (n: Node) => n.t === "var" && (only === undefined || n.name === only);
  const hasVar = (n: Node) => someNode(n, isVar);
  const deg = (n: Node): number | null => {
    switch (n.t) {
      case "num":
      case "const":
      case "mixed":
        return 0;
      case "var":
        return isVar(n) ? 1 : 0;
      case "add": {
        let d = 0;
        for (const t of n.terms) {
          const td = deg(t.node);
          if (td === null) return null;
          d = Math.max(d, td);
        }
        return d;
      }
      case "mul": {
        let d = 0;
        for (const f of n.factors) {
          const fd = deg(f.node);
          if (fd === null) return null;
          if (f.div && fd > 0) return null;
          d += fd;
        }
        return d;
      }
      case "pow": {
        const bd = deg(n.base);
        if (bd === null) return null;
        if (hasVar(n.exp)) return null;
        if (bd === 0) return 0;
        const e = integerValue(n.exp);
        return e !== null && e >= 0 ? bd * e : null;
      }
      case "frac": {
        if (hasVar(n.den)) return null;
        return deg(n.num);
      }
      case "paren":
      case "pct":
        return deg(n.node);
      case "sqrt":
      case "abs":
      case "fn":
      case "deg":
      case "fact":
        return hasVar(n) ? null : 0;
      case "tuple":
        return null;
    }
  };
  return deg(node);
}

/** The terms of a sum (one term for anything else), each with its sign. */
export function termsOf(node: Node): Term[] {
  const n = unwrapSingle(node);
  return n.t === "add" ? n.terms : [{ neg: false, node: n }];
}

/** A node that is a sum of one unsigned term is that term. */
function unwrapSingle(node: Node): Node {
  return node.t === "add" && node.terms.length === 1 && !node.terms[0].neg ? node.terms[0].node : node;
}

/** The numbers written in a node, in order (each `num` node once). */
export function numbersOf(node: Node): Extract<Node, { t: "num" }>[] {
  return allNodes(node).filter((n): n is Extract<Node, { t: "num" }> => n.t === "num");
}
