/**
 * LaTeX (Mathpix output or typed) -> mathjs source.
 *
 * Handles \frac, \sqrt[n], \cdot/\times/\div, ^{}, subscripts as identifiers, greek, trig/log,
 * ^\circ -> deg, \left( \right), \text{kg}/\mathrm{m/s^2} -> units, \pm -> two branches,
 * \le \ge \ne, |x| -> abs, \int_a^b ... dx -> integral(), \frac{d}{dx} -> derivative(),
 * \frac{d^2}{dx^2} -> derivative(derivative(...)), \sum_{i=a}^{b} -> summation(),
 * `%` -> /100 and `of` -> `*` (15% of 80).
 * Anything else throws UnsupportedLatex (the LLM path). Pure TypeScript, no mathjs import.
 *
 * Bound variables stay bound: the `dx` of an integral and the index of a sum are removed from
 * `variables` unless the letter is also used free elsewhere on the line, so `\int_0^1 x^2 dx`
 * is a closed expression the engine can evaluate rather than an expression in x.
 */

export class UnsupportedLatex extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedLatex";
  }
}

export interface TranslateOptions {
  /** calculator text rather than LaTeX: keep multi-letter identifiers together */
  plain?: boolean;
  /** `math.Unit.isValuelessUnit` from the mathjs instance; defaults to a small static list */
  isUnit?: (name: string) => boolean;
  /**
   * Promote single letters that are unit names (m, s, g, h, N, J, W, C, V, A, K, L, F) to units when they sit
   * next to a number or another unit and the line already looks like it carries units (default true).
   */
  letterUnits?: boolean;
}

export interface Translated {
  /** mathjs source (the `+` branch when \pm is present) */
  source: string;
  /** one source per \pm branch (length 1 without \pm) */
  branches: string[];
  /** bare identifiers that are not constants/units/functions, in order of appearance */
  variables: string[];
  units: string[];
  functions: string[];
  constants: string[];
  hasUnits: boolean;
  hasDegrees: boolean;
  hasText: boolean;
  hasPm: boolean;
  /** a `%` was read as /100: results are shown as decimals, never as fractions */
  hasPercent: boolean;
}

type TokenKind = "num" | "id" | "unit" | "const" | "group" | "op" | "rel" | "open" | "close" | "pm" | "comma" | "fac" | "fnname";
interface Token {
  kind: TokenKind;
  text: string;
}

/** Identifiers that are constants on the engine's mathjs instance (never variables). */
export const CONSTANT_IDS = new Set(["pi", "e", "Infinity", "hbar", "k_B", "N_A", "epsilon_0", "mu_0", "i"]);

export const FUNCTION_WORDS: Record<string, string> = {
  sin: "sin",
  cos: "cos",
  tan: "tan",
  sec: "sec",
  csc: "csc",
  cot: "cot",
  arcsin: "asin",
  arccos: "acos",
  arctan: "atan",
  asin: "asin",
  acos: "acos",
  atan: "atan",
  sinh: "sinh",
  cosh: "cosh",
  tanh: "tanh",
  coth: "coth",
  ln: "log",
  log: "log10",
  lg: "log10",
  exp: "exp",
  sqrt: "sqrt",
  cbrt: "cbrt",
  abs: "abs",
  max: "max",
  min: "min",
  gcd: "gcd",
  lcm: "lcm",
  floor: "floor",
  ceil: "ceil",
  round: "round",
  mean: "mean",
  median: "median",
  std: "std",
  norm: "norm",
  dot: "dot",
  det: "det",
};

const INVERSE: Record<string, string> = { sin: "asin", cos: "acos", tan: "atan", sec: "asec", csc: "acsc", cot: "acot" };

/** Greek letter commands (exported for the lone-symbol label rule in classify.ts). */
export const GREEK: ReadonlySet<string> = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi",
  "omicron", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi",
  "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
]);
export const GREEK_ALIAS: Record<string, string> = { varepsilon: "epsilon", vartheta: "theta", varphi: "phi", varrho: "rho", varsigma: "sigma", ell: "l", imath: "i" };

/** `~` marks an approximate equality (\approx, ≈): compared with rounding tolerance. */
export const APPROX_OP = "~";
const RELATION_COMMANDS: Record<string, string> = {
  le: "<=", leq: "<=", leqslant: "<=", ge: ">=", geq: ">=", geqslant: ">=", ne: "!=", neq: "!=", lt: "<", gt: ">",
  approx: APPROX_OP, simeq: APPROX_OP, cong: APPROX_OP, doteq: APPROX_OP, equiv: "==",
};
const IMPLICATION_COMMANDS = new Set(["Rightarrow", "implies", "therefore", "Longrightarrow", "iff", "Leftrightarrow"]);
const UNSUPPORTED_COMMANDS = new Set([
  "prod", "lim", "begin", "end", "dots", "ldots", "cdots", "vdots", "forall", "exists", "in", "notin", "subset",
  "cup", "cap", "partial", "nabla", "prime", "dot", "ddot", "oint", "iint", "iiint", "binom", "choose", "matrix", "pmatrix",
  "bmatrix", "cases", "emptyset", "mid", "parallel", "perp", "angle", "triangle", "sim", "propto",
]);
const SPACING = new Set([",", ";", ":", "!", " ", "quad", "qquad", "enspace", "thinspace", "medspace", "thickspace", "negthinspace"]);
const WRAPPERS = new Set(["vec", "hat", "bar", "overline", "underline", "mathbf", "boldsymbol", "mathbb", "mathcal", "tilde", "widetilde", "widehat", "overrightarrow", "mathit", "textit", "textbf", "mathsf"]);
const TEXT_COMMANDS = new Set(["mathrm", "text", "textrm", "operatorname", "mbox", "textnormal", "mathop", "textup"]);

/** Units written inside \mathrm{} that collide with constants or other names on the instance. */
const UNIT_ALIASES: Record<string, string> = { g: "gram", h: "hour", hr: "hour", hrs: "hour", sec: "second", min: "minute", mins: "minute", L: "L", l: "L", mL: "mL", ml: "mL", cc: "cm^3", "°C": "degC", "°F": "degF", ohm: "ohm", Ω: "ohm", u: "u", μ: "u", lbs: "lb", yr: "year", yrs: "year", mph: "mi/hour", kph: "km/hour", cal: "cal", kcal: "kcal", amu: "u", M: "mol/L" };

