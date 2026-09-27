/**
 * The statements of a two-column proof, read from the LaTeX Mathpix returns, as FACTS about named
 * points, segments, angles, lines and triangles:
 *
 *   \overline{AB} \cong \overline{CD}   AB = CD                     segCong
 *   \angle ABC \cong \angle DEF   m\angle 1 = m\angle 2            angCong
 *   \triangle ABC \cong \triangle DEF                                triCong (the vertex order IS the correspondence)
 *   \overline{AB} \parallel \overline{CD}   \overline{BD} \perp \overline{AC}   l \parallel m
 *   m\angle B = 90^{\circ}   \angle B \text{ is a right angle}    angMeasure
 *   M \text{ is the midpoint of } \overline{AB}                     midpoint
 *   \overrightarrow{BD} \text{ bisects } \angle ABC                 angBisect
 *   \angle 1 \text{ and } \angle 2 \text{ are vertical angles}      vertical, linearPair, supp
 *
 * Several facts may share a line (`\overline{AB} \cong \overline{CD}, \overline{AB} \parallel
 * \overline{CD}`, a chain `a \cong b \cong c`). `complete` is false when any piece of the line
 * could not be read — the checker then never rings anything on the strength of what is missing.
 * Pure; no engine, no DOM.
 */

export type Point = string;
export interface SegRef {
  k: "seg";
  a: Point;
  b: Point;
}
/** `\angle ABC` (vertex in the middle), `\angle B`, `\angle 1` */
export type AngRef = { k: "ang"; a: Point; v: Point; c: Point } | { k: "angv"; v: Point } | { k: "angn"; n: string };
export type TriRef = readonly [Point, Point, Point];
/** a line through two named points (a segment, a line, a ray), or a line named by one lowercase letter */
export type LineRef = { k: "line"; a: Point; b: Point } | { k: "lname"; n: string };

export type Fact =
  | { t: "segCong"; x: SegRef; y: SegRef }
  | { t: "angCong"; x: AngRef; y: AngRef }
  | { t: "triCong"; x: TriRef; y: TriRef }
  | { t: "triSim"; x: TriRef; y: TriRef }
  | { t: "parallel"; x: LineRef; y: LineRef }
  | { t: "perp"; x: LineRef; y: LineRef }
  | { t: "midpoint"; m: Point; s: SegRef }
  | { t: "angBisect"; ray: readonly [Point, Point]; ang: AngRef }
  | { t: "segBisect"; by: LineRef; s: SegRef; at?: Point }
  | { t: "angMeasure"; x: AngRef; deg: number }
  | { t: "segLength"; x: SegRef; len: number }
  | { t: "supp"; x: AngRef; y: AngRef }
  | { t: "vertical"; x: AngRef; y: AngRef }
  | { t: "linearPair"; x: AngRef; y: AngRef }
  | { t: "isosceles"; tri: TriRef }
  | { t: "rightTri"; tri: TriRef };

export interface Statement {
  facts: Fact[];
  /** every piece of the line was read as a fact */
  complete: boolean;
}

export const seg = (a: Point, b: Point): SegRef => ({ k: "seg", a, b });
export const ang = (a: Point, v: Point, c: Point): AngRef => ({ k: "ang", a, v, c });

// ---------------------------------------------------------------- tokens

type Op = "cong" | "eq" | "par" | "perp" | "sim" | "neq";
export type Tok =
  | { k: "seg"; a: Point; b: Point }
  | { k: "line"; a: Point; b: Point }
  | { k: "ray"; a: Point; b: Point }
  | { k: "ang"; ref: AngRef }
  | { k: "tri"; p: TriRef }
  | { k: "caps"; s: string }
  | { k: "lower"; s: string }
  | { k: "num"; v: number; deg: boolean }
  | { k: "op"; op: Op }
  | { k: "plus" }
  | { k: "word"; w: string }
  | { k: "sep" }
  | { k: "colon" }
  | { k: "bad"; s: string };

