/**
 * A figure's labels as values. Pure: no engine, no DOM.
 *
 * A label is what the student wrote on the drawing: a number (`70°`, `5`, `4.5 cm`), the unknown
 * (`x`, `y`, `θ`, `x°`, `?`), an expression in it (`2x + 10`, `(3x - 5)^{\circ}`, `\frac{x}{2}`), or
 * a name (a vertex `A`, a line `l`). `parseLabel` turns the LaTeX the recognizer (or the model)
 * returned into a linear form a·v + b in at most one letter, plus the LaTeX the tutor writes it with
 * (degree marks and units off, spacing tidied, the student's own form kept: `2x + 10`, not `10 + 2x`).
 */

/** Greek letters a student uses for an angle (`\theta` is a letter, like `x`). */
export const GREEK_LETTERS = ["alpha", "beta", "gamma", "delta", "theta", "phi", "varphi", "psi", "omega"] as const;

/**
 * Lone letters that name a LINE in school figures (`l ∥ m`, transversal `t`) rather than an
 * unknown — the unasked trigger does not fire for them alone. `e` and `i` are constants to the
 * engine, `o` is a circle's centre read in lower case.
 */
export const LINE_NAME_LETTERS: ReadonlySet<string> = new Set(["l", "m", "n", "p", "q", "r", "s", "t", "k", "j", "i", "o", "e"]);

export interface LabelValue {
  /** the value is a·letter + b (a = 0 for a number) */
  a: number;
  b: number;
  /** the one letter in it (`x`, `\theta`), or null for a number */
  letter: string | null;
  /** the LaTeX the tutor writes for it: degree marks, units and outer brackets off */
  latex: string;
  /** a degree mark was written on it */
  degrees: boolean;
}

export type ParsedLabel =
  | { kind: "value"; value: LabelValue }
  /** `?`: the unknown with no letter of its own */
  | { kind: "unknown"; degrees: boolean }
  /** a capital letter (a vertex), or a word: it names something, it is not a value */
  | { kind: "name"; name: string }
  | { kind: "unreadable" };

type Tok =
  | { t: "num"; v: number; s: string }
  | { t: "var"; s: string }
  | { t: "op"; s: "+" | "-" | "*" }
  | { t: "(" }
  | { t: ")" }
  | { t: "frac" }
  | { t: "{" }
  | { t: "}" };

const DEGREE = /\^\s*\{\s*\\circ\s*\}|\^\s*\\circ|\\circ|°|\\degree|\^\s*\{\s*[oO0]\s*\}\s*$|\^\s*[oO]\s*$/g;
const UNITS = /\\(?:text|mathrm|textrm|mbox)\s*\{\s*(?:cm|mm|m|km|in|ft|units?|deg|degrees)\s*\}|\b(?:cm|mm|km|ft|in|units?)\b/g;

const UNICODE: Record<string, string> = {
  θ: "\\theta",
  α: "\\alpha",
  β: "\\beta",
  γ: "\\gamma",
  δ: "\\delta",
  φ: "\\phi",
  ψ: "\\psi",
  ω: "\\omega",
  "−": "-",
  "–": "-",
  "·": "\\cdot ",
  "×": "\\times ",
};

/**
 * Unicode a model writes for what the recognizer writes as LaTeX: `θ` is `\theta`, `−` is `-`. (A
 * degree sign is left alone: the label parser reads it as one.)
 */
export function unicodeToLatex(s: string): string {
  return (s ?? "").replace(/[θαβγδφψω−–·×]/g, (ch) => UNICODE[ch] ?? ch);
}

/** Degree marks and units off; `\left( … \right)`, `\,` and sizing gone. */
function strip(raw: string): { s: string; degrees: boolean } {
  let s = unicodeToLatex(raw ?? "").trim().replace(/^\$+|\$+$/g, "");
  const degrees = /\\circ|°|\\degree|\^\s*\{\s*[oO0]\s*\}\s*$/.test(s);
  s = s.replace(DEGREE, "").replace(UNITS, "");
  s = s
    .replace(/\\(?:left|right|big|Big|bigl|bigr)(?![a-zA-Z])/g, "")
    .replace(/\\[,;:! ]|~/g, " ")
    .replace(/\\dfrac|\\tfrac/g, "\\frac")
    .replace(/\\(?:times|cdot)(?![a-zA-Z])/g, "*")
    .replace(/\\(?:mathrm|text|textrm|mbox)\s*\{\s*([^{}]*?)\s*\}/g, "$1")
    .trim();
  return { s, degrees };
}

