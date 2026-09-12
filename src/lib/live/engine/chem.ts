/**
 * Chemistry: formula parsing (parentheses, hydrates, charges, state labels), molar masses for all
 * 118 elements, and equation balancing via an exact rational nullspace.
 * Pure TypeScript, no mathjs.
 */

/** Standard atomic weights (g/mol); radioactive elements use the mass number of the most stable isotope. */
export const ELEMENTS: Record<string, number> = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.18,
  Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948, K: 39.098, Ca: 40.078,
  Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38,
  Ga: 69.723, Ge: 72.63, As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224,
  Nb: 92.906, Mo: 95.95, Tc: 98, Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71,
  Sb: 121.76, Te: 127.6, I: 126.9, Xe: 131.29, Cs: 132.91, Ba: 137.33, La: 138.91, Ce: 140.12, Pr: 140.91, Nd: 144.24,
  Pm: 145, Sm: 150.36, Eu: 151.96, Gd: 157.25, Tb: 158.93, Dy: 162.5, Ho: 164.93, Er: 167.26, Tm: 168.93, Yb: 173.05,
  Lu: 174.97, Hf: 178.49, Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59,
  Tl: 204.38, Pb: 207.2, Bi: 208.98, Po: 209, At: 210, Rn: 222, Fr: 223, Ra: 226, Ac: 227, Th: 232.04,
  Pa: 231.04, U: 238.03, Np: 237, Pu: 244, Am: 243, Cm: 247, Bk: 247, Cf: 251, Es: 252, Fm: 257,
  Md: 258, No: 259, Lr: 266, Rf: 267, Db: 268, Sg: 269, Bh: 270, Hs: 277, Mt: 278, Ds: 281,
  Rg: 282, Cn: 285, Nh: 286, Fl: 289, Mc: 290, Lv: 293, Ts: 294, Og: 294,
};

export const ELEMENT_COUNT = Object.keys(ELEMENTS).length;

export function isElement(symbol: string): boolean {
  return Object.prototype.hasOwnProperty.call(ELEMENTS, symbol);
}

export interface Formula {
  /** element -> atom count (hydrate water included) */
  counts: Map<string, number>;
  charge: number;
  /** leading stoichiometric coefficient as written (1 when absent) */
  coefficient: number;
  /** formula without coefficient/state, normalized (Fe2O3, Cu(OH)2, CuSO4·5H2O) */
  formula: string;
  /** (s) (l) (g) (aq) label, '' when absent */
  state: string;
}

const ARROWS = [
  "\\longrightarrow",
  "\\rightleftharpoons",
  "\\leftrightarrow",
  "\\rightarrow",
  "\\xrightarrow",
  "\\to",
  "-->",
  "->",
  "→",
  "⇌",
  "⟶",
  "=>",
];

/** Strips LaTeX wrappers so `Fe_{2}O_{3}` -> `Fe2O3`, `\mathrm{H}_2\mathrm{O}` -> `H2O`, `\cdot 5H_2O` -> `·5H2O`. */
export function normalizeChemText(text: string): string {
  let s = text.replace(/\r?\n/g, " ").trim();
  s = s.replace(/^\$+|\$+$/g, "");
  s = s.replace(/\\xrightarrow\s*\{[^}]*\}/g, " -> ");
  for (const a of ARROWS) s = s.split(a).join(" -> ");
  s = s.replace(/\\left|\\right|\\displaystyle|\\,|\\;|\\:|\\!|\\quad|\\qquad|~/g, " ");
  s = s.replace(/\\(?:mathrm|text|textrm|mathit|operatorname|mbox)\s*\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\cdot|\\bullet|\\ast|·|⋅|\*/g, "·");
  s = s.replace(/_\s*\{\s*(\d+)\s*\}/g, "$1");
  s = s.replace(/_\s*(\d)/g, "$1");
  s = s.replace(/\^\s*\{\s*([0-9]*[+-])\s*\}/g, "^$1");
  s = s.replace(/\^\s*([0-9]*[+-])/g, "^$1");
  s = s.replace(/[{}]/g, "");
  s = s.replace(/[−–—]/g, "-");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