const TEXT_CMD = /^\\(?:text|textrm|textbf|textit|mathrm|mathbf|mathit|operatorname|mbox|textnormal|textsf|mathsf)\s*\{/;
const SPACING = /^(?:\\(?:,|;|:|!|quad|qquad|enspace|thinspace|medspace|thickspace| )|~)/;

/** Index just past the `{…}` group opening at `open` (balanced; to the end when unclosed). */
function groupEnd(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "\\") {
      i++;
      continue;
    }
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i + 1;
  }
  return src.length;
}

function preprocess(latex: string): string {
  return (
    latex
      .replace(/\\left|\\right|\\displaystyle|\\limits/g, "")
      .replace(/\\(?:Delta|bigtriangleup|vartriangle|triangle)(?![a-zA-Z])/g, "\\triangle ")
      .replace(/△|Δ/g, "\\triangle ")
      .replace(/\\(?:measuredangle|sphericalangle)(?![a-zA-Z])/g, "\\angle ")
      .replace(/∠/g, "\\angle ")
      .replace(/≅/g, "\\cong ")
      .replace(/∥/g, "\\parallel ")
      .replace(/⊥/g, "\\perp ")
      .replace(/°/g, "^{\\circ}")
      // `\mathrm{m} \angle`: the measure of
      .replace(/\\(?:mathrm|text|operatorname|mathit)\s*\{\s*m\s*\}\s*(?=\\angle)/g, "m ")
      // `\stackrel{\sim}{=}`: congruent
      .replace(/\\(?:stackrel|overset)\s*\{\s*\\sim\s*\}\s*\{\s*=\s*\}/g, "\\cong ")
  );
}

/** Capital letters of a name group, spaces and braces dropped (`{A B}` → `AB`), or null. */
function capsOf(raw: string): string | null {
  const s = raw.replace(/[{}\s]|\\,|\\ /g, "");
  return /^[A-Z]+$/.test(s) ? s : null;
}

function skipSpaces(src: string, i: number): number {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    const m = SPACING.exec(src.slice(i));
    if (!m) return i;
    i += m[0].length;
  }
}

/** The name after `\angle` / `\triangle` at `i`: a braced group, or up to `max` capitals (spaces between allowed). */
function readCaps(src: string, i: number, max: number): { s: string; end: number } {
  let j = skipSpaces(src, i);
  if (src[j] === "{") {
    const end = groupEnd(src, j);
    const s = capsOf(src.slice(j + 1, end - 1));
    return s ? { s, end } : { s: "", end: i };
  }
  let s = "";
  let end = i;
  while (s.length < max) {
    const k = skipSpaces(src, j);
    if (!/[A-Z]/.test(src[k] ?? "") || /[a-z]/.test(src[k + 1] ?? "")) break;
    s += src[k];
    j = k + 1;
    end = j;
  }
  return { s, end };
}