const DEFAULT_UNITS = new Set([
  "m", "s", "kg", "g", "km", "cm", "mm", "um", "nm", "N", "J", "W", "Pa", "kPa", "MPa", "C", "V", "A", "mA", "T", "K", "mol", "L", "mL", "Hz", "kHz", "MHz",
  "ohm", "F", "H", "Wb", "eV", "keV", "MeV", "kJ", "MJ", "kW", "MW", "GW", "kN", "min", "h", "hour", "day", "mi", "ft", "in", "inch", "yd", "lb", "oz", "gal",
  "deg", "rad", "atm", "bar", "cal", "kcal", "psi", "ms", "us", "ns", "mg", "ug", "kmh", "mph", "rpm", "kWh", "Wh", "degC", "degF", "cd", "lm", "lx", "Bq", "Gy", "Sv",
  "au", "ly", "pc", "gram", "second", "minute", "meter", "metre", "liter", "litre", "newton", "joule", "watt", "pascal", "coulomb", "volt", "ampere", "kelvin", "mole",
]);
/** Multi-letter ALL-CAPS words mathjs would read as prefixed units (PV = petavolt, KE, RT) are algebra, except these. */
const ALLCAPS_UNITS_OK = new Set(["MJ", "MW", "GW", "TW", "MV", "MN", "GJ", "TJ", "GN", "MPa", "GPa", "MHz", "GHz", "THz", "MeV", "GeV", "TeV", "PJ"]);
export function acceptableUnitWord(word: string): boolean {
  if (word.length >= 2 && /^[A-Z]+$/.test(word) && !ALLCAPS_UNITS_OK.has(word)) return false;
  return true;
}

const NOT_UNITS_AS_WORDS = new Set(["in", "at", "as", "an", "be", "by", "do", "if", "it", "of", "on", "or", "so", "to", "up", "is", "are", "and", "the", "for", "let", "then", "when", "find", "solve"]);

const PM_PLUS = "⊕";
const PM_MINUS = "⊖";

