/**
 * Geometry notation as Mathpix writes it, read as the quantities a geometry student means.
 *
 *   \angle ABC, m\angle ABC, \measuredangle B, \angle 1   one angle measure   id `angle_ABC`
 *   \overline{AB}, and AB in a geometry line               one segment length  id `AB`
 *   \widehat{AB}, \overparen{AB}, m\widehat{AB}            one arc measure     id `arc_AB`
 *   \triangle ABC (also \Delta ABC)                        one figure          id `tri_ABC`
 *
 * Two capital letters written together are ONE length in a geometry line (`AB = 5`,
 * `AB + BC = AC`, `\frac{AD}{DB} = \frac{AE}{EC}`, `PA \cdot PB = PC \cdot PD`) and a product
 * everywhere else (`V = IR`, `PV = nRT`). The rule (`segmentMode`): at least one pair, no
 * capitals glued to lowercase letters (`nRT`, `mV`), no run of three or more capitals, and every
 * single capital on the line is the argument of a trig function (`\sin A = \frac{BC}{AB}`) —
 * unless the line carries a geometry mark (`\angle`, `\triangle`, `\overline`, `\cong`, …) or
 * two of its pairs share a letter, as the sides of one figure do (`A = AB \cdot BC`). Lowercase
 * `ab` is always a product.
 *
 * A statement about figures — `\triangle ABC \cong \triangle DEF`, `\triangle ABC \sim
 * \triangle DEF`, `AB \parallel CD`, `\overline{AB} \perp \overline{CD}` — is read (a `label`:
 * a fact on the page, nothing to compute or ring), never refused.
 *
 * Pure string work; `latex.ts` calls `markGeometry` before scanning and turns the marked names
 * into single identifiers.
 */

export const ANGLE_PREFIX = "angle_";
export const ARC_PREFIX = "arc_";
export const TRIANGLE_PREFIX = "tri_";

/** Commands that name an arc (Mathpix writes the arc mark several ways). */
export const ARC_COMMANDS: ReadonlySet<string> = new Set(["widehat", "overparen", "wideparen", "overarc", "frown"]);

const TRIG_COMMANDS = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "arcsin", "arccos", "arctan"]);
/** Commands whose `{…}` argument is text or a unit, never a name. */
const TEXT_COMMANDS = new Set(["text", "textrm", "mathrm", "operatorname", "mbox", "textnormal", "textit", "textbf", "mathit", "mathsf"]);
/** Marks that make a line a geometry line on their own. */
const GEOMETRY_MARKS = /\\(?:angle|measuredangle|triangle|overline|cong|parallel|perp|widehat|overparen|wideparen|overarc|odot|overleftrightarrow|overrightarrow|sim)(?![a-zA-Z])/;
/** ALL-CAPS prefixed units a number may carry (`5 MN`): a unit there, not a segment. */
const CAPS_UNITS = new Set(["MJ", "MW", "GW", "TW", "MV", "MN", "GJ", "TJ", "GN", "PJ"]);

/** `m\angle`, `\mathrm{m}\angle`, `m \widehat`: the measure of — the name alone means the measure. */
function dropMeasureM(src: string): string {
  return src.replace(/(^|[^a-zA-Z\\])(?:\\(?:mathrm|operatorname|text)\s*\{\s*m\s*\}|m)\s*(?=\\(?:angle|measuredangle|widehat|overparen|wideparen|overarc)(?![a-zA-Z]))/g, "$1");
}

interface Run {
  start: number;
  end: number;
  text: string;
}

/** Index just past the `{…}` group starting at `open` (or `open` when there is none). */
function skipGroup(src: string, open: number): number {
  let i = open;
  while (src[i] === " ") i++;
  if (src[i] !== "{") return open;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "\\") {
      i++;
      continue;
    }
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i + 1;
  }
  return src.length;
}

/** Index past a script argument `^{…}`, `_x`, `_{…}` starting at the `^`/`_`. */
function skipScript(src: string, at: number): number {
  let i = at + 1;
  while (src[i] === " ") i++;
  if (src[i] === "{") return skipGroup(src, i);
  if (src[i] === "\\") {
    const m = /^\\[a-zA-Z]+/.exec(src.slice(i));
    return i + (m ? m[0].length : 2);
  }
  return i + 1;
}

/** The name after `\angle` / `\triangle`: `ABC`, `A B C`, `1`, `x`, `\theta`, `{ABC}` — its extent. */
function nameExtent(src: string, from: number): number {
  const m = /^\s*(?:\{\s*(?:[A-Z](?:\s*[A-Z]){0,3}|\d{1,2}|[a-z]|\\[a-zA-Z]+)\s*\}|[A-Z](?:\s*[A-Z]){0,3}(?![a-z])|\d{1,2}|[a-z](?![a-zA-Z])|\\[a-zA-Z]+)/.exec(src.slice(from));
  return m ? from + m[0].length : from;
}

interface Scan {
  runs: Run[];
  /** single capitals that are not a trig argument or a name after a mark */
  stray: number;
  /** a capital glued to a lowercase letter (`nRT`), or three capitals together */
  broken: boolean;
}

