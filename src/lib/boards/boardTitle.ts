/**
 * Board names from the maths on the board.
 *
 * A new board is inserted as "Untitled Whiteboard" (the column default). While the student
 * works, the board page names it from the first line of maths Live read
 * (`useBoardAutoTitle`), written as readable plain text: `x^{2}-5 x+6=0` becomes
 * "x² − 5x + 6 = 0". Plain text rather than LaTeX because the title is also what the
 * rename dialog edits, what search matches and what the delete dialog quotes.
 *
 * Pure: no React, no network. Tested in `__tests__/boardTitle.test.ts`.
 */

/** What `whiteboards.title` holds until the student or the auto-namer changes it. */
export const DEFAULT_BOARD_TITLE = "Untitled Whiteboard";

/** Longest auto-generated title; the column allows 200, a card shows about 40. */
export const MAX_AUTO_TITLE_LENGTH = 60;

export function isDefaultBoardTitle(title: string | null | undefined): boolean {
  return !title || !title.trim() || title.trim() === DEFAULT_BOARD_TITLE;
}

// ---------------------------------------------------------------------------
// LaTeX -> plain text
// ---------------------------------------------------------------------------

/** How an atom spaces against its neighbours (a small subset of TeX's classes). */
type AtomKind = "ord" | "bin" | "rel" | "open" | "close" | "punct" | "op" | "text";
type Atom = { kind: AtomKind; text: string };

const SYMBOLS: Record<string, Atom> = {};
function sym(kind: AtomKind, text: string, ...names: string[]) {
  for (const n of names) SYMBOLS[n] = { kind, text };
}
sym("bin", "×", "times");
sym("bin", "·", "cdot", "bullet");
sym("bin", "÷", "div");
sym("bin", "±", "pm");
sym("bin", "∓", "mp");
sym("bin", "∪", "cup");
sym("bin", "∩", "cap");
sym("bin", "∧", "wedge", "land");
sym("bin", "∨", "vee", "lor");
sym("rel", "≤", "le", "leq", "leqslant");
sym("rel", "≥", "ge", "geq", "geqslant");
sym("rel", "≠", "ne", "neq");
sym("rel", "≈", "approx");
sym("rel", "~", "sim");
sym("rel", "≅", "cong");
sym("rel", "≡", "equiv");
sym("rel", "∝", "propto");
sym("rel", "→", "to", "rightarrow", "longrightarrow");
sym("rel", "←", "leftarrow", "gets", "longleftarrow");
sym("rel", "↔", "leftrightarrow");
sym("rel", "⇒", "Rightarrow", "implies", "Longrightarrow");
sym("rel", "⇐", "Leftarrow");
sym("rel", "⇔", "Leftrightarrow", "iff", "Longleftrightarrow");
sym("rel", "∈", "in");
sym("rel", "∉", "notin");
sym("rel", "⊂", "subset");
sym("rel", "⊆", "subseteq");
sym("rel", "⊥", "perp");
sym("rel", "∥", "parallel");
sym("rel", "|", "mid");
sym("rel", "∼", "backsim");
sym("ord", "∞", "infty");
sym("ord", "°", "degree");
sym("ord", "∘", "circ");
sym("ord", "∠", "angle", "measuredangle");
sym("ord", "△", "triangle", "bigtriangleup");
sym("ord", "□", "square", "Box");
sym("ord", "∅", "emptyset", "varnothing");
sym("ord", "∂", "partial");
sym("ord", "∇", "nabla");
sym("ord", "…", "ldots", "dots", "cdots", "dotsc", "dotsb");
sym("ord", "′", "prime");
sym("ord", "∴", "therefore");
sym("ord", "∵", "because");
sym("ord", "∀", "forall");
sym("ord", "∃", "exists");
sym("ord", "¬", "neg", "lnot");
sym("ord", "%", "%");
sym("ord", "$", "$");
sym("ord", "#", "#");
sym("ord", "&", "&");
sym("ord", "_", "_");
sym("open", "{", "{", "lbrace");
sym("close", "}", "}", "rbrace");
sym("open", "⟨", "langle");
sym("close", "⟩", "rangle");
sym("open", "⌊", "lfloor");
sym("close", "⌋", "rfloor");
sym("open", "⌈", "lceil");
sym("close", "⌉", "rceil");
sym("ord", "|", "vert", "lvert", "rvert");
sym("ord", "‖", "Vert", "lVert", "rVert", "|");
sym("op", "∫", "int");
sym("op", "∬", "iint");
sym("op", "∭", "iiint");
sym("op", "∮", "oint");
sym("op", "Σ", "sum");
sym("op", "Π", "prod");

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
  varpi: "π", rho: "ρ", varrho: "ρ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ",
  varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ",
  Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};
