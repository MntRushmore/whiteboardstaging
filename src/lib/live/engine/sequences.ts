/**
 * Sequences and series (F-BF.2, F-LE.2, A-SSE.4) and a mean (S-ID.2), from the lines above:
 *
 *   3, 7, 11, 15, \ldots        3, 7, 11, \ldots        2, 6, 18, \ldots         a_{1} = 2
 *   a_{10} = ?                  a_{n} = ?               S_{6} = ?                a_{n} = a_{n - 1} + 5
 *   d = 7 - 3                   d = 7 - 3               r = \frac{6}{2}          a_{n} = ?
 *   d = 4                       d = 4                   r = 3                    d = 5
 *   a_{10} = 3 + (10 - 1) \cdot 4   a_{n} = 3 + (n - 1) \cdot 4   S_{6} = \frac{2(1 - 3^{6})}{1 - 3}   a_{n} = 2 + (n - 1) \cdot 5
 *   a_{10} = 3 + 36             a_{n} = 3 + 4n - 4      S_{6} = \frac{2(-728)}{-2}   a_{n} = 2 + 5n - 5
 *   a_{10} = 39                 a_{n} = 4n - 1          S_{6} = 728              a_{n} = 5n - 3
 *
 * Arithmetic or geometric from a list of terms (at least three, the difference or the ratio
 * constant), from `a_{1}` with `d` / `r`, or from a recursive rule; the nth term, the explicit
 * formula, a finite sum (`S_{10}`), an infinite geometric sum (`S = \frac{a_{1}}{1 - r}`, only
 * when |r| < 1). A sum in sigma notation (`\sum_{n=1}^{10}(2n + 1)`, `\sum_{n=1}^{\infty} …`) is
 * the same sums. `\bar{x} = ?` under a list is its mean. Exact rationals; every answer is checked
 * against the terms themselves.
 */
import { q, qAdd, qDiv, qMul, qNeg, type Q } from "./algebra";
import { evalLatex, questionName, splitEquation, type CourseDeps } from "./courseKit";
import { exactly, qFromNumber, qIsZero, qPow } from "./poly";

const qTex = (a: Q): string => (a.d === 1 ? String(a.n) : `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`);
const qParen = (a: Q): string => (a.n < 0 || a.d !== 1 ? `(${qTex(a)})` : qTex(a));
/** a number after `+`, `-` or `\cdot`: only a negative one needs a bracket */
const qSigned = (a: Q): string => (a.n < 0 ? `(${qTex(a)})` : qTex(a));
const eq = (a: Q, b: Q) => a.n * b.d === b.n * a.d;

function valueQ(deps: CourseDeps, latex: string): Q | null {
  const v = evalLatex(deps, latex);
  if (!v || Math.abs(v.im) > 1e-12) return null;
  return qFromNumber(v.re);
}

/** `3, 7, 11, 15, \ldots` → [3, 7, 11, 15]; null for anything else. */
export function listOf(deps: CourseDeps, latex: string): Q[] | null {
  const s = latex.replace(/\\(?:ldots|cdots|dots)|\.\.\./g, "").replace(/\\[,;: ]/g, " ").trim().replace(/,\s*$/, "");
  const parts = s.split(",").map((p) => p.trim());
  if (parts.length < 3 || parts.some((p) => !p || /[a-zA-Z=<>]/.test(p.replace(/\\frac/g, "")))) return null;
  const out: Q[] = [];
  for (const p of parts) {
    const v = valueQ(deps, p);
    if (!v) return null;
    out.push(v);
  }
  return out;
}

type Kind = "arithmetic" | "geometric";

interface Sequence {
  name: string;
  kind: Kind;
  a1: Q;
  /** the difference or the ratio */
  step: Q;
  /** how the step was found, written as lines (`d = 7 - 3`, `d = 4`) */
  stepLines: string[];
  /** given explicitly as `a_{n} = …` (substitute into it instead) */
  explicit?: string;
}

const SUB = String.raw`_\s*\{?\s*([^{}]+?)\s*\}?`;

/** `a_{10}` → { name: a, index: "10" }. */
function subscripted(latex: string): { name: string; index: string } | null {
  const m = new RegExp(`^\\s*([a-zA-Z])\\s*${SUB}\\s*$`).exec(latex);
  return m ? { name: m[1], index: m[2].replace(/\s+/g, " ").trim() } : null;
}

