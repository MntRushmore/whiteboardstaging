/**
 * One-variable algebra for Solve: factor, expand, linear/quadratic solve.
 * Compact next step only. No lecture.
 */

type Poly = Map<number, number>;

function coeff(poly: Poly, degree: number): number {
  return poly.get(degree) ?? 0;
}

function setCoeff(poly: Poly, degree: number, value: number): void {
  if (Math.abs(value) < 1e-10) poly.delete(degree);
  else poly.set(degree, value);
}

function addPoly(a: Poly, b: Poly): Poly {
  const out: Poly = new Map(a);
  for (const [d, c] of b) setCoeff(out, d, coeff(out, d) + c);
  return out;
}

function scalePoly(a: Poly, k: number): Poly {
  const out: Poly = new Map();
  if (Math.abs(k) < 1e-10) return out;
  for (const [d, c] of a) setCoeff(out, d, c * k);
  return out;
}

function mulPoly(a: Poly, b: Poly): Poly {
  const out: Poly = new Map();
  for (const [da, ca] of a) {
    for (const [db, cb] of b) setCoeff(out, da + db, coeff(out, da + db) + ca * cb);
  }
  return out;
}

function powPoly(base: Poly, exp: number): Poly | null {
  if (!Number.isInteger(exp) || exp < 0 || exp > 8) return null;
  let out: Poly = new Map([[0, 1]]);
  for (let i = 0; i < exp; i++) out = mulPoly(out, base);
  return out;
}

function degreeOf(poly: Poly): number {
  let d = 0;
  for (const k of poly.keys()) d = Math.max(d, k);
  return d;
}

function nearlyInt(n: number): boolean {
  return Math.abs(n - Math.round(n)) < 1e-8;
}

function asInt(n: number): number {
  return Math.round(n);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(asInt(a));
  let y = Math.abs(asInt(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function divisors(n: number): number[] {
  const abs = Math.abs(asInt(n));
  const out = new Set<number>();
  for (let i = 1; i <= Math.max(1, Math.sqrt(abs)); i++) {
    if (abs % i === 0) {
      out.add(i);
      out.add(-i);
      out.add(abs / i);
      out.add(-(abs / i));
    }
  }
  if (abs === 0) out.add(0);
  return [...out];
}

/** Keep letters. Strip latex wrappers so `x^{2}-x-12` parses. */
export function normalizeAlgebraLatex(latex: string): string {
  let s = latex.trim();
  s = s.replace(/^\$+|\$+$/g, "");
  s = s.replace(/\\left|\\right/g, "");
  s = s.replace(/\\times|\\cdot|·|×/g, "*");
  s = s.replace(/\\div|÷/g, "/");
  s = s.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "(($1)/($2))");
  s = s.replace(/\^\s*\{([^{}]+)\}/g, "^$1");
  s = s.replace(/\{|\}/g, "");
  s = s.replace(/\\[a-zA-Z]+\*?/g, "");
  s = s.replace(/[−–—]/g, "-");
  s = s.replace(/²/g, "^2");
  s = s.replace(/³/g, "^3");
  s = s.replace(/\s+/g, "");
  s = s.replace(/＝/g, "=");
  return s;
}

export function looksLikeAlgebra(latex: string): boolean {
  const s = normalizeAlgebraLatex(latex);
  if (!s) return false;
  if (!/[a-zA-Z]/.test(s)) return false;
  return /[0-9=+\-*^()]/.test(s);
}

function tokenize(src: string): string[] {
  const raw: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\d/.test(ch) || (ch === "." && /\d/.test(src[i + 1] ?? ""))) {
      let n = "";
      while (i < src.length && (/\d/.test(src[i]!) || src[i] === ".")) {
        n += src[i];
        i += 1;
      }
      raw.push(n);
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      raw.push(ch.toLowerCase());
      i += 1;
      continue;
    }
    if ("+-*/^()=".includes(ch)) {
      raw.push(ch);
      i += 1;
      continue;
    }
    i += 1;
  }

  const out: string[] = [];
  const isAtom = (t: string | undefined) =>
    Boolean(t && (/^\d/.test(t) || /^[a-z]$/.test(t) || t === ")"));
  const startsAtom = (t: string) => /^\d/.test(t) || /^[a-z]$/.test(t) || t === "(";
  for (const token of raw) {
    const prev = out[out.length - 1];
    if (isAtom(prev) && startsAtom(token)) out.push("*");
    out.push(token);
  }
  return out;
}