for (const [name, text] of Object.entries(GREEK)) SYMBOLS[name] = { kind: "ord", text };

/** Written as the word, followed by a space before a bare argument ("sin 30°", "log x"). */
const FUNCTIONS = new Set([
  "sin", "cos", "tan", "sec", "csc", "cot", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "gcd", "lcm", "deg", "arg", "dim", "mod",
]);
/** Their subscript is where the limit goes: "lim x → 2" reads better than a subscript. */
const LIMIT_OPERATORS = new Set(["lim", "max", "min", "sup", "inf"]);

/** Commands whose one argument is written as plain words. */
const TEXT_COMMANDS = new Set([
  "text", "textrm", "textbf", "textit", "textsf", "texttt", "textnormal", "mbox", "hbox",
  "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathcal", "mathscr", "mathfrak", "operatorname", "boldsymbol", "bm",
]);

/** Accents drop to their base: a segment AB reads as "AB" in a title. */
const ACCENTS = new Set([
  "overline", "underline", "bar", "vec", "hat", "widehat", "tilde", "widetilde", "dot", "ddot",
  "overrightarrow", "overleftarrow", "overleftrightarrow", "overarc", "wideparen", "mathring", "check", "breve", "acute", "grave",
]);

const BLACKBOARD: Record<string, string> = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ" };

/** Sizing and spacing commands that carry no content. */
const IGNORED = new Set([
  "left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "biggl", "biggr", "Biggl", "Biggr",
  "displaystyle", "textstyle", "scriptstyle", "limits", "nolimits", "middle", "!", "hfill", "nonumber", "notag",
]);
const SPACES = new Set([",", ";", ":", " ", "quad", "qquad", "enspace", "thinspace", "medspace", "thickspace"]);

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "−": "⁻", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
};
const SUBSCRIPT: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "−": "₋", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", h: "ₕ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", s: "ₛ", t: "ₜ",
  i: "ᵢ", j: "ⱼ", r: "ᵣ", u: "ᵤ", v: "ᵥ",
};

const VULGAR: Record<string, string> = {
  "1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾", "1/5": "⅕", "2/5": "⅖", "3/5": "⅗",
  "4/5": "⅘", "1/6": "⅙", "5/6": "⅚", "1/8": "⅛", "3/8": "⅜", "5/8": "⅝", "7/8": "⅞",
};

function mapAll(text: string, table: Record<string, string>): string | null {
  let out = "";
  for (const ch of text) {
    const m = table[ch];
    if (m === undefined) return null;
    out += m;
  }
  return out;
}

/** A piece short enough to sit in a fraction or a script without parentheses: "10", "x", "2x". */
function isCompact(text: string): boolean {
  return /^[\p{L}\p{N}.′°]+$/u.test(text) && text.length <= 4;
}

function wrap(text: string): string {
  return isCompact(text) ? text : `(${text})`;
}

class LatexReader {
  private i = 0;
  private readonly s: string;
  constructor(s: string) {
    this.s = s;
  }