function fromList(terms: Q[], name: string): Sequence | null {
  const d = qAdd(terms[1], qNeg(terms[0]));
  if (terms.every((t, i) => i === 0 || eq(qAdd(t, qNeg(terms[i - 1])), d))) {
    return { name, kind: "arithmetic", a1: terms[0], step: d, stepLines: [`d = ${qTex(terms[1])} - ${qSigned(terms[0])}`, `d = ${qTex(d)}`] };
  }
  if (terms.some(qIsZero)) return null;
  const r = qDiv(terms[1], terms[0]);
  if (terms.every((t, i) => i === 0 || eq(qDiv(t, terms[i - 1]), r))) {
    return { name, kind: "geometric", a1: terms[0], step: r, stepLines: [terms[0].d === 1 && terms[1].d === 1 ? `r = \\frac{${qTex(terms[1])}}{${qTex(terms[0])}}` : `r = ${qTex(terms[1])} \\div ${qSigned(terms[0])}`, `r = ${qTex(r)}`] };
  }
  return null;
}

/** The sequence the lines above describe, or null. */
function sequenceOf(deps: CourseDeps, lines: readonly string[]): Sequence | null {
  let list: Q[] | null = null;
  let a1: Q | null = null;
  let d: Q | null = null;
  let r: Q | null = null;
  let name = "a";
  let recursive: { kind: Kind; step: Q; line: string } | null = null;
  let explicit: string | null = null;
  for (const l of lines) {
    const ls = listOf(deps, l);
    if (ls) {
      list = ls;
      continue;
    }
    const sides = splitEquation(l);
    if (!sides) return null;
    const left = sides[0].trim();
    if (left === "d") {
      d = valueQ(deps, sides[1]);
      if (!d) return null;
      continue;
    }
    if (left === "r") {
      r = valueQ(deps, sides[1]);
      if (!r) return null;
      continue;
    }
    const sub = subscripted(left);
    if (!sub) return null;
    name = sub.name;
    if (sub.index === "1") {
      a1 = valueQ(deps, sides[1]);
      if (!a1) return null;
      continue;
    }
    if (sub.index === "n") {
      // `a_{n} = a_{n - 1} + 5`, `a_{n} = 3a_{n - 1}`, or an explicit rule in n
      const prev = new RegExp(`${sub.name}\\s*_\\s*\\{\\s*n\\s*-\\s*1\\s*\\}`);
      const rhs = sides[1];
      if (prev.test(rhs)) {
        const plus = new RegExp(`^\\s*${sub.name}\\s*_\\s*\\{\\s*n\\s*-\\s*1\\s*\\}\\s*([+-])\\s*(.+)$`).exec(rhs);
        const times = new RegExp(`^\\s*(.+?)\\s*(?:\\\\cdot\\s*)?${sub.name}\\s*_\\s*\\{\\s*n\\s*-\\s*1\\s*\\}\\s*$`).exec(rhs) ?? new RegExp(`^\\s*${sub.name}\\s*_\\s*\\{\\s*n\\s*-\\s*1\\s*\\}\\s*\\\\cdot\\s*(.+)$`).exec(rhs);
        if (plus) {
          const v = valueQ(deps, plus[2]);
          if (!v) return null;
          const step = plus[1] === "-" ? qNeg(v) : v;
          recursive = { kind: "arithmetic", step, line: `d = ${qTex(step)}` };
        } else if (times) {
          const v = valueQ(deps, times[1]);
          if (!v) return null;
          recursive = { kind: "geometric", step: v, line: `r = ${qTex(v)}` };
        } else return null;
        continue;
      }
      if (/n/.test(rhs.replace(/\\[a-zA-Z]+/g, ""))) {
        explicit = rhs;
        continue;
      }
    }
    return null;
  }
  if (explicit) return { name, kind: "arithmetic", a1: q(0), step: q(0), stepLines: [], explicit };
  if (list) {
    const s = fromList(list, name);
    if (!s) return null;
    if (d && s.kind === "arithmetic") s.stepLines = [];
    if (r && s.kind === "geometric") s.stepLines = [];
    return s;
  }
  if (a1 && recursive) return { name, kind: recursive.kind, a1, step: recursive.step, stepLines: [recursive.line] };
  if (a1 && d) return { name, kind: "arithmetic", a1, step: d, stepLines: [] };
  if (a1 && r) return { name, kind: "geometric", a1, step: r, stepLines: [] };
  return null;
}

/** The kth term's value. */
function termValue(s: Sequence, k: number): Q {
  return s.kind === "arithmetic" ? qAdd(s.a1, qMul(q(k - 1), s.step)) : qMul(s.a1, qPow(s.step, k - 1));
}