function tokenize(s: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(s.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]), s: num[0] });
      i += num[0].length;
      continue;
    }
    if (ch === "\\") {
      const cmd = /^\\([a-zA-Z]+)/.exec(s.slice(i));
      if (!cmd) return null;
      i += cmd[0].length;
      if (cmd[1] === "frac") out.push({ t: "frac" });
      else if ((GREEK_LETTERS as readonly string[]).includes(cmd[1])) out.push({ t: "var", s: `\\${cmd[1]}` });
      else return null;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      out.push({ t: "var", s: ch });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*") out.push({ t: "op", s: ch });
    else if (ch === "−") out.push({ t: "op", s: "-" });
    else if (ch === "(" || ch === "[") out.push({ t: "(" });
    else if (ch === ")" || ch === "]") out.push({ t: ")" });
    else if (ch === "{") out.push({ t: "{" });
    else if (ch === "}") out.push({ t: "}" });
    else return null;
    i++;
  }
  return out;
}

type Lin = { a: number; b: number; letter: string | null };

class Parser {
  private i = 0;
  constructor(private readonly toks: Tok[]) {}
  done(): boolean {
    return this.i >= this.toks.length;
  }
  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private take(): Tok | undefined {
    return this.toks[this.i++];
  }
  private expect(t: Tok["t"]): void {
    if (this.take()?.t !== t) throw new Error(`expected ${t}`);
  }
  expr(): Lin {
    let acc = this.term();
    for (;;) {
      const p = this.peek();
      if (p?.t !== "op" || p.s === "*") return acc;
      this.take();
      const rhs = this.term();
      acc = add(acc, p.s === "-" ? scale(rhs, -1) : rhs);
    }
  }
  private term(): Lin {
    let acc = this.factor();
    for (;;) {
      const p = this.peek();
      if (p?.t === "op" && p.s === "*") {
        this.take();
        acc = mul(acc, this.factor());
        continue;
      }
      // juxtaposition: `2x`, `2(x + 1)`, `\frac{1}{2}x`, `x\frac{1}{2}`
      if (p && (p.t === "num" || p.t === "var" || p.t === "(" || p.t === "frac" || p.t === "{")) {
        acc = mul(acc, this.factor());
        continue;
      }
      return acc;
    }
  }
  private factor(): Lin {
    const tok = this.take();
    if (!tok) throw new Error("end");
    switch (tok.t) {
      case "op":
        if (tok.s === "*") throw new Error("stray *");
        return tok.s === "-" ? scale(this.factor(), -1) : this.factor();
      case "num":
        return { a: 0, b: tok.v, letter: null };
      case "var":
        return { a: 1, b: 0, letter: tok.s };
      case "(": {
        const v = this.expr();
        this.expect(")");
        return v;
      }
      case "{": {
        const v = this.expr();
        this.expect("}");
        return v;
      }
      case "frac": {
        this.expect("{");
        const n = this.expr();
        this.expect("}");
        this.expect("{");
        const d = this.expr();
        this.expect("}");
        if (d.a !== 0 || d.b === 0) throw new Error("not a number under the bar");
        return scale(n, 1 / d.b);
      }
      default:
        throw new Error(`unexpected ${tok.t}`);
    }
  }
}

function add(p: Lin, q: Lin): Lin {
  if (p.letter && q.letter && p.letter !== q.letter && p.a !== 0 && q.a !== 0) throw new Error("two letters");
  return { a: p.a + q.a, b: p.b + q.b, letter: p.letter ?? q.letter };
}
function scale(p: Lin, k: number): Lin {
  return { a: p.a * k, b: p.b * k, letter: p.letter };
}
function mul(p: Lin, q: Lin): Lin {
  if (p.a !== 0 && q.a !== 0) throw new Error("not linear");
  if (p.a === 0) return { a: q.a * p.b, b: q.b * p.b, letter: q.letter };
  return { a: p.a * q.b, b: p.b * q.b, letter: p.letter };
}