function lettersIn(tokens: string[]): string[] {
  return [...new Set(tokens.filter((t) => /^[a-z]$/.test(t)))];
}

function parsePoly(tokens: string[], variable: string): Poly | null {
  let i = 0;
  const peek = () => tokens[i] ?? "";
  const eat = (t: string) => {
    if (peek() === t) {
      i += 1;
      return true;
    }
    return false;
  };

  const parsePrimary = (): Poly | null => {
    if (eat("(")) {
      const inner = parseExpr();
      if (!inner || !eat(")")) return null;
      return inner;
    }
    const tok = peek();
    if (tok === variable) {
      i += 1;
      return new Map([[1, 1]]);
    }
    if (/^\d/.test(tok)) {
      i += 1;
      const n = Number(tok);
      return Number.isFinite(n) ? new Map([[0, n]]) : null;
    }
    return null;
  };

  const parseUnary = (): Poly | null => {
    if (eat("+")) return parseUnary();
    if (eat("-")) {
      const v = parseUnary();
      return v ? scalePoly(v, -1) : null;
    }
    return parsePrimary();
  };

  const parsePower = (): Poly | null => {
    const base = parseUnary();
    if (!base) return null;
    if (!eat("^")) return base;
    const expTok = peek();
    if (!/^\d+$/.test(expTok)) return null;
    i += 1;
    return powPoly(base, Number(expTok));
  };

  const parseTerm = (): Poly | null => {
    let v = parsePower();
    if (!v) return null;
    while (peek() === "*" || peek() === "/") {
      const op = peek();
      i += 1;
      const r = parsePower();
      if (!r) return null;
      if (op === "/") {
        if (degreeOf(r) !== 0) return null;
        const den = coeff(r, 0);
        if (den === 0) return null;
        v = scalePoly(v, 1 / den);
      } else {
        v = mulPoly(v, r);
      }
    }
    return v;
  };

  const parseExpr = (): Poly | null => {
    let v = parseTerm();
    if (!v) return null;
    while (peek() === "+" || peek() === "-") {
      const op = peek();
      i += 1;
      const r = parseTerm();
      if (!r) return null;
      v = addPoly(v, op === "+" ? r : scalePoly(r, -1));
    }
    return v;
  };

  const value = parseExpr();
  if (!value || i !== tokens.length) return null;
  return value;
}

function formatNumber(n: number): string {
  if (nearlyInt(n)) return String(asInt(n));
  const abs = Math.abs(n);
  for (let den = 2; den <= 24; den++) {
    const num = n * den;
    if (nearlyInt(num)) {
      const a = asInt(num);
      const g = gcd(a, den);
      return `${a / g}/${den / g}`;
    }
    void abs;
  }
  return String(Number(n.toPrecision(6)));
}

function formatLinearFactor(a: number, b: number, v: string): string {
  // ax + b  →  (x-4) or (2x+3)
  if (nearlyInt(a) && nearlyInt(b) && Math.abs(a) === 1) {
    if (b === 0) return a < 0 ? `(-${v})` : `(${v})`;
    const sign = b >= 0 ? "+" : "-";
    return `(${a < 0 ? "-" : ""}${v}${sign}${formatNumber(Math.abs(b))})`;
  }
  const lead = nearlyInt(a) && Math.abs(a) === 1 ? (a < 0 ? `-${v}` : v) : `${formatNumber(a)}${v}`;
  if (Math.abs(b) < 1e-10) return `(${lead})`;
  const sign = b >= 0 ? "+" : "-";
  return `(${lead}${sign}${formatNumber(Math.abs(b))})`;
}

function formatPoly(poly: Poly, v: string): string {
  const degrees = [...poly.keys()].sort((a, b) => b - a);
  if (degrees.length === 0) return "0";
  const parts: string[] = [];
  for (const d of degrees) {
    const c = coeff(poly, d);
    if (Math.abs(c) < 1e-10) continue;
    const sign = c < 0 ? "-" : "+";
    const mag = Math.abs(c);
    let body = "";
    if (d === 0) body = formatNumber(mag);
    else if (d === 1) body = nearlyInt(mag) && asInt(mag) === 1 ? v : `${formatNumber(mag)}${v}`;
    else {
      const lead = nearlyInt(mag) && asInt(mag) === 1 ? "" : formatNumber(mag);
      body = `${lead}${v}^${d}`;
    }
    parts.push(sign, body);
  }
  if (parts[0] === "+") parts.shift();
  let s = parts.join("");
  if (s.startsWith("+")) s = s.slice(1);
  return s.replace(/\+-/g, "-");
}

