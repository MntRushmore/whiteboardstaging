/**
 * The tutor's sums, checked before anything is painted: every "a op b … = c" made only of numbers
 * in its instructions is worked out here. The fast tutor wrote a column sum of 1,385 + 2,749 wrong on
 * the owner's board (2026-10-26), and a wrong number in the tutor's ink teaches the wrong thing.
 * Equations with letters (2x = 8) are left alone: those are the engine's job, not this check's.
 */

/** Numbers, operators and brackets, then "=", then a number: one candidate equation. */
const EQUATION = /((?:[-−]?\(?\s*[-−]?\d[\d,]*(?:\.\d+)?\s*\)?\s*[-−+×x*÷/]\s*)+\(?\s*[-−]?\d[\d,]*(?:\.\d+)?\s*\)?)\s*=\s*([-−]?\d[\d,]*(?:\.\d+)?)(?![\d.]*\s*[a-zA-Z(])/g;

type Tok = { n: number } | { op: string };

function tokens(expr: string): Tok[] | null {
  const s = expr.replace(/−/g, "-").replace(/[×x*]/g, "*").replace(/÷/g, "/").replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  const out: Tok[] = [];
  const re = /\s*(\d+(?:\.\d+)?|[-+*/()])/y;
  let m: RegExpExecArray | null;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    m = re.exec(s);
    if (!m) return s.slice(i).trim() === "" ? out : null;
    out.push(/\d/.test(m[1]) ? { n: Number(m[1]) } : { op: m[1] });
    i = re.lastIndex;
  }
  return out;
}

/** + − × ÷ with brackets and unary minus, or null when it doesn't parse. */
export function evaluate(expr: string): number | null {
  const t = tokens(expr);
  if (!t || t.length === 0) return null;
  let i = 0;
  const peek = () => t[i];
  const isOp = (k: Tok | undefined, op: string) => !!k && "op" in k && k.op === op;
  const primary = (): number | null => {
    const k = peek();
    if (!k) return null;
    if ("n" in k) {
      i++;
      return k.n;
    }
    if (k.op === "-") {
      i++;
      const v = primary();
      return v === null ? null : -v;
    }
    if (k.op === "(") {
      i++;
      const v = sum();
      if (!isOp(peek(), ")")) return null;
      i++;
      return v;
    }
    return null;
  };
  const product = (): number | null => {
    let v = primary();
    while (v !== null && (isOp(peek(), "*") || isOp(peek(), "/"))) {
      const op = (t[i++] as { op: string }).op;
      const r = primary();
      if (r === null) return null;
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = product();
    while (v !== null && (isOp(peek(), "+") || isOp(peek(), "-"))) {
      const op = (t[i++] as { op: string }).op;
      const r = product();
      if (r === null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  return v !== null && i === t.length && Number.isFinite(v) ? v : null;
}

/** The number-only equations in `text` that are false, as written ("68 + 57 = 120"). */
export function falseEquations(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(EQUATION)) {
    const left = evaluate(m[1]);
    const rightText = m[2].replace(/−/g, "-").replace(/,/g, "");
    const right = Number(rightText);
    if (left === null || !Number.isFinite(right)) continue;
    // a rounded answer is right to the places it shows (10 ÷ 3 = 3.33)
    const places = rightText.includes(".") ? rightText.split(".")[1].length : 0;
    const tolerance = places > 0 ? 0.5 * 10 ** -places + 1e-9 : 1e-9 * Math.max(1, Math.abs(right));
    if (Math.abs(left - right) > tolerance) out.push(`${m[1].trim()} = ${m[2]}`);
  }
  return out;
}

/** What the tutor is told when its sums were wrong. */
export function recheckNote(wrong: string[]): string {
  return `Your instructions contain arithmetic that is wrong: ${wrong.join("; ")}. Work every number out again carefully, digit by digit with carrying, and answer again in the same JSON form.`;
}

/** A worked-out value as the tutor writes it: a whole number plainly, else at most 4 decimal places. */
export function numberText(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 10_000) / 10_000);
}