function nthTermLines(s: Sequence, k: number): string[] {
  const head = `${s.name}_{${k}}`;
  const value = termValue(s, k);
  if (s.kind === "arithmetic") {
    const times = qMul(q(k - 1), s.step);
    return [
      `${head} = ${qTex(s.a1)} + (${k} - 1) \\cdot ${qSigned(s.step)}`,
      `${head} = ${qTex(s.a1)} + ${times.n < 0 ? `(${qTex(times)})` : qTex(times)}`,
      `${head} = ${qTex(value)}`,
    ];
  }
  const power = qPow(s.step, k - 1);
  return [
    `${head} = ${qTex(s.a1)} \\cdot ${qParen(s.step)}^{${k} - 1}`,
    `${head} = ${qTex(s.a1)} \\cdot ${qSigned(power)}`,
    `${head} = ${qTex(value)}`,
  ];
}

/** `a_{n} = 3 + (n - 1) \cdot 4`, `a_{n} = 3 + 4n - 4`, `a_{n} = 4n - 1` (arithmetic); `a_{n} = 2 \cdot 3^{n - 1}` (geometric). */
function explicitLines(s: Sequence): string[] {
  const head = `${s.name}_{n}`;
  if (s.kind === "geometric") return [`${head} = ${qTex(s.a1)} \\cdot ${qParen(s.step)}^{n - 1}`];
  const c = qAdd(s.a1, qNeg(s.step));
  const lin = (k: Q, b: Q) => {
    const kt = k.n === 1 && k.d === 1 ? "n" : k.n === -1 && k.d === 1 ? "-n" : `${qTex(k)}n`;
    if (qIsZero(k)) return qTex(b);
    return qIsZero(b) ? kt : `${kt} ${b.n < 0 ? "-" : "+"} ${qTex({ n: Math.abs(b.n), d: b.d })}`;
  };
  const expanded = `${qTex(s.a1)} ${s.step.n < 0 ? "-" : "+"} ${qTex({ n: Math.abs(s.step.n), d: s.step.d })}n ${s.step.n < 0 ? "+" : "-"} ${qTex({ n: Math.abs(s.step.n), d: s.step.d })}`;
  return [`${head} = ${qTex(s.a1)} + (n - 1) \\cdot ${qSigned(s.step)}`, `${head} = ${expanded}`, `${head} = ${lin(s.step, c)}`];
}

function sumLines(s: Sequence, k: number, head: string): string[] | null {
  if (s.kind === "arithmetic") {
    const last = termValue(s, k);
    const lastLines = nthTermLines(s, k);
    const total = qMul(q(k, 2), qAdd(s.a1, last));
    const half = q(k, 2);
    return [lastLines[1], lastLines[2], `${head} = \\frac{${k}}{2}(${qTex(s.a1)} + ${qSigned(last)})`, `${head} = ${qTex(half)} \\cdot ${qSigned(qAdd(s.a1, last))}`, `${head} = ${qTex(total)}`];
  }
  if (eq(s.step, q(1))) return null;
  const rk = qPow(s.step, k);
  const top = qAdd(q(1), qNeg(rk));
  const bottom = qAdd(q(1), qNeg(s.step));
  const total = qDiv(qMul(s.a1, top), bottom);
  return [`${head} = \\frac{${qTex(s.a1)}(1 - ${qParen(s.step)}^{${k}})}{1 - ${qSigned(s.step)}}`, `${head} = \\frac{${qTex(s.a1)}${qParen(top)}}{${qTex(bottom)}}`, `${head} = ${qTex(total)}`];
}

function infiniteLines(s: Sequence, head: string): string[] | null {
  if (s.kind !== "geometric" || Math.abs(s.step.n / s.step.d) >= 1) return null;
  const bottom = qAdd(q(1), qNeg(s.step));
  return [`${head} = \\frac{${qTex(s.a1)}}{1 - ${qSigned(s.step)}}`, `${head} = \\frac{${qTex(s.a1)}}{${qTex(bottom)}}`, `${head} = ${qTex(qDiv(s.a1, bottom))}`];
}

function dedupe(deps: CourseDeps, lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) if (!out.some((o) => deps.normalize(o) === deps.normalize(l))) out.push(l);
  return out;
}