  /** Atoms until the end, or until `stop` (consumed) at this nesting level. */
  seq(stop?: string): Atom[] {
    const out: Atom[] = [];
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (stop && ch === stop) {
        this.i++;
        return out;
      }
      this.item(out);
    }
    return out;
  }

  /** One argument: a `{…}` group, a command, or a single character. */
  arg(): Atom[] {
    this.skipSpace();
    if (this.i >= this.s.length) return [];
    if (this.s[this.i] === "{") {
      this.i++;
      return this.seq("}");
    }
    const out: Atom[] = [];
    // A bare argument is one token: `\frac12` is 1/2, `x^23` is x²3.
    if (this.s[this.i] === "\\") this.item(out);
    else out.push(this.charAtom(this.s[this.i++]));
    return out;
  }

  /** Raw text of a `{…}` argument (for \text and \begin), braces balanced. */
  private rawArg(): string {
    this.skipSpace();
    if (this.s[this.i] !== "{") return this.i < this.s.length ? this.s[this.i++] : "";
    let depth = 0;
    const start = this.i + 1;
    for (; this.i < this.s.length; this.i++) {
      const ch = this.s[this.i];
      if (ch === "\\") {
        this.i++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return this.s.slice(start, this.i++);
    }
    return this.s.slice(start);
  }

  private optionalArg(): string | null {
    this.skipSpace();
    if (this.s[this.i] !== "[") return null;
    const end = this.s.indexOf("]", this.i);
    if (end === -1) return null;
    const inner = this.s.slice(this.i + 1, end);
    this.i = end + 1;
    return inner;
  }

  private skipSpace() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  private charAtom(ch: string): Atom {
    if (ch === "-" || ch === "−") return { kind: "bin", text: "−" };
    if (ch === "+") return { kind: "bin", text: "+" };
    if (ch === "*") return { kind: "bin", text: "·" };
    if (ch === "=" || ch === "<" || ch === ">") return { kind: "rel", text: ch };
    if (ch === "(" || ch === "[") return { kind: "open", text: ch };
    if (ch === ")" || ch === "]") return { kind: "close", text: ch };
    if (ch === "," || ch === ";") return { kind: "punct", text: ch };
    if (ch === ":") return { kind: "punct", text: ":" };
    if (ch === "'") return { kind: "ord", text: "′" };
    return { kind: "ord", text: ch };
  }

  private item(out: Atom[]) {
    const ch = this.s[this.i];
    if (/\s/.test(ch) || ch === "~") {
      // Maths ignores spaces: Mathpix writes "2 x+3" for 2x + 3. Spacing is re-derived.
      this.i++;
      return;
    }
    if (ch === "{") {
      this.i++;
      out.push(...this.seq("}"));
      return;
    }
    if (ch === "}") {
      this.i++;
      return;
    }
    if (ch === "^" || ch === "_") {
      this.i++;
      this.script(out, ch);
      return;
    }
    if (ch === "&") {
      this.i++;
      return;
    }
    if (ch === "\\") {
      this.command(out);
      return;
    }
    if (/[0-9.]/.test(ch)) {
      let j = this.i;
      while (j < this.s.length && /[0-9.]/.test(this.s[j])) j++;
      out.push({ kind: "ord", text: this.s.slice(this.i, j) });
      this.i = j;
      return;
    }
    this.i++;
    out.push(this.charAtom(ch));
  }

  private script(out: Atom[], mark: "^" | "_") {
    const body = this.arg();
    const prev = out[out.length - 1];
    const base = prev ?? { kind: "ord" as AtomKind, text: "" };
    if (!prev) out.push(base);
    if (mark === "^" && body.length === 1 && (body[0].text === "∘" || body[0].text === "°")) {
      base.text += "°";
      return;
    }
    if (mark === "^" && body.every((a) => a.text === "′")) {
      base.text += "′".repeat(body.length);
      return;
    }
    const text = join(body);
    if (!text) return;
    if (mark === "_" && LIMIT_OPERATORS.has(base.text)) {
      base.text += ` ${text}`;
      return;
    }
    const mapped = mapAll(text.replace(/\s+/g, ""), mark === "^" ? SUPERSCRIPT : SUBSCRIPT);
    // Without Unicode scripts, only a number or a single letter goes unbracketed: e^(2x), a^b.
    base.text += mapped ?? `${mark}${/^(?:\p{N}+|\p{L})$/u.test(text) ? text : `(${text})`}`;
  }

  private command(out: Atom[]) {
    this.i++; // backslash
    let name: string;
    if (/[a-zA-Z]/.test(this.s[this.i] ?? "")) {
      let j = this.i;
      while (j < this.s.length && /[a-zA-Z]/.test(this.s[j])) j++;
      name = this.s.slice(this.i, j);
      this.i = j;
    } else {
      name = this.s[this.i] ?? "";
      this.i++;
    }

    if (name === "\\") {
      out.push({ kind: "punct", text: ";" });
      return;
    }
    if (SPACES.has(name) || IGNORED.has(name)) {
      if (name === "left" || name === "right") {
        // the delimiter that follows is kept; `\left.` is an invisible one
        this.skipSpace();
        if (this.s[this.i] === ".") this.i++;
      }
      return;
    }
    if (name === "(" || name === ")" || name === "[" || name === "]") return;
    if (TEXT_COMMANDS.has(name)) {
      const words = this.rawArg().replace(/\\[,;: ]/g, " ").replace(/\s+/g, " ").trim();
      if (!words) return;
      // \mathrm{d}x, \operatorname{sin}: single tokens stay maths; anything longer is words.
      out.push({ kind: /\s/.test(words) || words.length > 3 ? "text" : "ord", text: words });
      return;
    }
    if (ACCENTS.has(name)) {
      const body = join(this.arg());
      if (body) out.push({ kind: "ord", text: body });
      return;
    }
    if (name === "mathbb") {
      const letter = this.rawArg().trim();
      out.push({ kind: "ord", text: BLACKBOARD[letter] ?? letter });
      return;
    }
    if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
      const num = join(this.arg());
      const den = join(this.arg());
      const plain = `${num}/${den}`;
      out.push({ kind: "ord", text: VULGAR[plain] ?? `${wrap(num)}/${wrap(den)}` });
      return;
    }
    if (name === "binom" || name === "dbinom" || name === "tbinom") {
      const n = join(this.arg());
      const k = join(this.arg());
      out.push({ kind: "ord", text: `C(${n}, ${k})` });
      return;
    }
    if (name === "sqrt") {
      const index = this.optionalArg();
      const body = join(this.arg());
      const sign = index === "3" ? "∛" : index === "4" ? "∜" : index ? `${mapAll(index, SUPERSCRIPT) ?? index}√` : "√";
      out.push({ kind: "ord", text: `${sign}${wrap(body)}` });
      return;
    }
    if (name === "begin" || name === "end") {
      this.rawArg(); // environment name; its rows are read as a sequence
      return;
    }
    if (FUNCTIONS.has(name)) {
      out.push({ kind: "op", text: name });
      return;
    }
    const symbol = SYMBOLS[name];
    if (symbol) {
      out.push({ ...symbol });
      return;
    }
    // An unknown command: its name is still more readable than nothing.
    if (name) out.push({ kind: "ord", text: name });
  }
}