/** Prints the tokens back as the student wrote them, tidily spaced: `2 x+10` → `2x + 10`. */
function print(toks: Tok[]): string {
  let out = "";
  let prev: Tok | undefined;
  for (const tok of toks) {
    const unary = tok.t === "op" && (tok.s === "-" || tok.s === "+") && (!prev || prev.t === "op" || prev.t === "(" || prev.t === "{");
    switch (tok.t) {
      case "num":
        out += tok.s;
        break;
      case "var":
        out += tok.s;
        break;
      case "op":
        if (tok.s === "*") out += " \\cdot ";
        else out += unary ? tok.s : ` ${tok.s} `;
        break;
      case "(":
        out += "(";
        break;
      case ")":
        out += ")";
        break;
      case "frac":
        out += "\\frac";
        break;
      case "{":
        out += "{";
        break;
      case "}":
        out += "}";
        break;
    }
    prev = tok;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Outer brackets round the whole label (`(3x - 5)°`) off. */
function unwrapOuter(toks: Tok[]): Tok[] {
  let cur = toks;
  while (cur.length >= 2 && cur[0].t === "(" && cur[cur.length - 1].t === ")") {
    let depth = 0;
    let closesAtEnd = true;
    for (let k = 0; k < cur.length; k++) {
      if (cur[k].t === "(") depth++;
      else if (cur[k].t === ")") depth--;
      if (depth === 0 && k < cur.length - 1) {
        closesAtEnd = false;
        break;
      }
    }
    if (!closesAtEnd) break;
    cur = cur.slice(1, -1);
  }
  return cur;
}

/**
 * A label as a value. `asked`: letters the student asked for on a line (`A = ?`), which count as
 * the unknown even when they are capitals (otherwise a capital alone is a vertex's name).
 */
export function parseLabel(raw: string, asked: ReadonlySet<string> = new Set()): ParsedLabel {
  const { s, degrees } = strip(raw);
  if (!s) return { kind: "unreadable" };
  if (/^\\?\?$/.test(s)) return { kind: "unknown", degrees };
  if (/^[A-Z]$/.test(s) && !asked.has(s)) return { kind: "name", name: s };
  if (/^[A-Za-z]{2,}$/.test(s) && !/^\\/.test(s)) return { kind: "name", name: s };
  const toks = tokenize(s);
  if (!toks || toks.length === 0) return { kind: "unreadable" };
  const body = unwrapOuter(toks);
  let lin: Lin;
  try {
    const p = new Parser(body);
    lin = p.expr();
    if (!p.done()) return { kind: "unreadable" };
  } catch {
    return { kind: "unreadable" };
  }
  if (!Number.isFinite(lin.a) || !Number.isFinite(lin.b)) return { kind: "unreadable" };
  const letter = lin.a !== 0 ? lin.letter : null;
  return { kind: "value", value: { a: letter ? lin.a : 0, b: lin.b, letter, latex: print(body), degrees } };
}

/** A label's text compared loosely: degree marks, units, spaces, braces and case ignored. */
export function labelKey(raw: string): string {
  const { s } = strip(raw);
  return s
    .replace(/[\s{}]/g, "")
    .replace(/^\((.*)\)$/, "$1")
    .toLowerCase();
}

/**
 * Does this label, read on a drawing, look like something asked for — an unknown to find? `?`, a
 * lone letter that is not a line's or a vertex's name (`x`, `y`, `a`, `θ`), or an expression with a
 * letter in it (`2x + 10`, `x°`). The unasked trigger's test; the model decides the rest.
 */
export function looksLikeUnknown(raw: string): boolean {
  const p = parseLabel(raw);
  if (p.kind === "unknown") return true;
  if (p.kind !== "value" || !p.value.letter) return false;
  const lone = p.value.a === 1 && p.value.b === 0 && !p.value.degrees;
  return !(lone && LINE_NAME_LETTERS.has(p.value.letter));
}

/** A label that is a number or an expression (not a name, not unreadable): it must be in the read. */
export function isValueLabel(raw: string): boolean {
  const p = parseLabel(raw);
  if (p.kind === "unknown") return true;
  if (p.kind !== "value") return false;
  // a lone line-name letter (`l`, `m`, `t`) may be a line's name: the read need not list it
  return !(p.value.letter && p.value.a === 1 && p.value.b === 0 && !p.value.degrees && LINE_NAME_LETTERS.has(p.value.letter));
}

/** A number as the tutor writes it: an integer, else at most 4 decimals. */
export function formatNumber(v: number): string {
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return String(Number(v.toFixed(4)));
}