const STATE_RE = /\((s|l|g|aq)\)$/i;

interface ParseCursor {
  i: number;
}

function parseGroup(src: string, cur: ParseCursor, close: string | null): Map<string, number> | null {
  const counts = new Map<string, number>();
  const add = (el: string, n: number) => counts.set(el, (counts.get(el) ?? 0) + n);
  while (cur.i < src.length) {
    const ch = src[cur.i];
    if (ch === " ") {
      cur.i++;
      continue;
    }
    if (close !== null && ch === close) {
      cur.i++;
      return counts;
    }
    if (ch === "(" || ch === "[") {
      cur.i++;
      const inner = parseGroup(src, cur, ch === "(" ? ")" : "]");
      if (!inner) return null;
      const mult = readNumber(src, cur) ?? 1;
      for (const [el, n] of inner) add(el, n * mult);
      continue;
    }
    if (ch === ")" || ch === "]") return null;
    if (/[A-Z]/.test(ch)) {
      let sym = ch;
      if (/[a-z]/.test(src[cur.i + 1] ?? "")) sym += src[cur.i + 1];
      if (!isElement(sym)) {
        // try single-letter element when the two-letter guess fails (e.g. "CO" -> C, O)
        if (sym.length === 2 && isElement(ch)) sym = ch;
        else return null;
      }
      cur.i += sym.length;
      const n = readNumber(src, cur) ?? 1;
      add(sym, n);
      continue;
    }
    return null;
  }
  return close === null ? counts : null;
}

function readNumber(src: string, cur: ParseCursor): number | null {
  const m = /^\d+/.exec(src.slice(cur.i));
  if (!m) return null;
  cur.i += m[0].length;
  return Number(m[0]);
}