/** The value a sum line claims, checked against adding the terms up (or the geometric limit). */
function checkSum(s: Sequence, k: number | null, claimed: Q): boolean {
  if (k === null) {
    // S = a1 / (1 - r): the partial sums close in on it
    let partial = 0;
    for (let i = 1; i <= 200; i++) partial += (s.a1.n / s.a1.d) * (s.step.n / s.step.d) ** (i - 1);
    return Math.abs(partial - claimed.n / claimed.d) < 1e-9 * Math.max(1, Math.abs(partial));
  }
  let total = q(0);
  for (let i = 1; i <= k; i++) total = qAdd(total, termValue(s, i));
  return eq(total, claimed);
}

/**
 * The column's sequence question answered, or null: `a_{k} = ?`, `a_{n} = ?`, `S_{k} = ?`,
 * `S = ?` / `S_{\infty} = ?`, `d = ?`, `r = ?`, and `\bar{x} = ?` under a list (its mean).
 */
export function sequenceAnswer(deps: CourseDeps, lines: readonly string[]): { latex: string; steps: string[] } | null {
  try {
    return exactly(() => {
      const target = lines[lines.length - 1] ?? "";
      const asked = questionName(target);
      if (!asked) return null;
      const above = lines.slice(0, -1);
      // the mean of a list
      if (/^\\(?:bar|overline)\{([a-zA-Z])\}$/.test(asked)) {
        if (above.length !== 1) return null;
        const values = listOf(deps, above[0].replace(/\\(?:ldots|cdots|dots)/g, "")) ?? null;
        if (!values || /\\(?:ldots|cdots|dots)/.test(above[0])) return null;
        const total = values.reduce((a, b) => qAdd(a, b), q(0));
        const mean = qDiv(total, q(values.length));
        const sum = values.map((v, i) => (i === 0 ? qTex(v) : v.n < 0 ? ` - ${qTex(qNeg(v))}` : ` + ${qTex(v)}`)).join("");
        const steps = dedupe(deps, [`${asked} = \\frac{${sum}}{${values.length}}`, `${asked} = \\frac{${qTex(total)}}{${values.length}}`, `${asked} = ${qTex(mean)}`]);
        return { latex: steps[steps.length - 1], steps };
      }
      const s = sequenceOf(deps, above);
      if (!s) return null;
      const sub = subscripted(asked);
      let body: string[] | null = null;
      if (s.explicit) {
        // substitute into the rule the student wrote
        if (!sub || !/^\d+$/.test(sub.index) || sub.name !== s.name) return null;
        const k = Number(sub.index);
        const head = `${s.name}_{${k}}`;
        const rhs = s.explicit.replace(/(^|[^a-zA-Z\\])n(?![a-zA-Z])/g, (_m, pre: string) => `${pre}(${k})`);
        const value = valueQ(deps, rhs);
        if (!value) return null;
        body = [`${head} = ${tidyProduct(rhs)}`, `${head} = ${qTex(value)}`];
        const at = valueQ(deps, s.explicit.replace(/(^|[^a-zA-Z\\])n(?![a-zA-Z])/g, (_m, pre: string) => `${pre}(${k})`));
        if (!at || !eq(at, value)) return null;
        const steps = dedupe(deps, body);
        return { latex: steps[steps.length - 1], steps };
      }
      if (asked === "d" && s.kind === "arithmetic") body = [];
      else if (asked === "r" && s.kind === "geometric") body = [];
      else if (sub && sub.name === s.name && /^\d+$/.test(sub.index)) body = nthTermLines(s, Number(sub.index));
      else if (sub && sub.name === s.name && sub.index === "n") body = explicitLines(s);
      else if (sub && sub.name === "S" && /^\d+$/.test(sub.index)) body = sumLines(s, Number(sub.index), asked.replace(/\s+/g, ""));
      else if ((asked === "S" || (sub && sub.name === "S" && sub.index === "\\infty")) && s.kind === "geometric") body = infiniteLines(s, asked === "S" ? "S" : "S_{\\infty}");
      if (!body) return null;
      const steps = dedupe(deps, [...s.stepLines, ...body]);
      if (steps.length === 0 || steps.length > 8) return null;
      const final = steps[steps.length - 1];
      // the check: the answer against the terms themselves
      const claimed = splitEquation(final);
      if (!claimed) return null;
      if (sub && sub.index === "n") {
        for (const k of [1, 2, 3, 7]) {
          const v = valueQ(deps, claimed[1].replace(/(^|[^a-zA-Z\\])n(?![a-zA-Z])/g, (_m, pre: string) => `${pre}(${k})`));
          if (!v || !eq(v, termValue(s, k))) return null;
        }
      } else {
        const v = valueQ(deps, claimed[1]);
        if (!v) return null;
        if (sub && sub.name === "S" && /^\d+$/.test(sub.index)) {
          if (!checkSum(s, Number(sub.index), v)) return null;
        } else if (asked === "S" || sub?.index === "\\infty") {
          if (!checkSum(s, null, v)) return null;
        } else if (sub && /^\d+$/.test(sub.index)) {
          if (!eq(v, termValue(s, Number(sub.index)))) return null;
        } else if (!eq(v, s.step)) return null;
      }
      return { latex: final, steps };
    });
  } catch {
    return null;
  }
}