/** Words of a `\text{…}` group: capitals alone (`M`, `AB`, `SAS`) stay names, the rest lowercase words. */
function textTokens(content: string, out: Tok[]): void {
  const cleaned = content
    .replace(/\\(?:angle|measuredangle)/g, " angle ")
    .replace(/\\(?:triangle|Delta)/g, " triangle ")
    .replace(/\\cong/g, " congruent ")
    .replace(/\\[a-zA-Z]+|\\./g, " ");
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    const parts = raw.split(/([,;:])/);
    for (const part of parts) {
      if (!part) continue;
      if (part === "," || part === ";") {
        out.push({ k: "sep" });
        continue;
      }
      if (part === ":") {
        out.push({ k: "colon" });
        continue;
      }
      const w = part.replace(/[.'’"()]/g, "");
      if (!w) continue;
      if (/^[A-Z]{1,3}$/.test(w)) out.push({ k: "caps", s: w });
      else if (/^\d+$/.test(w)) out.push({ k: "num", v: Number(w), deg: false });
      else out.push({ k: "word", w: w.toLowerCase() });
    }
  }
}

/** LaTeX → tokens (see `Tok`). Never throws: what it cannot read becomes a `bad` token. */
export function tokenize(latex: string): Tok[] {
  const src = preprocess(latex);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    if (/^\s/.test(rest)) {
      i++;
      continue;
    }
    const sp = SPACING.exec(rest);
    if (sp) {
      i += sp[0].length;
      continue;
    }
    const tx = TEXT_CMD.exec(rest);
    if (tx) {
      const open = i + tx[0].length - 1;
      const end = groupEnd(src, open);
      textTokens(src.slice(open + 1, end - 1), out);
      i = end;
      continue;
    }
    const over = /^\\(overline|bar|overleftrightarrow|overrightarrow|overleftarrow|vec|widebar)\s*(?=\{)/.exec(rest);
    if (over) {
      const open = i + over[0].length;
      const end = groupEnd(src, open);
      const s = capsOf(src.slice(open + 1, end - 1));
      i = end;
      if (!s || s.length !== 2 || s[0] === s[1]) {
        out.push({ k: "bad", s: over[0] });
        continue;
      }
      const kind = over[1] === "overleftrightarrow" ? "line" : over[1] === "overrightarrow" || over[1] === "vec" ? "ray" : over[1] === "overleftarrow" ? "line" : "seg";
      out.push({ k: kind, a: s[0], b: s[1] });
      continue;
    }
    if (/^\\angle(?![a-zA-Z])/.test(rest)) {
      i += 6;
      const j = skipSpaces(src, i);
      // `\angle s`: the word "angles"
      if (src[j] === "s" && !/[a-zA-Z]/.test(src[j + 1] ?? "")) {
        out.push({ k: "word", w: "angles" });
        i = j + 1;
        continue;
      }
      const digits = /^\{?\s*(\d{1,2})\s*\}?/.exec(src.slice(j));
      if (digits) {
        out.push({ k: "ang", ref: { k: "angn", n: digits[1] } });
        i = j + digits[0].length;
        continue;
      }
      const greek = /^\\(theta|alpha|beta|gamma|phi|varphi|psi|omega|delta)(?![a-zA-Z])/.exec(src.slice(j));
      if (greek) {
        out.push({ k: "ang", ref: { k: "angn", n: greek[1] } });
        i = j + greek[0].length;
        continue;
      }
      const name = readCaps(src, i, 3);
      if (name.s.length === 3 && new Set(name.s).size === 3) {
        out.push({ k: "ang", ref: { k: "ang", a: name.s[0], v: name.s[1], c: name.s[2] } });
        i = name.end;
      } else if (name.s.length === 1) {
        out.push({ k: "ang", ref: { k: "angv", v: name.s } });
        i = name.end;
      } else if (name.s.length === 0) {
        out.push({ k: "word", w: "angle" });
      } else {
        out.push({ k: "bad", s: `\\angle ${name.s}` });
        i = name.end;
      }
      continue;
    }
    if (/^\\triangle(?![a-zA-Z])/.test(rest)) {
      i += 9;
      const name = readCaps(src, i, 3);
      if (name.s.length === 3 && new Set(name.s).size === 3) {
        out.push({ k: "tri", p: [name.s[0], name.s[1], name.s[2]] });
        i = name.end;
      } else {
        const j = skipSpaces(src, i);
        if (src[j] === "s" && !/[a-zA-Z]/.test(src[j + 1] ?? "")) {
          out.push({ k: "word", w: "triangles" });
          i = j + 1;
        } else out.push({ k: "word", w: "triangle" });
      }
      continue;
    }
    const cmd = /^\\([a-zA-Z]+|\|)/.exec(rest);
    if (cmd) {
      i += cmd[0].length;
      switch (cmd[1]) {
        case "cong":
        case "simeq":
        case "approxeq":
        case "equiv":
        case "approx":
          out.push({ k: "op", op: "cong" });
          break;
        case "parallel":
        case "|":
        case "Vert":
        case "shortparallel":
        case "nparallel":
          out.push(cmd[1] === "nparallel" ? { k: "bad", s: "\\nparallel" } : { k: "op", op: "par" });
          break;
        case "perp":
        case "bot":
          out.push({ k: "op", op: "perp" });
          break;
        case "sim":
          out.push({ k: "op", op: "sim" });
          break;
        case "neq":
        case "ne":
          out.push({ k: "op", op: "neq" });
          break;
        case "circ":
        case "degree":
          // a degree sign with no number before it: noise
          break;
        default:
          out.push({ k: "bad", s: cmd[0] });
      }
      continue;
    }
    const num = /^(\d+(?:\.\d+)?)/.exec(rest);
    if (num) {
      i += num[0].length;
      const deg = /^\s*\^\s*(?:\{\s*(?:\\circ|o|0)\s*\}|\\circ|o)/.exec(src.slice(i)) ?? /^\s*\\(?:circ|degree)(?![a-zA-Z])/.exec(src.slice(i));
      if (deg) i += deg[0].length;
      out.push({ k: "num", v: Number(num[1]), deg: Boolean(deg) });
      continue;
    }
    if (/^m\s*\\angle(?![a-zA-Z])/.test(rest)) {
      // the measure of an angle: the name alone means the measure
      i += 1;
      continue;
    }
    const letters = /^[A-Za-z]+/.exec(rest);
    if (letters) {
      const w = letters[0];
      i += w.length;
      if (src[i] === "'") {
        out.push({ k: "bad", s: `${w}'` });
        i++;
        continue;
      }
      if (/^[A-Z]+$/.test(w)) out.push({ k: "caps", s: w });
      else if (w.length === 1) out.push({ k: "lower", s: w });
      else out.push({ k: "word", w: w.toLowerCase() });
      continue;
    }
    const ch = src[i];
    i++;
    if (ch === "=") out.push({ k: "op", op: "eq" });
    else if (ch === "+") out.push({ k: "plus" });
    else if (ch === "," || ch === ";") out.push({ k: "sep" });
    else if (ch === ":") out.push({ k: "colon" });
    else if (ch === "/" && src[i] === "/") {
      i++;
      out.push({ k: "op", op: "par" });
    } else if (ch === "{" || ch === "}" || ch === "(" || ch === ")" || ch === "." || ch === "[" || ch === "]") continue;
    else if (ch === "|" && src[i] === "|") {
      i++;
      out.push({ k: "op", op: "par" });
    } else out.push({ k: "bad", s: ch });
  }
  return mergeLetters(out);
}

/**
 * Math-mode letters Mathpix spaces out: `A B` is `AB`, and `G i v e n` (a word read as maths) is the
 * word. Adjacent capitals merge; three or more single letters with a lowercase among them are a word.
 */
function mergeLetters(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === "caps" || (t.k === "lower" && t.s.length === 1)) {
      let j = i;
      const run: string[] = [];
      while (j < toks.length) {
        const u = toks[j];
        if (u.k === "caps" || (u.k === "lower" && u.s.length === 1)) {
          run.push(u.s);
          j++;
        } else break;
      }
      const text = run.join("");
      if (run.length >= 3 && /[a-z]/.test(text) && /^[A-Z]?[a-z]+$/.test(text)) {
        out.push({ k: "word", w: text.toLowerCase() });
        i = j - 1;
        continue;
      }
      if (/^[A-Z]+$/.test(text)) {
        out.push({ k: "caps", s: text });
        i = j - 1;
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------- statements

type Operand =
  | { k: "S"; s: SegRef }
  | { k: "A"; a: AngRef }
  | { k: "T"; t: TriRef }
  | { k: "L"; l: LineRef }
  | { k: "N"; v: number; deg: boolean }
  | { k: "A+A"; x: AngRef; y: AngRef };

function operand(toks: readonly Tok[]): Operand | null {
  if (toks.length === 1) {
    const t = toks[0];
    switch (t.k) {
      case "seg":
        return { k: "S", s: seg(t.a, t.b) };
      case "caps":
        return t.s.length === 2 && t.s[0] !== t.s[1] ? { k: "S", s: seg(t.s[0], t.s[1]) } : null;
      case "line":
      case "ray":
        return { k: "L", l: { k: "line", a: t.a, b: t.b } };
      case "lower":
        return /^[a-z]$/.test(t.s) && !"xyz".includes(t.s) ? { k: "L", l: { k: "lname", n: t.s } } : null;
      case "ang":
        return { k: "A", a: t.ref };
      case "tri":
        return { k: "T", t: t.p };
      case "num":
        return { k: "N", v: t.v, deg: t.deg };
      default:
        return null;
    }
  }
  if (toks.length === 3 && toks[0].k === "ang" && toks[1].k === "plus" && toks[2].k === "ang") return { k: "A+A", x: toks[0].ref, y: toks[2].ref };
  return null;
}

const lineOf = (o: Operand): LineRef | null => (o.k === "L" ? o.l : o.k === "S" ? { k: "line", a: o.s.a, b: o.s.b } : null);

function relate(x: Operand, op: Op, y: Operand): Fact | null {
  if (op === "cong" || op === "eq") {
    if (x.k === "S" && y.k === "S") return { t: "segCong", x: x.s, y: y.s };
    if (x.k === "A" && y.k === "A") return { t: "angCong", x: x.a, y: y.a };
    if (x.k === "T" && y.k === "T" && op === "cong") return { t: "triCong", x: x.t, y: y.t };
    if (x.k === "A" && y.k === "N" && op === "eq") return { t: "angMeasure", x: x.a, deg: y.v };
    if (x.k === "N" && y.k === "A" && op === "eq") return { t: "angMeasure", x: y.a, deg: x.v };
    if (x.k === "S" && y.k === "N" && op === "eq" && !y.deg) return { t: "segLength", x: x.s, len: y.v };
    if (x.k === "N" && y.k === "S" && op === "eq" && !x.deg) return { t: "segLength", x: y.s, len: x.v };
    if (x.k === "A+A" && y.k === "N" && op === "eq" && y.v === 180) return { t: "supp", x: x.x, y: x.y };
    return null;
  }
  if (op === "sim") return x.k === "T" && y.k === "T" ? { t: "triSim", x: x.t, y: y.t } : null;
  if (op === "par" || op === "perp") {
    const a = lineOf(x);
    const b = lineOf(y);
    if (!a || !b) return null;
    return op === "par" ? { t: "parallel", x: a, y: b } : { t: "perp", x: a, y: b };
  }
  return null;
}

/** `X op Y (op Z …)`: a relation, or a chain of them. */
function relationChain(toks: readonly Tok[]): Fact[] | null {
  const items: Tok[][] = [[]];
  const ops: Op[] = [];
  for (const t of toks) {
    if (t.k === "op") {
      ops.push(t.op);
      items.push([]);
    } else items[items.length - 1].push(t);
  }
  if (ops.length === 0) return null;
  const operands = items.map(operand);
  if (operands.some((o) => o === null)) return null;
  const facts: Fact[] = [];
  for (let i = 0; i < ops.length; i++) {
    const f = relate(operands[i]!, ops[i], operands[i + 1]!);
    if (!f) return null;
    facts.push(f);
  }
  return facts;
}

const ARTICLES = new Set(["the", "a", "an"]);
const WORD_ALIASES: Record<string, string> = {
  rt: "right",
  midpt: "midpoint",
  mdpt: "midpoint",
  bisect: "bisects",
  isos: "isosceles",
  suppl: "supplementary",
  supp: "supplementary",
  vert: "vertical",
  perpendicular: "⊥",
  perp: "⊥",
  "∠": "angle",
  angs: "angles",
  tri: "triangle",
  tris: "triangles",
};

/** A word statement (`M is the midpoint of AB`, `∠B and ∠E are right angles`), or null. */
function wordPattern(toks: readonly Tok[]): Fact[] | null {
  const symbols: string[] = [];
  const refs: Tok[] = [];
  for (const t of toks) {
    switch (t.k) {
      case "word": {
        const w = WORD_ALIASES[t.w] ?? t.w;
        if (!ARTICLES.has(w)) symbols.push(w);
        break;
      }
      case "seg":
        symbols.push(`S${refs.length}`);
        refs.push(t);
        break;
      case "caps":
        if (t.s.length === 1) symbols.push(`P${refs.length}`);
        else if (t.s.length === 2) symbols.push(`S${refs.length}`);
        else return null;
        refs.push(t);
        break;
      case "line":
      case "ray":
        symbols.push(`R${refs.length}`);
        refs.push(t);
        break;
      case "ang":
        symbols.push(`A${refs.length}`);
        refs.push(t);
        break;
      case "tri":
        symbols.push(`T${refs.length}`);
        refs.push(t);
        break;
      case "op":
        symbols.push(t.op === "perp" ? "⊥" : t.op === "par" ? "∥" : t.op === "cong" ? "congruent" : t.op);
        break;
      default:
        return null;
    }
  }
  const text = symbols.join(" ");
  const pt = (i: string): Point | null => {
    const t = refs[Number(i)];
    return t?.k === "caps" && t.s.length === 1 ? t.s : null;
  };
  const sg = (i: string): SegRef | null => {
    const t = refs[Number(i)];
    if (t?.k === "seg") return seg(t.a, t.b);
    if (t?.k === "caps" && t.s.length === 2) return seg(t.s[0], t.s[1]);
    return null;
  };
  const an = (i: string): AngRef | null => {
    const t = refs[Number(i)];
    return t?.k === "ang" ? t.ref : null;
  };
  const tr = (i: string): TriRef | null => {
    const t = refs[Number(i)];
    return t?.k === "tri" ? t.p : null;
  };
  const ln = (i: string): LineRef | null => {
    const t = refs[Number(i)];
    if (t?.k === "seg" || t?.k === "line" || t?.k === "ray") return { k: "line", a: t.a, b: t.b };
    if (t?.k === "caps" && t.s.length === 2) return { k: "line", a: t.s[0], b: t.s[1] };
    return null;
  };
  const rayPts = (i: string): readonly [Point, Point] | null => {
    const t = refs[Number(i)];
    if (t?.k === "seg" || t?.k === "line" || t?.k === "ray") return [t.a, t.b];
    if (t?.k === "caps" && t.s.length === 2) return [t.s[0], t.s[1]];
    return null;
  };
  let m: RegExpExecArray | null;
  if ((m = /^P(\d+) (?:is )?midpoint of S(\d+)$/.exec(text))) {
    const p = pt(m[1]);
    const s = sg(m[2]);
    return p && s ? [{ t: "midpoint", m: p, s }] : null;
  }
  if ((m = /^S(\d+) has midpoint P(\d+)$/.exec(text))) {
    const p = pt(m[2]);
    const s = sg(m[1]);
    return p && s ? [{ t: "midpoint", m: p, s }] : null;
  }
  if ((m = /^[SR](\d+) bisects A(\d+)$/.exec(text))) {
    const r = rayPts(m[1]);
    const a = an(m[2]);
    if (!r || !a) return null;
    const v = a.k === "ang" || a.k === "angv" ? a.v : null;
    if (!v) return null;
    const ray: readonly [Point, Point] | null = r[0] === v ? [r[0], r[1]] : r[1] === v ? [r[1], r[0]] : null;
    return ray ? [{ t: "angBisect", ray, ang: a }] : null;
  }
  if ((m = /^[SR](\d+) bisects S(\d+)(?: at P(\d+))?$/.exec(text))) {
    const by = ln(m[1]);
    const s = sg(m[2]);
    const at = m[3] !== undefined ? pt(m[3]) : undefined;
    if (!by || !s || at === null) return null;
    return [{ t: "segBisect", by, s, ...(at ? { at } : {}) }];
  }
  if ((m = /^A(\d+) is right(?: angle)?$/.exec(text))) {
    const a = an(m[1]);
    return a ? [{ t: "angMeasure", x: a, deg: 90 }] : null;
  }
  if ((m = /^A(\d+) and A(\d+) are right(?: angles| angle)?$/.exec(text))) {
    const a = an(m[1]);
    const b = an(m[2]);
    return a && b ? [{ t: "angMeasure", x: a, deg: 90 }, { t: "angMeasure", x: b, deg: 90 }] : null;
  }
  if ((m = /^A(\d+) and A(\d+) (?:are|form) (vertical|linear pair|supplementary|congruent)(?: angles)?$/.exec(text))) {
    const a = an(m[1]);
    const b = an(m[2]);
    if (!a || !b) return null;
    const kind = m[3];
    if (kind === "vertical") return [{ t: "vertical", x: a, y: b }];
    if (kind === "linear pair") return [{ t: "linearPair", x: a, y: b }];
    if (kind === "supplementary") return [{ t: "supp", x: a, y: b }];
    return [{ t: "angCong", x: a, y: b }];
  }
  if ((m = /^T(\d+) is (?:an )?isosceles(?: triangle)?$/.exec(text))) {
    const t = tr(m[1]);
    return t ? [{ t: "isosceles", tri: t }] : null;
  }
  if ((m = /^T(\d+) is right triangle$/.exec(text))) {
    const t = tr(m[1]);
    return t ? [{ t: "rightTri", tri: t }] : null;
  }
  if ((m = /^T(\d+) and T(\d+) are right triangles$/.exec(text))) {
    const a = tr(m[1]);
    const b = tr(m[2]);
    return a && b ? [{ t: "rightTri", tri: a }, { t: "rightTri", tri: b }] : null;
  }
  return null;
}

function parsePiece(toks: readonly Tok[]): Fact[] | null {
  const body = toks.filter((t) => t.k !== "colon");
  if (body.length === 0) return [];
  if (body.some((t) => t.k === "bad")) return null;
  const rel = relationChain(body);
  if (rel) return rel;
  const words = wordPattern(body);
  if (words) return words;
  // `A and B`: two statements joined by a word
  const and = body.findIndex((t) => t.k === "word" && t.w === "and");
  if (and > 0 && and < body.length - 1) {
    const left = parsePiece(body.slice(0, and));
    const right = parsePiece(body.slice(and + 1));
    if (left && right && left.length > 0 && right.length > 0) return [...left, ...right];
  }
  return null;
}

/** Splits tokens into comma-separated pieces. */
function pieces(toks: readonly Tok[]): Tok[][] {
  const out: Tok[][] = [[]];
  for (const t of toks) {
    if (t.k === "sep") out.push([]);
    else out[out.length - 1].push(t);
  }
  return out.filter((p) => p.length > 0);
}

/** Tokens → a statement (see `Statement`). */
export function statementOf(toks: readonly Tok[]): Statement {
  const ps = pieces(toks);
  const facts: Fact[] = [];
  let complete = ps.length > 0;
  for (const p of ps) {
    const f = parsePiece(p);
    if (f === null) complete = false;
    else facts.push(...f);
  }
  return { facts, complete: complete && facts.length > 0 };
}

/** One proof statement as Mathpix read it → its facts. */
export function parseStatement(latex: string): Statement {
  return statementOf(tokenize(latex));
}

/** A line that carries geometry notation at all (a statement the parser may not fully read). */
export function looksLikeGeometry(latex: string): boolean {
  return /\\(?:angle|measuredangle|triangle|Delta|overline|cong|parallel|perp|overleftrightarrow|overrightarrow)(?![a-zA-Z])|[∠△≅∥⊥]/.test(latex);
}

// ---------------------------------------------------------------- printing (the tutor's statements)

const segTex = (s: SegRef): string => `\\overline{${s.a}${s.b}}`;
export function angTex(a: AngRef): string {
  if (a.k === "ang") return `\\angle ${a.a}${a.v}${a.c}`;
  if (a.k === "angv") return `\\angle ${a.v}`;
  return /^\d+$/.test(a.n) ? `\\angle ${a.n}` : `\\angle \\${a.n}`;
}
const triTex = (t: TriRef): string => `\\triangle ${t.join("")}`;
const lineTex = (l: LineRef): string => (l.k === "line" ? `\\overline{${l.a}${l.b}}` : l.n);

/**
 * How the tutor writes a fact: maths only (`\overline{AB} \cong \overline{CD}`, `m\angle ABD =
 * 90^{\circ}`). Null for a fact that needs words (a midpoint, a bisector, an isosceles triangle):
 * those are never written by the tutor.
 */
export function factLatex(f: Fact): string | null {
  switch (f.t) {
    case "segCong":
      return `${segTex(f.x)} \\cong ${segTex(f.y)}`;
    case "angCong":
      return `${angTex(f.x)} \\cong ${angTex(f.y)}`;
    case "triCong":
      return `${triTex(f.x)} \\cong ${triTex(f.y)}`;
    case "triSim":
      return `${triTex(f.x)} \\sim ${triTex(f.y)}`;
    case "parallel":
      return `${lineTex(f.x)} \\parallel ${lineTex(f.y)}`;
    case "perp":
      return `${lineTex(f.x)} \\perp ${lineTex(f.y)}`;
    case "angMeasure":
      return `m${angTex(f.x)} = ${f.deg}^{\\circ}`;
    case "segLength":
      return `${f.x.a}${f.x.b} = ${f.len}`;
    case "supp":
      return `m${angTex(f.x)} + m${angTex(f.y)} = 180^{\\circ}`;
    default:
      return null;
  }
}

/** A statement's facts as the tutor writes them, or null when any needs words. */
export function statementLatex(facts: readonly Fact[]): string | null {
  const parts = facts.map(factLatex);
  return parts.every((p): p is string => p !== null) ? parts.join(", \\ ") : null;
}

/** Plain text of a fact for prompts and reports (words allowed there). */
export function factText(f: Fact): string {
  const tex = factLatex(f);
  if (tex) return tex;
  switch (f.t) {
    case "midpoint":
      return `${f.m} \\text{ is the midpoint of } ${segTex(f.s)}`;
    case "angBisect":
      return `\\overrightarrow{${f.ray[0]}${f.ray[1]}} \\text{ bisects } ${angTex(f.ang)}`;
    case "segBisect":
      return `${lineTex(f.by)} \\text{ bisects } ${segTex(f.s)}${f.at ? ` \\text{ at } ${f.at}` : ""}`;
    case "vertical":
      return `${angTex(f.x)} \\text{ and } ${angTex(f.y)} \\text{ are vertical angles}`;
    case "linearPair":
      return `${angTex(f.x)} \\text{ and } ${angTex(f.y)} \\text{ are a linear pair}`;
    case "isosceles":
      return `${triTex(f.tri)} \\text{ is isosceles}`;
    case "rightTri":
      return `${triTex(f.tri)} \\text{ is a right triangle}`;
    default:
      return "";
  }
}

/** Every point a fact names. */
export function pointsOf(f: Fact): Point[] {
  const out: Point[] = [];
  const addAng = (a: AngRef) => {
    if (a.k === "ang") out.push(a.a, a.v, a.c);
    else if (a.k === "angv") out.push(a.v);
  };
  const addLine = (l: LineRef) => {
    if (l.k === "line") out.push(l.a, l.b);
  };
  switch (f.t) {
    case "segCong":
      out.push(f.x.a, f.x.b, f.y.a, f.y.b);
      break;
    case "angCong":
    case "supp":
    case "vertical":
    case "linearPair":
      addAng(f.x);
      addAng(f.y);
      break;
    case "triCong":
    case "triSim":
      out.push(...f.x, ...f.y);
      break;
    case "parallel":
    case "perp":
      addLine(f.x);
      addLine(f.y);
      break;
    case "midpoint":
      out.push(f.m, f.s.a, f.s.b);
      break;
    case "angBisect":
      out.push(...f.ray);
      addAng(f.ang);
      break;
    case "segBisect":
      addLine(f.by);
      out.push(f.s.a, f.s.b);
      if (f.at) out.push(f.at);
      break;
    case "angMeasure":
      addAng(f.x);
      break;
    case "segLength":
      out.push(f.x.a, f.x.b);
      break;
    case "isosceles":
    case "rightTri":
      out.push(...f.tri);
      break;
  }
  return out;
}