/**
 * Atoms -> text with TeX-like spacing: relations and binary operators get a space each side,
 * a sign that starts an expression stays attached ("y = −x + 4"), commas are followed by one.
 */
function join(atoms: Atom[]): string {
  let out = "";
  let prev: Atom | null = null;
  for (const atom of atoms) {
    if (!atom.text) continue;
    let text = atom.text;
    let before = "";
    const unary: boolean = atom.kind === "bin" && (!prev || prev.kind === "open" || prev.kind === "rel" || prev.kind === "bin" || prev.kind === "punct" || prev.kind === "op");
    if (atom.kind === "rel" || (atom.kind === "bin" && !unary)) {
      before = " ";
      text += " ";
    } else if (atom.kind === "punct") {
      text += " ";
    } else if (atom.kind === "text") {
      before = prev && prev.kind !== "open" ? " " : "";
      text += " ";
    } else if (atom.kind === "op") {
      before = prev && prev.kind !== "open" && prev.kind !== "bin" && prev.kind !== "rel" ? " " : "";
    } else if (prev?.kind === "op" && atom.kind !== "open") {
      before = " ";
    }
    out += before + text;
    prev = atom.kind === "bin" && unary ? { kind: "open", text: "" } : atom;
  }
  // "=" at the very end ("40 − 3 =") keeps its left space only.
  return out.replace(/\s+/g, " ").replace(/\s+([,;:)\]])/g, "$1").replace(/([([])\s+/g, "$1").trim();
}

/** Plain text of one piece of maths (no `\(…\)` or `$…$` delimiters inside). */
function mathToPlain(latex: string): string {
  return join(new LatexReader(latex).seq());
}

/**
 * LaTeX as readable text: `\frac{x}{10}` -> "x/10", `x^{2}` -> "x²", `\sqrt{x+1}` -> "√(x + 1)",
 * `\text { Given: } \overline{A B} \cong \overline{C B}` -> "Given: AB ≅ CB".
 *
 * Handles Mathpix's text-mode output too, where words sit outside `\( … \)` / `$ … $`.
 * Never throws; anything unrecognised is written by name rather than dropped.
 */
export function latexToPlainText(latex: string): string {
  const src = (latex ?? "").trim();
  if (!src) return "";
  // Text mode: words outside the delimiters keep their spaces; each maths run is converted.
  if (/\\\(|\\\[|(?<!\\)\$/.test(src)) {
    const parts = src.split(/(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|(?<!\\)\$\$[\s\S]*?\$\$|(?<!\\)\$[\s\S]*?(?<!\\)\$)/);
    const unclosed = /\\\(|\\\[|(?<!\\)\$/;
    return parts
      .map((part) => {
        const m = /^(?:\\\(|\\\[|\$\$|\$)([\s\S]*?)(?:\\\)|\\\]|\$\$|\$)$/.exec(part);
        if (m) return ` ${mathToPlain(m[1])} `;
        // An opening delimiter without its close (a line Mathpix cut short): the rest is maths.
        const open = unclosed.exec(part);
        if (open) {
          return `${part.slice(0, open.index)} ${mathToPlain(part.slice(open.index + open[0].length))}`;
        }
        return part;
      })
      .join("")
      .replace(/\s+/g, " ")
      .replace(/\s+([,;:.])/g, "$1")
      .trim();
  }
  return mathToPlain(src);
}

/** True when the line has maths outside its words (`\text{graph } y=x` does, `\text{Given}` does not). */
export function hasMathContent(latex: string): boolean {
  const stripped = (latex ?? "")
    .replace(/\\(?:text|textrm|textbf|textit|mbox|mathrm|operatorname)\s*\{[^{}]*\}/g, "")
    .replace(/\\[()[\]]/g, "")
    .replace(/[\s{}]/g, "");
  return stripped.length > 0;
}

/**
 * A board title from one line of LaTeX: plain text, cut at a word boundary to
 * `MAX_AUTO_TITLE_LENGTH`. Null when nothing readable is left (an empty or symbol-only read).
 */
export function boardTitleFromLatex(latex: string, maxLength = MAX_AUTO_TITLE_LENGTH): string | null {
  const text = latexToPlainText(latex);
  if (!/[\p{L}\p{N}]/u.test(text)) return null;
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > maxLength / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:=+−]+$/, "")}…`;
}

/** The part of a Live line the title needs (see `LiveLineState` in `src/lib/live/contracts`). */
export interface TitleLine {
  id: string;
  latex: string;
  column: number;
  row: number;
}

export interface TitleCandidate {
  lineId: string;
  title: string;
}

/**
 * The line a board is named after: the first in reading order (column, then row, the order
 * of Live's transcript), preferring one with maths in it over a words-only header such as
 * "Statements". Null while nothing on the screen has been read.
 */
export function pickTitleLine(lines: readonly TitleLine[]): TitleCandidate | null {
  const ordered = lines
    .filter((l) => l.latex && l.latex.trim())
    .slice()
    .sort((a, b) => a.column - b.column || a.row - b.row);
  let fallback: TitleCandidate | null = null;
  for (const line of ordered) {
    const title = boardTitleFromLatex(line.latex);
    if (!title) continue;
    if (hasMathContent(line.latex)) return { lineId: line.id, title };
    fallback ??= { lineId: line.id, title };
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// When to (re)name: a compare-and-swap on the title, never over the student's
// ---------------------------------------------------------------------------

/** What the auto-namer believes about the stored title during one board session. */
export interface AutoTitleState {
  /** the title we expect is stored: the default until our first write lands */
  expected: string;
  /** the line our last write was named after; null before the first write */
  lineId: string | null;
  /** the stored title was not the one we expected (the student named the board): stop */
  stopped: boolean;
}

export const INITIAL_AUTO_TITLE: AutoTitleState = { expected: DEFAULT_BOARD_TITLE, lineId: null, stopped: false };

/** `UPDATE whiteboards SET title = $title WHERE id = $id AND title = $expected`. */
export interface TitleWrite {
  expected: string;
  title: string;
  lineId: string;
}

/**
 * The write to make for the current candidate, or null. The write is conditional on the
 * stored title still being `expected`, so a name the student gave the board (here or in
 * another tab) is never replaced. After the first write only a new read of that same line
 * renames the board: a line written above it, or another screen, does not.
 */
export function planTitleWrite(state: AutoTitleState, candidate: TitleCandidate | null): TitleWrite | null {
  if (state.stopped || !candidate) return null;
  if (state.lineId !== null && candidate.lineId !== state.lineId) return null;
  if (candidate.title === state.expected) return null;
  return { expected: state.expected, title: candidate.title, lineId: candidate.lineId };
}

/** State after the conditional update: `matched` = it changed a row. */
export function afterTitleWrite(state: AutoTitleState, write: TitleWrite, matched: boolean): AutoTitleState {
  if (!matched) return { ...state, stopped: true };
  return { expected: write.title, lineId: write.lineId, stopped: false };
}