/** `4(10) - 1` stays; `2 \cdot 3^{(6) - 1}` → `2 \cdot 3^{6 - 1}`: a bracket round a lone number in an exponent goes. */
function tidyProduct(s: string): string {
  return s.replace(/\^\{\s*\((\d+)\)/g, "^{$1").replace(/\^\s*\((\d+)\)/g, "^{$1}");
}

// ---------------------------------------------------------------- sigma notation

const SIGMA = /^\\sum\s*_\s*\{\s*([a-zA-Z])\s*=\s*(-?\d+)\s*\}\s*\^\s*\{?\s*(\\infty|\d+)\s*\}?\s*([\s\S]+)$/;

/**
 * `\sum_{n=1}^{10}(2n + 1)` (arithmetic), `\sum_{k=1}^{5} 3 \cdot 2^{k - 1}` (geometric),
 * `\sum_{n=1}^{\infty} 3\left(\frac{1}{2}\right)^{n - 1}` (geometric, |r| < 1): the first term,
 * the last (or the ratio), the formula, the value. Null for any other summand.
 */
export function sigmaSteps(deps: CourseDeps, latex: string): string[] | null {
  try {
    return exactly(() => {
      const m = SIGMA.exec(latex.trim().replace(/=\s*$/, "").trim());
      if (!m) return null;
      const [, v, loRaw, hiRaw, bodyRaw] = m;
      const body = bodyRaw.trim().replace(/^\\left\(|\\right\)$/g, "");
      const lo = Number(loRaw);
      const infinite = hiRaw === "\\infty";
      const hi = infinite ? null : Number(hiRaw);
      if (hi !== null && (hi < lo || hi - lo > 200)) return null;
      const at = (k: number): Q | null => {
        const val = evalLatex(deps, body, { [v]: k });
        if (!val || Math.abs(val.im) > 1e-12) return null;
        return qFromNumber(val.re);
      };
      const terms: Q[] = [];
      for (let k = lo; k < lo + 5; k++) {
        const t = at(k);
        if (!t) return null;
        terms.push(t);
      }
      const s = fromList(terms, v);
      if (!s) return null;
      const n = hi === null ? null : hi - lo + 1;
      let lines: string[] | null;
      if (n === null) {
        if (s.kind !== "geometric" || Math.abs(s.step.n / s.step.d) >= 1) return null;
        const bottom = qAdd(q(1), qNeg(s.step));
        const total = qDiv(s.a1, bottom);
        lines = [`\\frac{${qTex(s.a1)}}{1 - ${qSigned(s.step)}}`, `\\frac{${qTex(s.a1)}}{${qTex(bottom)}}`, qTex(total)];
        if (!checkSum(s, null, total)) return null;
      } else if (s.kind === "arithmetic") {
        const last = at(hi!);
        if (!last || !eq(last, termValue(s, n))) return null;
        const total = qMul(q(n, 2), qAdd(s.a1, last));
        lines = [`\\frac{${n}}{2}(${qTex(s.a1)} + ${qSigned(last)})`, `${qTex(q(n, 2))} \\cdot ${qSigned(qAdd(s.a1, last))}`, qTex(total)];
        if (!checkSum(s, n, total)) return null;
      } else {
        if (eq(s.step, q(1))) return null;
        const rk = qPow(s.step, n);
        const top = qAdd(q(1), qNeg(rk));
        const bottom = qAdd(q(1), qNeg(s.step));
        const total = qDiv(qMul(s.a1, top), bottom);
        lines = [`\\frac{${qTex(s.a1)}(1 - ${qParen(s.step)}^{${n}})}{1 - ${qSigned(s.step)}}`, `\\frac{${qTex(s.a1)}${qParen(top)}}{${qTex(bottom)}}`, qTex(total)];
        if (!checkSum(s, n, total)) return null;
      }
      return dedupe(deps, lines);
    });
  } catch {
    return null;
  }
}