/** Parses one species (`2Fe2O3`, `Cu(OH)2`, `CuSO4·5H2O`, `SO4^2-`, `NaCl(aq)`). Null when not a formula. */
export function parseFormula(text: string): Formula | null {
  let s = normalizeChemText(text).replace(/\s+/g, "");
  if (!s) return null;
  let state = "";
  const st = STATE_RE.exec(s);
  if (st) {
    state = st[1].toLowerCase();
    s = s.slice(0, st.index);
  }
  let coefficient = 1;
  const lead = /^(\d+)(?=[A-Z(\[])/.exec(s);
  if (lead) {
    coefficient = Number(lead[1]);
    s = s.slice(lead[0].length);
  }
  let charge = 0;
  const ch = /\^?(\d*)([+-])$/.exec(s);
  if (ch) {
    charge = (ch[1] ? Number(ch[1]) : 1) * (ch[2] === "-" ? -1 : 1);
    s = s.slice(0, ch.index);
  }
  if (!s || !/^[A-Z(\[]/.test(s)) return null;
  const counts = new Map<string, number>();
  const parts = s.split("·");
  for (const part of parts) {
    if (!part) return null;
    const m = /^(\d*)(.*)$/.exec(part);
    const mult = m && m[1] ? Number(m[1]) : 1;
    const body = m ? m[2] : part;
    const cur: ParseCursor = { i: 0 };
    const inner = parseGroup(body, cur, null);
    if (!inner || inner.size === 0) return null;
    for (const [el, n] of inner) counts.set(el, (counts.get(el) ?? 0) + n * mult);
  }
  return { counts, charge, coefficient, formula: s, state };
}

/** g/mol with two decimals, or null. */
export function molarMass(formula: string): number | null {
  const f = parseFormula(formula);
  if (!f) return null;
  let total = 0;
  for (const [el, n] of f.counts) total += ELEMENTS[el] * n;
  return Math.round(total * 1000) / 1000;
}

export interface ChemEquation {
  reactants: Formula[];
  products: Formula[];
}

/** Splits on `+` between species while keeping ionic charges (`Ag^+`, `SO4^2-`) intact. */
function splitTerms(side: string): string[] {
  const protectedSide = side.replace(/\^(\d*)\+/g, "^$1⁺").replace(/\^(\d*)-/g, "^$1⁻");
  return protectedSide
    .split(/\s*\+\s*/)
    .map((t) => t.replace(/⁺/g, "+").replace(/⁻/g, "-").trim())
    .filter(Boolean);
}

/** `Fe + O_2 \rightarrow Fe_2O_3` -> reactants/products; null when either side is not all formulas. */
export function parseEquation(text: string): ChemEquation | null {
  const s = normalizeChemText(text);
  const sides = s.split("->");
  if (sides.length !== 2) return null;
  const reactants = splitTerms(sides[0]).map(parseFormula);
  const products = splitTerms(sides[1]).map(parseFormula);
  if (reactants.length === 0 || products.length === 0) return null;
  if (reactants.some((f) => f === null) || products.some((f) => f === null)) return null;
  return { reactants: reactants as Formula[], products: products as Formula[] };
}

/** Quick test used by classification: an arrow with element formulas on both sides. */
export function looksLikeChemEquation(text: string): boolean {
  const s = normalizeChemText(text);
  if (!s.includes("->")) return false;
  return parseEquation(s) !== null;
}

/** A lone formula such as `H_2O`, `CO_2`, `C_6H_{12}O_6`: >= 2 element symbols and an explicit subscript. */
export function looksLikeChemFormula(text: string): boolean {
  if (!/_/.test(text)) return false;
  const f = parseFormula(text);
  if (!f) return false;
  const symbols = f.formula.match(/[A-Z][a-z]?/g) ?? [];
  return symbols.length >= 2 && f.counts.size >= 2;
}

// --- exact rational arithmetic ---------------------------------------------
interface Rat {
  n: number;
  d: number;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function rat(n: number, d = 1): Rat {
  if (d === 0) throw new Error("division by zero");
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const ratSub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const ratMul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);
const ratDiv = (a: Rat, b: Rat): Rat => rat(a.n * b.d, a.d * b.n);
const isZero = (a: Rat): boolean => a.n === 0;

/**
 * One-dimensional integer nullspace of an integer matrix (rows = elements, cols = species),
 * scaled to the smallest positive integers. Null when the nullspace is not exactly one-dimensional.
 */
export function integerNullspace(matrix: number[][]): number[] | null {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  if (cols === 0) return null;
  const a: Rat[][] = matrix.map((r) => r.map((v) => rat(v)));
  const pivotCols: number[] = [];
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    let p = -1;
    for (let i = r; i < rows; i++) {
      if (!isZero(a[i][c])) {
        p = i;
        break;
      }
    }
    if (p === -1) continue;
    [a[r], a[p]] = [a[p], a[r]];
    const pv = a[r][c];
    for (let j = 0; j < cols; j++) a[r][j] = ratDiv(a[r][j], pv);
    for (let i = 0; i < rows; i++) {
      if (i === r || isZero(a[i][c])) continue;
      const f = a[i][c];
      for (let j = 0; j < cols; j++) a[i][j] = ratSub(a[i][j], ratMul(f, a[r][j]));
    }
    pivotCols.push(c);
    r++;
  }
  const free = [];
  for (let c = 0; c < cols; c++) if (!pivotCols.includes(c)) free.push(c);
  if (free.length !== 1) return null;
  const fc = free[0];
  const solution: Rat[] = new Array<Rat>(cols).fill(rat(0));
  solution[fc] = rat(1);
  pivotCols.forEach((pc, idx) => {
    // row idx: x_pc + a[idx][fc] * x_fc = 0
    solution[pc] = rat(-a[idx][fc].n, a[idx][fc].d);
  });
  let lcm = 1;
  for (const s of solution) lcm = (lcm * s.d) / gcd(lcm, s.d);
  let ints = solution.map((s) => (s.n * lcm) / s.d);
  let g = 0;
  for (const v of ints) g = gcd(g, v);
  ints = ints.map((v) => v / (g || 1));
  if (ints.every((v) => v < 0)) ints = ints.map((v) => -v);
  if (ints.some((v) => v <= 0)) return null;
  return ints;
}

/** Smallest positive integer coefficients, or null when impossible / ambiguous / any coefficient > 30. */
export function balanceEquation(eq: ChemEquation, maxCoefficient = 30): number[] | null {
  const species = [...eq.reactants, ...eq.products];
  const elements = new Set<string>();
  for (const f of species) for (const el of f.counts.keys()) elements.add(el);
  const matrix: number[][] = [];
  for (const el of elements) {
    matrix.push(species.map((f, i) => (i < eq.reactants.length ? 1 : -1) * (f.counts.get(el) ?? 0)));
  }
  if (species.some((f) => f.charge !== 0)) {
    matrix.push(species.map((f, i) => (i < eq.reactants.length ? 1 : -1) * f.charge));
  }
  const coeffs = integerNullspace(matrix);
  if (!coeffs) return null;
  if (coeffs.some((c) => c > maxCoefficient)) return null;
  return coeffs;
}

/** Atom (and charge) conservation with the coefficients as written. */
export function isBalanced(eq: ChemEquation): boolean {
  const totals = new Map<string, number>();
  let charge = 0;
  const apply = (list: Formula[], sign: number) => {
    for (const f of list) {
      for (const [el, n] of f.counts) totals.set(el, (totals.get(el) ?? 0) + sign * n * f.coefficient);
      charge += sign * f.charge * f.coefficient;
    }
  };
  apply(eq.reactants, 1);
  apply(eq.products, -1);
  if (charge !== 0) return false;
  for (const v of totals.values()) if (v !== 0) return false;
  return true;
}

export function formulaLatex(f: Formula): string {
  let body = f.formula
    .replace(/(\d+)/g, "_{$1}")
    .replace(/·_\{(\d+)\}/g, "\\cdot $1")
    .replace(/·/g, "\\cdot ");
  if (f.charge !== 0) {
    const mag = Math.abs(f.charge);
    body += `^{${mag === 1 ? "" : mag}${f.charge < 0 ? "-" : "+"}}`;
  }
  const state = f.state ? `\\,(${f.state})` : "";
  return `\\mathrm{${body}}${state}`;
}

export function equationLatex(eq: ChemEquation, coeffs?: number[]): string {
  const term = (f: Formula, i: number): string => {
    const c = coeffs ? coeffs[i] : f.coefficient;
    return `${c === 1 ? "" : `${c}\\,`}${formulaLatex(f)}`;
  };
  const left = eq.reactants.map((f, i) => term(f, i)).join(" + ");
  const right = eq.products.map((f, i) => term(f, eq.reactants.length + i)).join(" + ");
  return `${left} \\rightarrow ${right}`;
}

export interface BalanceResult {
  coeffs: number[];
  latex: string;
  /** true when the coefficients as written already balance */
  alreadyBalanced: boolean;
}

/** `Fe + O_2 \rightarrow Fe_2O_3` -> { coeffs: [4, 3, 2], latex: '4\,\mathrm{Fe} + 3\,\mathrm{O_{2}} \rightarrow 2\,\mathrm{Fe_{2}O_{3}}' } */
export function balance(equation: string): BalanceResult | null {
  const eq = parseEquation(equation);
  if (!eq) return null;
  const coeffs = balanceEquation(eq);
  if (!coeffs) return null;
  return { coeffs, latex: equationLatex(eq, coeffs), alreadyBalanced: isBalanced(eq) };
}

export function molarMassLatex(formula: string): string | null {
  const mass = molarMass(formula);
  if (mass === null) return null;
  return `${Number(mass.toPrecision(5))}\\,\\mathrm{g/mol}`;
}