/** Strips wrappers that do not change meaning ($, \displaystyle, \boxed{}, line breaks). */
export function preprocessLatex(latex: string): string {
  let s = latex.replace(/\r?\n/g, " ").trim();
  s = s.replace(/^\$+|\$+$/g, "");
  s = s.replace(/\\\(|\\\)|\\\[|\\\]/g, (m) => (m === "\\[" || m === "\\]" ? "" : ""));
  s = s.replace(/\\displaystyle|\\textstyle|\\nonumber|\\notag|\\limits|\\nolimits/g, " ");
  s = s.replace(/\\\\/g, " ");
  s = s.replace(/\\left\s*\./g, "").replace(/\\right\s*\./g, "");
  s = s.replace(/\\mathrm\s*\{\s*~\s*\}/g, " ");
  s = unwrapCommand(s, "boxed");
  s = s.replace(/[−–—]/g, "-");
  s = s.replace(/[×]/g, "\\times ").replace(/[·⋅]/g, "\\cdot ").replace(/[÷]/g, "\\div ");
  s = s.replace(/²/g, "^{2}").replace(/³/g, "^{3}").replace(/°/g, "^{\\circ}").replace(/π/g, "\\pi ");
  // 20^{\circ}C / 20^\circ \mathrm{C} -> 20 \mathrm{degC}; same for F
  s = s.replace(/\^\s*\{?\s*\\circ\s*\}?\s*(?:\\mathrm\s*\{\s*([CF])\s*\}|([CF]))(?![a-zA-Z])/g, (_m, a: string | undefined, b: string | undefined) => ` \\mathrm{deg${a ?? b}}`);
  // thousands separators: 2,000 -> 2000 (only when exactly three digits follow)
  s = s.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  s = s.replace(/∞/g, "\\infty ").replace(/≤/g, "\\le ").replace(/≥/g, "\\ge ").replace(/≠/g, "\\ne ").replace(/≈/g, "\\approx ");
  s = s.replace(/\\(?:checkmark|square|blacksquare|qed|hfill|newline|par|noindent|allowbreak)\b/g, " ").replace(/[✓✔☐■□]/g, " ");
  s = s.replace(/＝/g, "=");
  s = s.replace(/\\text\s*\{\s*\}/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Calculator text: unicode operators and degree signs only; words stay intact. */
export function preprocessPlain(text: string): string {
  return text
    .replace(/[−–—]/g, "-")
    .replace(/[×]/g, "*")
    .replace(/[·⋅]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/°/g, " deg ")
    .replace(/π/g, " pi ")
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapCommand(src: string, command: string): string {
  const needle = `\\${command}`;
  let out = src;
  let idx = out.indexOf(needle);
  while (idx !== -1) {
    let j = idx + needle.length;
    while (out[j] === " ") j++;
    if (out[j] !== "{") return out;
    const end = matchBrace(out, j);
    if (end === -1) return out;
    out = out.slice(0, idx) + " " + out.slice(j + 1, end) + " " + out.slice(end + 1);
    idx = out.indexOf(needle);
  }
  return out;
}

/** index of the `}` matching the `{` at `open`, or -1 */
export function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export interface RelationSplit {
  sides: string[];
  /** mathjs relational operators between consecutive sides: ==, <, >, <=, >=, != or => (implication) */
  ops: string[];
}

/** Splits a LaTeX line at top-level relations (outside braces and \left...\right). */
export function splitRelations(latex: string): RelationSplit {
  const src = preprocessLatex(latex);
  const sides: string[] = [];
  const ops: string[] = [];
  let depth = 0;
  let leftDepth = 0;
  let start = 0;
  let i = 0;
  const push = (end: number, op: string, next: number) => {
    sides.push(src.slice(start, end).trim());
    ops.push(op);
    start = next;
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+)/.exec(src.slice(i));
      if (m) {
        const name = m[1];
        if (name === "left") leftDepth++;
        else if (name === "right") leftDepth--;
        else if (depth === 0 && leftDepth === 0 && RELATION_COMMANDS[name]) {
          push(i, RELATION_COMMANDS[name], i + m[0].length);
        } else if (depth === 0 && leftDepth === 0 && IMPLICATION_COMMANDS.has(name)) {
          push(i, "=>", i + m[0].length);
        }
        i += m[0].length;
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0 && leftDepth === 0) {
      if (ch === "=") {
        if (src[i + 1] === "=") {
          push(i, "==", i + 2);
          i += 2;
          continue;
        }
        push(i, "==", i + 1);
      } else if (ch === "<" || ch === ">") {
        if (src[i + 1] === "=") {
          push(i, `${ch}=`, i + 2);
          i += 2;
          continue;
        }
        push(i, ch, i + 1);
      } else if (ch === "!" && src[i + 1] === "=") {
        push(i, "!=", i + 2);
        i += 2;
        continue;
      }
    }
    i++;
  }
  sides.push(src.slice(start).trim());
  return { sides, ops };
}

class Scanner {
  private i = 0;
  readonly tokens: Token[] = [];
  private absOpen = false;

  constructor(
    private readonly src: string,
    private readonly opts: TranslateOptions,
    private readonly meta: Meta,
  ) {}

  private isUnitName(name: string): boolean {
    if (!name) return false;
    if (!acceptableUnitWord(name)) return false;
    if (this.opts.isUnit) {
      try {
        return this.opts.isUnit(name);
      } catch {
        return false;
      }
    }
    return DEFAULT_UNITS.has(name);
  }

  private peek(offset = 0): string {
    return this.src[this.i + offset] ?? "";
  }

  private eof(): boolean {
    return this.i >= this.src.length;
  }

  private skipSpaces(): void {
    while (!this.eof() && (this.peek() === " " || this.peek() === "~" || this.peek() === "\t")) this.i++;
  }

  private readCommandName(): string {
    // at '\'
    const rest = this.src.slice(this.i + 1);
    const m = /^[a-zA-Z]+/.exec(rest);
    if (m) {
      this.i += 1 + m[0].length;
      return m[0];
    }
    const ch = rest[0] ?? "";
    this.i += 2;
    return ch;
  }

  /** reads `{...}` at the cursor (after optional spaces); returns the raw inner or null */
  private readGroup(): string | null {
    this.skipSpaces();
    if (this.peek() !== "{") return null;
    const end = matchBrace(this.src, this.i);
    if (end === -1) throw new UnsupportedLatex("unbalanced brace");
    const inner = this.src.slice(this.i + 1, end);
    this.i = end + 1;
    return inner;
  }

  /** reads `[...]` optional argument */
  private readOptional(): string | null {
    this.skipSpaces();
    if (this.peek() !== "[") return null;
    const end = this.src.indexOf("]", this.i);
    if (end === -1) return null;
    const inner = this.src.slice(this.i + 1, end);
    this.i = end + 1;
    return inner;
  }

  /** reads a balanced `( ... )` (also \left( ... \right)) at the cursor; returns raw inner */
  private readParenthesized(): string | null {
    this.skipSpaces();
    let j = this.i;
    if (this.src.startsWith("\\left", j)) {
      j += 5;
      while (this.src[j] === " ") j++;
    }
    const open = this.src[j];
    if (open !== "(" && open !== "[") return null;
    const close = open === "(" ? ")" : "]";
    let depth = 0;
    for (let k = j; k < this.src.length; k++) {
      const ch = this.src[k];
      if (ch === "\\") {
        if (this.src.startsWith("\\left", k)) k += 4;
        else if (this.src.startsWith("\\right", k)) k += 5;
        else k += 1;
        continue;
      }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          const inner = this.src.slice(j + 1, k);
          this.i = k + 1;
          return inner;
        }
      }
    }
    throw new UnsupportedLatex("unbalanced parenthesis");
  }

  /** one-character or one-group script argument after ^ or _ ; returns raw */
  private readScriptArg(): string {
    this.skipSpaces();
    const group = this.readGroup();
    if (group !== null) return group;
    if (this.peek() === "\\") {
      const start = this.i;
      this.readCommandName();
      return this.src.slice(start, this.i);
    }
    const ch = this.peek();
    this.i++;
    if (ch === "-" || ch === "+") {
      const next = this.peek();
      if (/[0-9]/.test(next)) return ch + this.readRun(/^[0-9]+(?:\.[0-9]+)?/);
      if (/[a-zA-Z]/.test(next)) return ch + this.readRun(this.opts.plain ? /^[a-zA-Z_]+/ : /^[a-zA-Z]/);
    }
    // `2^10` means 2^{10} to every student; in plain mode `x^abc` keeps the word together
    if (/[0-9]/.test(ch)) return ch + this.readRun(/^[0-9]*(?:\.[0-9]+)?/);
    if (this.opts.plain && /[a-zA-Z]/.test(ch)) return ch + this.readRun(/^[a-zA-Z_]*/);
    return ch;
  }

  private readRun(re: RegExp): string {
    const m = re.exec(this.src.slice(this.i));
    if (!m || !m[0]) return "";
    this.i += m[0].length;
    return m[0];
  }

  private sub(raw: string): string {
    const scanner = new Scanner(raw, this.opts, this.meta);
    scanner.parseAll();
    for (const v of collectVariables(scanner.tokens)) this.meta.variables.add(v);
    return assemble(scanner.tokens);
  }

  private emit(kind: TokenKind, text: string): void {
    this.tokens.push({ kind, text });
  }

  private lastToken(): Token | undefined {
    return this.tokens[this.tokens.length - 1];
  }

  parseAll(): void {
    while (!this.eof()) this.parseItem();
    if (this.absOpen) throw new UnsupportedLatex("unbalanced |");
  }

  /** does the cursor start something a function can take as an implicit argument (\sin x, \sin 30^\circ) */
  private startsAtom(): boolean {
    this.skipSpaces();
    if (this.eof()) return false;
    const ch = this.peek();
    if (/[0-9.{]/.test(ch)) return true;
    if (ch === "^" || ch === "_") return true;
    if (/[a-zA-Z]/.test(ch)) {
      const m = /^[a-zA-Z]+/.exec(this.src.slice(this.i));
      const word = m ? m[0] : ch;
      if (word === "to") return false;
      if (FUNCTION_WORDS[word] && word.length > 1) return false;
      return true;
    }
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+)/.exec(this.src.slice(this.i));
      if (!m) return false;
      const name = m[1];
      if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "sqrt" || name === "pi" || name === "hbar" || name === "infty") return true;
      if (GREEK.has(name) || GREEK_ALIAS[name]) return true;
      if (TEXT_COMMANDS.has(name) || WRAPPERS.has(name)) return true;
      if (name === "circ" || name === "degree") return true;
      return false;
    }
    return false;
  }

  parseItem(): void {
    const ch = this.peek();
    if (ch === " " || ch === "~" || ch === "\t" || ch === "$") {
      this.i++;
      return;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(this.peek(1)))) {
      const m = /^[0-9]*\.?[0-9]*/.exec(this.src.slice(this.i));
      const text = m ? m[0] : ch;
      this.i += text.length;
      this.emit("num", text.startsWith(".") ? `0${text}` : text);
      return;
    }
    if (/[a-zA-Z]/.test(ch)) {
      this.parseLetters();
      return;
    }
    switch (ch) {
      case "\\":
        this.parseCommand();
        return;
      case "^":
        this.i++;
        this.parseSuperscript();
        return;
      case "_":
        this.i++;
        this.parseSubscript();
        return;
      case "{": {
        const inner = this.readGroup() ?? "";
        if (inner.trim()) this.emit("group", `(${this.sub(inner)})`);
        return;
      }
      case "}":
        this.i++;
        return;
      case "(":
      case "[":
        this.i++;
        this.emit("open", "(");
        return;
      case ")":
      case "]":
        this.i++;
        this.emit("close", ")");
        return;
      case "|":
        this.i++;
        this.toggleAbs();
        return;
      case "+":
      case "-":
        this.i++;
        this.emit("op", ch);
        return;
      case "*":
        this.i++;
        this.emit("op", "*");
        return;
      case "/":
        this.i++;
        this.emit("op", "/");
        return;
      case "=":
        this.i++;
        if (this.peek() === "=") this.i++;
        this.emit("rel", "==");
        return;
      case "<":
      case ">":
        this.i++;
        if (this.peek() === "=") {
          this.i++;
          this.emit("rel", `${ch}=`);
        } else this.emit("rel", ch);
        return;
      case "!":
        this.i++;
        if (this.peek() === "=") {
          this.i++;
          this.emit("rel", "!=");
        } else this.emit("fac", "!");
        return;
      case ",":
        this.i++;
        this.emit("comma", ",");
        return;
      case "%":
        this.i++;
        // `%` is a percentage everywhere except calculator text, where it stays modulo -- unless
        // the very next word is `of` (`15% of 80`), which is only ever a percentage.
        if (this.opts.plain && !/^\s*of\b/.test(this.src.slice(this.i))) this.emit("op", "%");
        else this.emitPercent();
        return;
      case ":":
        this.i++;
        this.emit("op", "/");
        return;
      case "'":
      case "&":
      case ";":
      case "?":
        throw new UnsupportedLatex(`unsupported character ${ch}`);
      default:
        this.i++;
        throw new UnsupportedLatex(`unsupported character ${ch}`);
    }
  }

  private toggleAbs(): void {
    if (this.absOpen) {
      this.absOpen = false;
      this.emit("close", ")");
    } else {
      this.absOpen = true;
      this.meta.functions.add("abs");
      this.emit("fnname", "abs");
      this.emit("open", "(");
    }
  }

  private parseLetters(): void {
    const m = /^[a-zA-Z]+/.exec(this.src.slice(this.i));
    const run = m ? m[0] : this.peek();
    if (this.opts.plain) {
      this.i += run.length;
      this.parseWord(run);
      return;
    }
    if (run.length > 1) {
      if (run === "to") {
        this.i += 2;
        this.emit("op", "to");
        return;
      }
      if (run === "of") {
        this.i += 2;
        this.emitOf();
        return;
      }
      if (FUNCTION_WORDS[run]) {
        this.i += run.length;
        this.parseFunction(FUNCTION_WORDS[run]);
        return;
      }
      if (this.isUnitName(run) && !NOT_UNITS_AS_WORDS.has(run)) {
        this.i += run.length;
        this.emitUnit(run);
        return;
      }
      if (run.length >= 3 && NOT_UNITS_AS_WORDS.has(run.toLowerCase())) {
        this.i += run.length;
        this.meta.hasText = true;
        return;
      }
    }
    // single letters (LaTeX convention: xy = x*y)
    this.i += 1;
    this.emitIdentifier(run[0]);
  }

  /** plain-text word (calculator input) */
  private parseWord(word: string): void {
    if (word === "to" || word === "in") {
      this.emit("op", "to");
      return;
    }
    if (word === "of") {
      this.emitOf();
      return;
    }
    if (FUNCTION_WORDS[word]) {
      this.parseFunction(FUNCTION_WORDS[word]);
      return;
    }
    if (word === "pi" || word === "e" || word === "Infinity" || word === "hbar") {
      this.emitConstant(word);
      return;
    }
    if (GREEK.has(word)) {
      this.emitIdentifier(word);
      return;
    }
    // `g` is gravity unless it directly follows a number (5 g)
    if (word === "g" && this.lastToken()?.kind !== "num") {
      this.emitIdentifier(word);
      return;
    }
    if (this.isUnitName(word)) {
      this.emitUnit(word);
      return;
    }
    this.emitIdentifier(word);
  }

  /** `15\%` -> `15 / 100`; the flag keeps percentage answers decimal (0.45, never 9/20). */
  private emitPercent(): void {
    this.meta.hasPercent = true;
    this.emit("op", "/");
    this.emit("num", "100");
  }

  /**
   * `of` between two quantities is multiplication in school maths (`15% of 80`, `\frac{1}{2}
   * of 40`). Only after something to multiply: a stray `of` is prose.
   */
  private emitOf(): void {
    const last = this.lastToken();
    if (!last || !VALUE_END.has(last.kind)) {
      this.meta.hasText = true;
      return;
    }
    this.emit("op", "*");
  }

  private emitIdentifier(name: string): void {
    if (name === "e") {
      this.emitConstant("e");
      return;
    }
    this.emit("id", name);
  }

  private emitConstant(name: string): void {
    this.meta.constants.add(name);
    this.emit("const", name);
  }

  private emitUnit(name: string): void {
    const aliased = UNIT_ALIASES[name] ?? name;
    this.meta.units.add(aliased);
    if (aliased === "deg" || aliased === "degree") this.meta.hasDegrees = true;
    this.emit("unit", /^[a-zA-Z]+$/.test(aliased) ? aliased : `(${aliased})`);
  }

  private parseSuperscript(): void {
    const raw = this.readScriptArg().trim();
    if (raw === "\\circ" || raw === "\\degree" || raw === "°") {
      this.meta.hasDegrees = true;
      this.meta.units.add("deg");
      this.emit("unit", "deg");
      return;
    }
    if (raw === "") throw new UnsupportedLatex("empty exponent");
    if (raw === "\\prime" || raw === "'") throw new UnsupportedLatex("prime");
    this.emit("op", "^");
    if (/^-?[0-9]+(\.[0-9]+)?$/.test(raw)) {
      this.emit(raw.startsWith("-") ? "group" : "num", raw.startsWith("-") ? `(${raw})` : raw);
      return;
    }
    if (/^[a-zA-Z]$/.test(raw)) {
      this.emitIdentifier(raw);
      return;
    }
    this.emit("group", `(${this.sub(raw)})`);
  }

  private parseSubscript(): void {
    const raw = this.readScriptArg();
    const last = this.lastToken();
    const sub = sanitizeSubscript(this.sub(raw));
    if (!last || !sub) return;
    if (last.kind === "id" || last.kind === "const") {
      const merged = `${last.text}_${sub}`;
      if (CONSTANT_IDS.has(merged)) {
        this.tokens.pop();
        this.emitConstant(merged);
      } else {
        last.kind = "id";
        last.text = merged;
      }
      return;
    }
    if (last.kind === "unit") {
      // O_2 style subscripts on units are meaningless; ignore
      return;
    }
  }

  private parseCommand(): void {
    const name = this.readCommandName();
    if (SPACING.has(name)) return;
    if (name === "left" || name === "right") {
      this.skipSpaces();
      if (this.peek() === ".") this.i++;
      return;
    }
    if (name === "{") {
      this.emit("open", "(");
      return;
    }
    if (name === "}") {
      this.emit("close", ")");
      return;
    }
    if (name === "|" || name === "lvert" || name === "rvert" || name === "vert") {
      this.toggleAbs();
      return;
    }
    if (name === "%") {
      if (this.lastToken() && this.lastToken()!.kind !== "op") this.emitPercent();
      return;
    }
    if (name === "#" || name === "_" || name === "$" || name === "colon") return;
    if (name === "cdot" || name === "times" || name === "ast" || name === "bullet" || name === "star") {
      this.emit("op", "*");
      return;
    }
    if (name === "div" || name === "slash") {
      this.emit("op", "/");
      return;
    }
    if (name === "bmod" || name === "mod" || name === "pmod") {
      this.emit("op", "mod");
      return;
    }
    if (name === "pm") {
      this.meta.hasPm = true;
      this.emit("pm", PM_PLUS);
      return;
    }
    if (name === "mp") {
      this.meta.hasPm = true;
      this.emit("pm", PM_MINUS);
      return;
    }
    if (RELATION_COMMANDS[name]) {
      this.emit("rel", RELATION_COMMANDS[name] === APPROX_OP ? "==" : RELATION_COMMANDS[name]);
      return;
    }
    if (name === "to" || name === "rightarrow" || name === "longrightarrow" || name === "mapsto") {
      this.emit("op", "to");
      return;
    }
    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      this.parseFrac();
      return;
    }
    if (name === "sqrt") {
      const index = this.readOptional();
      const arg = this.readGroup() ?? this.readImplicitArgument();
      if (arg === null || !arg.trim()) throw new UnsupportedLatex("sqrt without argument");
      const inner = this.sub(arg);
      if (index !== null && index.trim()) {
        this.meta.functions.add("nthRoot");
        this.emit("group", `nthRoot(${inner}, ${this.sub(index)})`);
      } else {
        this.meta.functions.add("sqrt");
        this.emit("group", `sqrt(${inner})`);
      }
      return;
    }
    if (name === "pi") {
      this.emitConstant("pi");
      return;
    }
    if (name === "hbar") {
      this.emitConstant("hbar");
      return;
    }
    if (name === "infty") {
      this.emitConstant("Infinity");
      return;
    }
    if (name === "circ" || name === "degree") {
      this.meta.hasDegrees = true;
      this.meta.units.add("deg");
      this.emit("unit", "deg");
      return;
    }
    if (GREEK.has(name) || GREEK_ALIAS[name]) {
      const greek = GREEK_ALIAS[name] ?? name;
      if (greek === "Delta") {
        this.skipSpaces();
        const m = /^[a-zA-Z]/.exec(this.src.slice(this.i));
        if (m) {
          this.i += 1;
          this.emit("id", `Delta_${m[0]}`);
          return;
        }
      }
      this.emitIdentifier(greek);
      return;
    }
    if (FUNCTION_WORDS[name]) {
      this.parseFunction(FUNCTION_WORDS[name]);
      return;
    }
    if (TEXT_COMMANDS.has(name)) {
      const raw = this.readGroup();
      if (raw === null) return;
      this.parseTextGroup(raw);
      return;
    }
    if (WRAPPERS.has(name)) {
      const raw = this.readGroup();
      if (raw === null) return;
      const inner = raw.trim();
      if (/^[a-zA-Z]$/.test(inner)) this.emitIdentifier(inner);
      else if (inner) this.emit("group", `(${this.sub(inner)})`);
      return;
    }
    if (name === "int") {
      this.parseIntegral();
      return;
    }
    if (name === "sum") {
      this.parseSum();
      return;
    }
    if (name === "hspace" || name === "vspace" || name === "phantom") {
      this.readGroup();
      return;
    }
    if (UNSUPPORTED_COMMANDS.has(name) || IMPLICATION_COMMANDS.has(name)) throw new UnsupportedLatex(`\\${name}`);
    throw new UnsupportedLatex(`\\${name}`);
  }

  /** words inside \mathrm{} / \text{}: units, function names, `to`, or prose */
  private parseTextGroup(raw: string): void {
    const content = raw.replace(/~/g, " ").replace(/\\[,;:!]/g, " ").replace(/\s+/g, " ").trim();
    if (!content) return;
    if (content === "in" && this.lastToken()?.kind === "num") {
      this.emitUnit("in");
      return;
    }
    if (content === "to" || content === "in") {
      this.emit("op", "to");
      return;
    }
    if (content === "of") {
      this.emitOf();
      return;
    }
    if (FUNCTION_WORDS[content]) {
      this.parseFunction(FUNCTION_WORDS[content]);
      return;
    }
    if (content === "e") {
      this.emitConstant("e");
      return;
    }
    if (content === "deg" || content === "\\circ" || content === "°") {
      this.meta.hasDegrees = true;
      this.meta.units.add("deg");
      this.emit("unit", "deg");
      return;
    }
    const unitSource = this.unitExpression(content);
    if (unitSource !== null) {
      this.meta.units.add(unitSource);
      this.emit("unit", /^[a-zA-Z]+$/.test(unitSource) ? unitSource : `(${unitSource})`);
      return;
    }
    if (/^[a-zA-Z]$/.test(content)) {
      this.emitIdentifier(content);
      return;
    }
    if (/^[a-zA-Z_]+$/.test(content) && content.length <= 3) {
      this.emit("id", content);
      return;
    }
    this.meta.hasText = true;
  }

  /** `km/h`, `m/s^2`, `kg m`, `N \cdot m` -> mathjs unit source, or null when a word is not a unit */
  private unitExpression(content: string): string | null {
    const cleaned = content
      .replace(/\\cdot|\\times|·|⋅/g, "*")
      .replace(/\{|\}/g, "")
      .replace(/\\mathrm|\\text|\\rm/g, "")
      .replace(/°C/g, "degC")
      .replace(/°F/g, "degF")
      .replace(/Ω|\\Omega|\\ohm/g, "ohm")
      .replace(/μ|\\mu/g, "u")
      .trim();
    if (!cleaned) return null;
    const words = cleaned.match(/[a-zA-Z]+/g) ?? [];
    if (words.length === 0) return null;
    for (const w of words) {
      const candidate = UNIT_ALIASES[w] ?? w;
      const baseName = candidate.replace(/[^a-zA-Z].*$/, "");
      if (!this.isUnitName(baseName) || NOT_UNITS_AS_WORDS.has(w)) return null;
    }
    let out = cleaned.replace(/[a-zA-Z]+/g, (w) => UNIT_ALIASES[w] ?? w);
    out = out.replace(/([a-zA-Z0-9)])\s+([a-zA-Z(])/g, "$1*$2");
    out = out.replace(/\s+/g, "");
    if (out === "deg" || out === "degree") this.meta.hasDegrees = true;
    return out;
  }

  private parseFrac(): void {
    const numRaw = this.readGroup();
    const denRaw = numRaw === null ? null : this.readGroup();
    if (numRaw === null || denRaw === null) throw new UnsupportedLatex("\\frac without two arguments");
    const num = numRaw.trim();
    const den = denRaw.trim();
    const dm = /^(?:\\mathrm\{d\}|d)\s*(\\?[a-zA-Z]+)$/.exec(den);
    // `\frac{dy}{dx}`: the engine cannot know y here. index.ts rewrites it against an earlier
    // `y = ...` line before translation; anything else stays unsupported.
    if (dm && /^(?:\\mathrm\{d\}|d)\s*(?:\^\{?\d\}?)?\s*(\\?[a-zA-Z]+)$/.test(num)) {
      throw new UnsupportedLatex("Leibniz derivative notation");
    }
    if ((num === "d" || num === "\\mathrm{d}") && dm) {
      this.emitDerivative(this.sub(dm[1]), 1);
      return;
    }
    // \frac{d^2}{dx^2}, \frac{d^{3}}{dx^{3}}: repeated differentiation in the same variable
    const nth = /^(?:\\mathrm\{d\}|d)\s*\^\s*\{?\s*([2-9])\s*\}?$/.exec(num);
    const dnth = nth && /^(?:\\mathrm\{d\}|d)\s*(\\?[a-zA-Z]+)\s*\^\s*\{?\s*([2-9])\s*\}?$/.exec(den);
    if (nth && dnth && dnth[2] === nth[1]) {
      this.emitDerivative(this.sub(dnth[1]), Number(nth[1]));
      return;
    }
    if (!num || !den) throw new UnsupportedLatex("empty fraction");
    this.emit("group", `((${this.sub(num)})/(${this.sub(den)}))`);
  }

  /** `\frac{d}{dx} <rest>` -> `derivative("<rest>", "x")`, nested `order` times. */
  private emitDerivative(variable: string, order: number): void {
    const operandRaw = this.readOperandRest();
    if (!operandRaw.trim()) throw new UnsupportedLatex("derivative without operand");
    // `\frac{d}{dx} f(x)`: juxtaposition would read f as a constant factor and answer `f`.
    // A function the engine does not know cannot be differentiated, so it is refused instead.
    if (unknownFunctionCall(operandRaw)) throw new UnsupportedLatex("derivative of an unknown function");
    const operand = this.sub(operandRaw);
    this.meta.functions.add("derivative");
    const name = JSON.stringify(variable);
    let call = `derivative(${JSON.stringify(operand)}, ${name})`;
    for (let k = 1; k < order; k++) call = `derivative(${call}, ${name})`;
    this.emit("group", call);
  }

  /**
   * `\sum_{i=1}^{10} i` -> `summation("i", "i", 1, 10)`. The summand runs to the end of the
   * current group; a summand with a top-level `+`/`-` (`\sum_{i=1}^{3} i + 1`) is ambiguous on
   * paper, so it is refused rather than guessed.
   */
  private parseSum(): void {
    let index: string | null = null;
    let lower: string | null = null;
    let upper: string | null = null;
    for (let guard = 0; guard < 2; guard++) {
      this.skipSpaces();
      if (this.peek() === "_") {
        this.i++;
        const raw = this.readScriptArg().replace(/\\[,;:! ]/g, " ").trim();
        const m = /^([a-zA-Z])\s*=\s*(\S[\s\S]*)$/.exec(raw);
        if (!m) throw new UnsupportedLatex("sum without an index");
        index = m[1];
        lower = this.sub(m[2]);
      } else if (this.peek() === "^") {
        this.i++;
        upper = this.sub(this.readScriptArg());
      }
    }
    if (index === null || lower === null || upper === null) throw new UnsupportedLatex("sum without limits");
    const bodyRaw = this.readOperandRest();
    if (!bodyRaw.trim()) throw new UnsupportedLatex("sum without a summand");
    if (hasTopLevelAddition(bodyRaw)) throw new UnsupportedLatex("ambiguous summand");
    const bound = !this.meta.variables.has(index);
    const body = this.sub(bodyRaw);
    if (bound) this.meta.variables.delete(index);
    this.meta.functions.add("summation");
    this.emit("group", `summation(${JSON.stringify(body)}, ${JSON.stringify(index)}, ${lower}, ${upper})`);
  }

  /** raw text from the cursor to the end of this level (stops at an unmatched `)`), consumed */
  private readOperandRest(): string {
    let depth = 0;
    let k = this.i;
    for (; k < this.src.length; k++) {
      const ch = this.src[k];
      if (ch === "\\") {
        k++;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0) break;
        depth--;
      }
    }
    const raw = this.src.slice(this.i, k);
    this.i = k;
    return raw;
  }

  /** greedy implicit argument: `\sin 30^\circ`, `\ln 2x`, `\sqrt x` */
  private readImplicitArgument(): string | null {
    const start = this.tokens.length;
    const rawStart = this.i;
    let consumed = false;
    while (this.startsAtom()) {
      const before = this.i;
      this.parseItem();
      consumed = true;
      if (this.i === before) break;
    }
    if (!consumed) return null;
    const rawEnd = this.i;
    this.tokens.splice(start);
    return this.src.slice(rawStart, rawEnd);
  }

  private parseFunction(fn: string): void {
    let name = fn;
    let power: string | null = null;
    let base: string | null = null;
    for (let guard = 0; guard < 2; guard++) {
      this.skipSpaces();
      if (this.peek() === "^") {
        this.i++;
        const raw = this.readScriptArg().trim();
        if (raw === "-1" && INVERSE[name]) name = INVERSE[name];
        else if (raw) power = this.sub(raw);
      } else if (this.peek() === "_") {
        this.i++;
        const raw = this.readScriptArg().trim();
        if (raw) base = this.sub(raw);
      }
    }
    if (name === "log10" && base !== null) name = base === "10" ? "log10" : "log";
    if (name === "log" && base === "10") {
      name = "log10";
      base = null;
    }
    const paren = this.readParenthesized();
    const argRaw = paren !== null ? paren : this.readImplicitArgument();
    if (argRaw === null || !argRaw.trim()) throw new UnsupportedLatex(`${fn} without argument`);
    const arg = this.sub(argRaw);
    this.meta.functions.add(name);
    let call = base !== null && name === "log" ? `log(${arg}, ${base})` : `${name}(${arg})`;
    if (power !== null) call = `(${call})^(${power})`;
    this.emit("group", call);
  }

  private parseIntegral(): void {
    let lower: string | null = null;
    let upper: string | null = null;
    for (let guard = 0; guard < 2; guard++) {
      this.skipSpaces();
      if (this.peek() === "_") {
        this.i++;
        lower = this.sub(this.readScriptArg());
      } else if (this.peek() === "^") {
        this.i++;
        upper = this.sub(this.readScriptArg());
      }
    }
    if (lower === null || upper === null) throw new UnsupportedLatex("indefinite integral");
    const rest = this.src.slice(this.i);
    const m = /(?:^|[^a-zA-Z\\])(?:\\[,;:! ]\s*|\s)*(?:\\mathrm\{\s*d\s*\}|d)\s*(\\[a-zA-Z]+|[a-zA-Z])(?![a-zA-Z])/.exec(rest);
    if (!m) throw new UnsupportedLatex("integral without dx");
    const integrandEnd = m.index + (m[0].startsWith("d") || m[0].startsWith("\\") || m[0].startsWith(" ") ? 0 : 1);
    const integrandRaw = rest.slice(0, integrandEnd);
    if (!integrandRaw.trim()) throw new UnsupportedLatex("integral without integrand");
    const seen = new Set(this.meta.variables);
    const variable = this.sub(m[1]);
    const integrand = this.sub(integrandRaw);
    // the integration variable is bound by `dx` unless the line also uses it free
    if (!seen.has(variable)) this.meta.variables.delete(variable);
    this.i += m.index + m[0].length;
    this.meta.functions.add("integral");
    this.emit("group", `integral(${JSON.stringify(integrand)}, ${JSON.stringify(variable)}, ${lower}, ${upper})`);
  }
}

