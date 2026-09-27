/**
 * Function notation for the JUDGE, written independently of the engine's `functionNotation.ts`
 * (the scoreboard must not grade the engine with the engine's own reading): a problem's
 * definitions (`f(x) = 2x + 3`, `P(x) = …`, a piecewise `\begin{cases}`) and a rewriter that
 * replaces every call in a line (`f(4)`, `f(g(x))`, `(f \circ g)(x)`) by the definition with the
 * argument put in, bracketed — so `f(4) =` is read as the value it asks for, not as `4f`.
 * `f^{-1}(x)` is left as it is (an inverse is judged by its answer).
 */
import { exprOf, parseLine, truthAt } from "./oracle";

export interface Definition {
  name: string;
  param: string;
  body: string;
  pieces?: Array<{ body: string; cond: string }>;
}

const DEF = /^\s*([a-zA-Z])\s*(?:\\left\s*)?\(\s*([a-zA-Z])\s*(?:\\right\s*)?\)\s*=\s*([\s\S]+)$/;

export function definitionsOf(lines: readonly string[]): Map<string, Definition> {
  const out = new Map<string, Definition>();
  for (const l of lines) {
    const m = DEF.exec(l);
    if (!m || m[1] === m[2]) continue;
    const body = m[3].trim();
    const cases = /\\begin\s*\{\s*(?:cases|array)\s*\}(?:\s*\{[lcr]+\})?([\s\S]*?)\\end/.exec(body);
    if (cases) {
      const pieces = cases[1]
        .split(/\\\\/)
        .map((r) => r.split("&").map((c) => c.trim()))
        .filter((c) => c.length === 2 && c[0] && c[1])
        .map(([b, c]) => ({ body: b, cond: c }));
      if (pieces.length >= 2) out.set(m[1], { name: m[1], param: m[2], body, pieces });
      continue;
    }
    // a definition uses its parameter; `f(x) = 7` under another f is an equation to solve
    const plain = body.replace(/\\[a-zA-Z]+/g, " ");
    if (!new RegExp(`(^|[^a-zA-Z])${m[2]}([^a-zA-Z]|$)`).test(plain) || out.has(m[1])) continue;
    out.set(m[1], { name: m[1], param: m[2], body });
  }
  return out;
}

/** Index just past the `)` that closes the `(` at `open` (a `\left(` / `\right)` pair counts). */
function close(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** The parameter replaced everywhere it stands alone (not inside a command, not a subscript). */
function put(body: string, param: string, arg: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(body.slice(i));
      const cmd = m ? m[0] : "\\";
      out += cmd;
      i += cmd.length - 1;
      continue;
    }
    if (ch === param && body[i - 1] !== "_") out += `\\left(${arg}\\right)`;
    else out += ch;
  }
  return out;
}

function valueOf(latex: string): number | null {
  const e = exprOf(latex);
  if (!e || e.vars.length > 0) return null;
  const v = e.at({});
  return typeof v === "number" ? v : null;
}

/**
 * A line with every call of a defined function replaced by its value's expression; the line
 * itself when it has none. A piecewise call is replaced by the piece whose condition holds at
 * the (numeric) argument; null when none does or the argument is not a number.
 */
export function expandCalls(latex: string, defs: ReadonlyMap<string, Definition>): string | null {
  if (defs.size === 0) return latex;
  let s = latex.replace(/\\left\s*\(/g, "(").replace(/\\right\s*\)/g, ")");
  // (f \circ g)(x) → f(g(x)), (f + g)(x) → (f(x) + g(x))
  s = s.replace(/\(\s*([a-zA-Z])\s*\\circ\s*([a-zA-Z])\s*\)\s*\(([^()]*)\)/g, (_m, f: string, g: string, a: string) => `${f}(${g}(${a}))`);
  s = s.replace(/\(\s*([a-zA-Z])\s*([+-])\s*([a-zA-Z])\s*\)\s*\(([^()]*)\)/g, (m, f: string, op: string, g: string, a: string) => (defs.has(f) && defs.has(g) ? `(${f}(${a}) ${op} ${g}(${a}))` : m));
  for (let guard = 0; guard < 12; guard++) {
    let found = false;
    const re = /([a-zA-Z])\s*\(/g;
    let m: RegExpExecArray | null;
    let next = s;
    while ((m = re.exec(s))) {
      const before = s.slice(0, m.index);
      if (/[a-zA-Z\\_^]$/.test(before) || !defs.has(m[1])) continue;
      const open = m.index + m[0].length - 1;
      const end = close(s, open);
      if (end < 0) return null;
      const arg = s.slice(open + 1, end - 1);
      if (/[a-zA-Z]\s*\(/.test(arg) && [...arg.matchAll(/([a-zA-Z])\s*\(/g)].some((x) => defs.has(x[1]))) continue; // innermost first
      const def = defs.get(m[1])!;
      let body = def.body;
      if (def.pieces) {
        const v = valueOf(arg);
        if (v === null) return null;
        const piece = def.pieces.find((p) => {
          const rel = parseLine(p.cond);
          return rel.kind === "relation" && truthAt(rel, { [def.param]: v }) === true;
        });
        if (!piece) return null;
        body = piece.body;
      }
      next = `${s.slice(0, m.index)}\\left(${put(body, def.param, arg)}\\right)${s.slice(end)}`;
      found = true;
      break;
    }
    if (!found) return s;
    s = next;
  }
  return null;
}