function scanLetters(src: string): Scan {
  const runs: Run[] = [];
  let stray = 0;
  let broken = false;
  let trigArg = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+)/.exec(src.slice(i));
      if (!m) {
        i += 2;
        continue;
      }
      const name = m[1];
      i += m[0].length;
      if (TEXT_COMMANDS.has(name)) {
        i = skipGroup(src, i);
        continue;
      }
      if (name === "angle" || name === "measuredangle" || name === "triangle" || name === "Delta" || name === "overline" || ARC_COMMANDS.has(name) || name === "overleftrightarrow" || name === "overrightarrow") {
        // the mark consumes its own name
        const g = skipGroup(src, i);
        i = g !== i ? g : nameExtent(src, i);
        continue;
      }
      if (TRIG_COMMANDS.has(name)) {
        trigArg = true;
        // `\sin^{-1}`: the power belongs to the function
        while (src[i] === " ") i++;
        if (src[i] === "^") i = skipScript(src, i);
        continue;
      }
      continue;
    }
    if (ch === "_" || ch === "^") {
      i = skipScript(src, i);
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      const m = /^[a-zA-Z]+/.exec(src.slice(i))!;
      const text = m[0];
      const run: Run = { start: i, end: i + text.length, text };
      i += text.length;
      const upper = /^[A-Z]+$/.test(text);
      if (!upper && /[A-Z]/.test(text)) broken = true;
      else if (upper && text.length >= 3) broken = true;
      else if (upper && text.length === 2) {
        const before = src.slice(0, run.start).trimEnd();
        // `CO_{2}`: a formula, not a segment
        if (src[run.end] === "_") broken = true;
        else if (!(CAPS_UNITS.has(text) && /\d$/.test(before))) runs.push(run);
      } else if (upper && text.length === 1 && !trigArg) stray++;
      trigArg = false;
      continue;
    }
    if (trigArg && !/[\s({]/.test(ch)) trigArg = false;
    i++;
  }
  return { runs, stray, broken };
}

/** Two capitals together are one length in this line (see the file comment). */
export function segmentMode(src: string): boolean {
  const scan = scanLetters(src);
  if (scan.runs.length === 0 || scan.broken) return false;
  if (scan.stray === 0 || GEOMETRY_MARKS.test(src)) return true;
  const letters = scan.runs.map((r) => new Set(r.text));
  for (let a = 0; a < letters.length; a++)
    for (let b = a + 1; b < letters.length; b++) if (scan.runs[a].text !== scan.runs[b].text && [...letters[a]].some((c) => letters[b].has(c))) return true;
  return false;
}

/** A relation on the line: only a whole line decides that `AB` is a length (a side alone cannot). */
const HAS_RELATION = /[=<>]|\\(?:le|ge|leq|geq|ne|neq|cong|approx|lt|gt|parallel|perp|sim)(?![a-zA-Z])/;
/** A reaction arrow: chemistry, never segments. */
const ARROW = /\\(?:rightarrow|longrightarrow|rightleftharpoons|leftrightarrow|to)(?![a-zA-Z])/;

/**
 * The line with its geometry names marked for the scanner: `m\angle` → `\angle`, `\Delta ABC`
 * → `\triangle ABC`, and — in a geometry line — `AB` → `\overline{AB}`. Everything else is
 * left exactly as it was. Called by `preprocessLatex`, so every reader of a line (the engine,
 * the scoreboard's oracle) sees the same names; idempotent.
 *
 * Only a string with a relation (`AB = 5`, `AB + BC = AC`) can promote a pair: the sides of
 * `V = IR` are translated one at a time, and `IR` alone must not look like a geometry line.
 */
export function markGeometry(src: string): string {
  if (!/[A-Z]|\\angle|\\measuredangle/.test(src)) return src;
  let s = dropMeasureM(src);
  s = s.replace(/\\Delta\s*(?=[A-Z]\s*[A-Z]\s*[A-Z](?![a-zA-Z]))/g, "\\triangle ");
  if (!HAS_RELATION.test(s) || ARROW.test(s) || !segmentMode(s)) return s;
  const { runs } = scanLetters(s);
  let out = "";
  let last = 0;
  for (const r of runs) {
    out += s.slice(last, r.start) + `\\overline{${r.text}}`;
    last = r.end;
  }
  return out + s.slice(last);
}

/** The identifier of a name read after a mark (`A B C` → `ABC`, `\theta` → `theta`), or null. */
export function nameId(raw: string): string | null {
  const s = raw.replace(/[{}\s]/g, "");
  if (/^[A-Z]{1,4}$/.test(s) || /^\d{1,2}$/.test(s) || /^[a-z]$/.test(s)) return s;
  const g = /^\\([a-zA-Z]+)$/.exec(s);
  return g ? g[1] : null;
}

/** Reads the name after a mark at `from` in `src`: its id and where it ends; null when none. */
export function readName(src: string, from: number): { id: string; end: number } | null {
  const end = nameExtent(src, from);
  if (end === from) return null;
  const id = nameId(src.slice(from, end));
  return id ? { id, end } : null;
}