interface Meta {
  variables: Set<string>;
  units: Set<string>;
  functions: Set<string>;
  constants: Set<string>;
  hasText: boolean;
  hasDegrees: boolean;
  hasPm: boolean;
  hasPercent: boolean;
}

const FUNCTION_CALL = /(?:^|[^a-zA-Z\\])(?:([fgh])|\\([a-zA-Z]+))\s*(?:\\left\s*)?\(/g;

/**
 * `f(x)`, `g(t)`, `\Gamma(x)`: a name the engine has no definition for, applied to an argument.
 * Everywhere else juxtaposition is multiplication (`2(x+1)`, `a(x+1)`), so this is limited to the
 * f/g/h convention the rest of the engine already uses plus Greek names -- `\sin(x)` and
 * `\left(...\right)` are known and stay.
 */
function unknownFunctionCall(src: string): boolean {
  const re = new RegExp(FUNCTION_CALL.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) return true;
    const name = m[2] ?? "";
    if (GREEK.has(name) || name in GREEK_ALIAS) return true;
    re.lastIndex = m.index + 1; // matches may overlap: `\left(f(x)\right)`
  }
  return false;
}

/** `+` or `-` outside every bracket, with something before it (a leading sign does not count). */
function hasTopLevelAddition(src: string): boolean {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if ((ch === "+" || ch === "-") && depth === 0 && src.slice(0, i).trim() !== "") return true;
  }
  return false;
}