function factorQuadratic(poly: Poly, v: string): string | null {
  const a = coeff(poly, 2);
  const b = coeff(poly, 1);
  const c = coeff(poly, 0);
  if (!nearlyInt(a) || !nearlyInt(b) || !nearlyInt(c) || a === 0) return null;
  const A = asInt(a);
  const B = asInt(b);
  const C = asInt(c);
  const hits: { p: number; q: number; r: number; s: number }[] = [];
  for (const p of divisors(A)) {
    if (p === 0 || A % p !== 0) continue;
    const r = A / p;
    for (const q of divisors(C === 0 ? 0 : C)) {
      if (q === 0 && C !== 0) continue;
      const s = C === 0 ? 0 : C / q;
      if (!nearlyInt(s)) continue;
      if (p * asInt(s) + q * r === B) {
        hits.push({ p, q, r, s: asInt(s) });
      }
    }
  }
  if (hits.length === 0) return null;
  const preferred = hits.filter((h) => h.p > 0 && h.r > 0);
  const pick = (preferred.length > 0 ? preferred : hits)
    .slice()
    .sort((x, y) => x.q - y.q || x.p - y.p)[0]!;
  return `${formatLinearFactor(pick.p, pick.q, v)}${formatLinearFactor(pick.r, pick.s, v)}`;
}

function solvePoly(poly: Poly, v: string): string | null {
  const d = degreeOf(poly);
  if (d === 1) {
    const a = coeff(poly, 1);
    const b = coeff(poly, 0);
    if (Math.abs(a) < 1e-10) return null;
    return `${v} = ${formatNumber(-b / a)}`;
  }
  if (d === 2) {
    const factored = factorQuadratic(poly, v);
    if (factored) {
      const roots = factored
        .match(/\(([^)]+)\)/g)
        ?.map((f) => {
          const inner = f.slice(1, -1);
          const m = inner.match(new RegExp(`^${v}([+-].+)$`));
          if (!m) return null;
          const n = Number(m[1]);
          if (!Number.isFinite(n)) return null;
          return formatNumber(-n);
        })
        .filter((x): x is string => Boolean(x));
      if (roots?.length) return `${v} = ${roots.join(", ")}`;
    }
    const a = coeff(poly, 2);
    const b = coeff(poly, 1);
    const c = coeff(poly, 0);
    const disc = b * b - 4 * a * c;
    if (disc < -1e-10) return null;
    const sqrt = Math.sqrt(Math.max(0, disc));
    const r1 = (-b + sqrt) / (2 * a);
    const r2 = (-b - sqrt) / (2 * a);
    if (Math.abs(r1 - r2) < 1e-8) return `${v} = ${formatNumber(r1)}`;
    return `${v} = ${formatNumber(r1)}, ${formatNumber(r2)}`;
  }
  return null;
}

function looksFactored(src: string): boolean {
  return /^\([^()=]+\)\([^()=]+\)$/.test(src);
}

function compactStep(text: string): string {
  return text.replace(/\s+/g, "");
}

function sameMath(a: string, b: string): boolean {
  return compactStep(a) === compactStep(b);
}

/** Next compact algebra step, or null to stay quiet. */
export function algebraNextStep(latex: string): string | null {
  const src = normalizeAlgebraLatex(latex);
  if (!src || !looksLikeAlgebra(src)) return null;

  const tokens = tokenize(src);
  const vars = lettersIn(tokens);
  if (vars.length !== 1) return null;
  const v = vars[0]!;

  const eq = tokens.indexOf("=");
  if (eq !== -1) {
    const leftTok = tokens.slice(0, eq);
    const rightTok = tokens.slice(eq + 1);
    if (leftTok.length === 0) return null;
    const left = parsePoly(leftTok, v);
    const right = rightTok.length === 0 ? new Map([[0, 0]]) : parsePoly(rightTok, v);
    if (!left || !right) return null;
    const diff = addPoly(left, scalePoly(right, -1));
    const solved = solvePoly(diff, v);
    if (!solved || sameMath(solved, src)) return null;
    return solved;
  }

  if (looksFactored(src)) {
    const poly = parsePoly(tokens, v);
    if (!poly) return null;
    const expanded = formatPoly(poly, v);
    if (!expanded || sameMath(expanded, src)) return null;
    return expanded;
  }

  const poly = parsePoly(tokens, v);
  if (!poly) return null;
  if (degreeOf(poly) === 2) {
    const factored = factorQuadratic(poly, v);
    if (factored && !sameMath(factored, src)) return factored;
  }
  return null;
}