export const isAngleName = (id: string): boolean => id.startsWith(ANGLE_PREFIX);
export const isArcName = (id: string): boolean => id.startsWith(ARC_PREFIX);
export const isSegmentName = (id: string): boolean => /^[A-Z]{2}$/.test(id);
export const isTriangleName = (id: string): boolean => id.startsWith(TRIANGLE_PREFIX);
/** A quantity named by a figure: an angle, an arc or a segment (not `x`, not `\theta`). */
export const isGeometryName = (id: string): boolean => isAngleName(id) || isArcName(id) || isSegmentName(id) || isTriangleName(id);

const GREEK_NAMES = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi", "rho", "sigma", "tau", "phi", "chi", "psi", "omega",
]);

/** How the tutor writes a name back: `angle_ABC` → `\angle ABC`, `arc_AB` → `\widehat{AB}`, `x_1` → `x_{1}`. */
export function nameLatex(id: string, opts: { measure?: boolean } = {}): string {
  const m = opts.measure ? "m" : "";
  if (isAngleName(id)) {
    const n = id.slice(ANGLE_PREFIX.length);
    return `${m}\\angle ${GREEK_NAMES.has(n) ? `\\${n}` : n}`;
  }
  if (isArcName(id)) return `${m}\\widehat{${id.slice(ARC_PREFIX.length)}}`;
  if (isTriangleName(id)) return `\\triangle ${id.slice(TRIANGLE_PREFIX.length)}`;
  if (GREEK_NAMES.has(id)) return `\\${id}`;
  const sub = /^([a-zA-Z]+)_([a-zA-Z0-9]+)$/.exec(id);
  if (sub) return `${GREEK_NAMES.has(sub[1]) ? `\\${sub[1]}` : sub[1]}_{${sub[2]}}`;
  return id;
}

/**
 * The identifier of a line that is exactly one geometry name (`\angle C`, `m\angle ABC`, `AB`,
 * `\overline{AB}`, `\widehat{AB}`), or null. The scoreboard reads answers with it.
 */
export function geometryNameOf(latex: string): string | null {
  const s = markGeometry(latex.replace(/\\left|\\right/g, "").trim())
    .replace(/\s+/g, " ")
    .trim();
  let m = /^\\(?:angle|measuredangle)\s*(.+)$/.exec(s);
  if (m) {
    const id = nameId(m[1]);
    return id ? `${ANGLE_PREFIX}${id}` : null;
  }
  m = /^\\(?:widehat|overparen|wideparen|overarc)\s*\{\s*([A-Z](?:\s*[A-Z]){1,2})\s*\}$/.exec(s);
  if (m) return `${ARC_PREFIX}${m[1].replace(/\s/g, "")}`;
  m = /^\\overline\s*\{\s*([A-Z]\s*[A-Z])\s*\}$/.exec(s);
  if (m) return m[1].replace(/\s/g, "");
  m = /^\\triangle\s*([A-Z](?:\s*[A-Z]){2})$/.exec(s);
  if (m) return `${TRIANGLE_PREFIX}${m[1].replace(/\s/g, "")}`;
  return null;
}

const FIGURE_OPS = /\\(?:parallel|perp|sim|cong)(?![a-zA-Z])|\\\|/g;
const FIGURE = /^(?:\\(?:triangle|square|odot)\s*\{?\s*[A-Z](?:\s*[A-Z]){0,4}\s*\}?|\\(?:overline|overleftrightarrow|overrightarrow)\s*\{\s*[A-Z]\s*[A-Z]\s*\}|[A-Z]\s*[A-Z]|[a-z]|[a-z]_\{?\d\}?)$/;

/**
 * `\triangle ABC \cong \triangle DEF`, `\triangle ABC \sim \triangle DEF`, `AB \parallel CD`,
 * `\overline{AB} \perp \overline{CD}`, a list of them: a statement about figures, not a number
 * to check. `\overline{AB} \cong \overline{CD}` is NOT one (two equal lengths: an equation).
 */
export function isFigureStatement(latex: string): boolean {
  const s = latex.replace(/\\left|\\right/g, "").replace(/\s+/g, " ").trim();
  if (!FIGURE_OPS.test(s)) return false;
  FIGURE_OPS.lastIndex = 0;
  const pieces = s.split(/,\s*(?:\\\s)?/).map((p) => p.trim()).filter(Boolean);
  if (pieces.length === 0) return false;
  return pieces.every((piece) => {
    const ops = [...piece.matchAll(/\\(parallel|perp|sim|cong)(?![a-zA-Z])|\\\|/g)].map((m) => m[1] ?? "parallel");
    if (ops.length === 0) return false;
    const sides = piece.split(/\\(?:parallel|perp|sim|cong)(?![a-zA-Z])|\\\|/).map((p) => p.trim());
    if (sides.some((side) => !FIGURE.test(side))) return false;
    // congruent segments are equal lengths (an equation); congruent triangles are a statement
    if (ops.includes("cong") && !sides.every((side) => /^\\(?:triangle|square)/.test(side))) return false;
    return true;
  });
}