function sanitizeSubscript(sub: string): string {
  return sub
    .replace(/[()]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const VALUE_END = new Set<string>(["num", "id", "unit", "const", "group", "close", "fac"]);
const VALUE_START = new Set<string>(["num", "id", "const", "group", "open", "unit", "fnname"]);

/** joins tokens into mathjs source, making implicit multiplication explicit */
export function assemble(tokens: Token[]): string {
  let out = "";
  let prev: Token | null = null;
  for (const tok of tokens) {
    const kind = tok.kind;
    if (prev && kind === "open" && prev.kind === "fnname") {
      // abs( -- no separator
    } else if (prev && VALUE_END.has(prev.kind) && VALUE_START.has(kind)) {
      if (kind === "unit" && (prev.kind === "num" || prev.kind === "unit" || prev.kind === "const" || prev.kind === "group" || prev.kind === "close")) out += " ";
      else out += " * ";
    } else if (prev && (kind === "op" || kind === "rel" || prev.kind === "op" || prev.kind === "rel")) {
      out += " ";
    } else if (prev && kind === "comma") {
      out += "";
    } else if (prev && prev.kind === "comma") {
      out += " ";
    }
    out += tok.text;
    prev = tok;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Single-letter unit names that students actually write after numbers (m, s, g, h, N, J, W, C, V, A, K, L, F). */
export const LETTER_UNITS = new Set(["m", "s", "g", "h", "N", "J", "W", "C", "V", "A", "K", "L", "F"]);

const MUL_DIV = new Set(["*", "/"]);
const ANY_ARITH = new Set(["*", "/", "+", "-"]);

/**
 * `9.8 m/s^2`, `2 m + 3 cm`, `m + cm`: promote single-letter identifiers to units when the line
 * already carries a unit (a multi-letter/\mathrm unit, or a number followed by letter/letter).
 */
function promoteLetterUnits(tokens: Token[], meta: Meta, isUnit: (name: string) => boolean): void {
  const hasDefiniteUnit = tokens.some((t) => t.kind === "unit");
  const numberLetterSlash = tokens.some(
    (t, i) =>
      t.kind === "num" &&
      tokens[i + 1]?.kind === "id" &&
      LETTER_UNITS.has(tokens[i + 1].text) &&
      tokens[i + 2]?.kind === "op" &&
      tokens[i + 2].text === "/" &&
      tokens[i + 3]?.kind === "id" &&
      LETTER_UNITS.has(tokens[i + 3].text),
  );
  if (!hasDefiniteUnit && !numberLetterSlash) return;
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 8) {
    changed = false;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind !== "id" || !LETTER_UNITS.has(t.text) || !isUnit(t.text)) continue;
      const prev = tokens[i - 1];
      const prev2 = tokens[i - 2];
      const next = tokens[i + 1];
      const next2 = tokens[i + 2];
      const afterNumber = prev?.kind === "num";
      const afterUnitOp = prev?.kind === "op" && MUL_DIV.has(prev.text) && prev2?.kind === "unit";
      const beforeUnitOp = next?.kind === "op" && ANY_ARITH.has(next.text) && next2?.kind === "unit";
      const afterUnitAdd = prev?.kind === "op" && ANY_ARITH.has(prev.text) && prev2?.kind === "unit" && !afterNumber;
      const conversionTarget = prev?.kind === "op" && prev.text === "to" && (prev2?.kind === "unit" || prev2?.kind === "num");
      // `g` is gravity unless it directly follows a number (5 g)
      const allowed = t.text === "g" ? afterNumber : afterNumber || afterUnitOp || beforeUnitOp || afterUnitAdd || conversionTarget;
      if (allowed) {
        const aliased = UNIT_ALIASES[t.text] ?? t.text;
        t.kind = "unit";
        t.text = aliased;
        meta.units.add(aliased);
        changed = true;
      }
    }
  }
}

function collectVariables(tokens: Token[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (t.kind !== "id") continue;
    if (CONSTANT_IDS.has(t.text) || FUNCTION_WORDS[t.text]) continue;
    if (!seen.has(t.text)) {
      seen.add(t.text);
      out.push(t.text);
    }
  }
  return out;
}

/**
 * Translates one LaTeX expression (no top-level relation) to mathjs source.
 * @throws UnsupportedLatex
 */
export function latexToMath(latex: string, opts: TranslateOptions = {}): Translated {
  const src = opts.plain ? preprocessPlain(latex) : preprocessLatex(latex);
  const meta: Meta = { variables: new Set(), units: new Set(), functions: new Set(), constants: new Set(), hasText: false, hasDegrees: false, hasPm: false, hasPercent: false };
  const scanner = new Scanner(src, opts, meta);
  scanner.parseAll();
  const tokens = scanner.tokens;
  if (!opts.plain && opts.letterUnits !== false) {
    promoteLetterUnits(tokens, meta, (name) => {
      if (opts.isUnit) {
        try {
          return opts.isUnit(name);
        } catch {
          return false;
        }
      }
      return DEFAULT_UNITS.has(name);
    });
  }
  for (const v of collectVariables(tokens)) meta.variables.add(v);
  const joined = assemble(tokens);
  const branches = meta.hasPm
    ? [joined.replace(new RegExp(PM_PLUS, "g"), "+").replace(new RegExp(PM_MINUS, "g"), "-"), joined.replace(new RegExp(PM_PLUS, "g"), "-").replace(new RegExp(PM_MINUS, "g"), "+")]
    : [joined];
  return {
    source: branches[0],
    branches,
    variables: [...meta.variables],
    units: [...meta.units],
    functions: [...meta.functions],
    constants: [...meta.constants],
    hasUnits: meta.units.size > 0,
    hasDegrees: meta.hasDegrees,
    hasText: meta.hasText,
    hasPm: meta.hasPm,
    hasPercent: meta.hasPercent,
  };
}
