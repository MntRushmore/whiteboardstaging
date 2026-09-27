/**
 * Reading a two-column proof off the board. Pure: lines (LaTeX + ink bounds) in, proofs out.
 *
 *   Given: \overline{AB} \cong \overline{CD}, \ \overline{AB} \parallel \overline{CD}
 *   Prove: \triangle ABD \cong \triangle CDB
 *   (Statements | Reasons)                    ← optional header
 *   \overline{AB} \cong \overline{CD}    Given
 *   \angle ABD \cong \angle CDB          Alt. int. ∠s
 *   …
 *
 * `clusterLines` makes one line per written row-half: a statement on the left, a reason on the
 * right (a drawn T-table's rules never reach it — `tableRules`). Here each reason is paired with the
 * statement level with it (vertical overlap), rows are ordered top to bottom, and the Given / Prove
 * lines above them (and a Given continued on the next line) are attached. A statement and its
 * reason the clusterer ran into ONE line (written close together) are split again at the reason.
 * The tutor's own rows (written by hand, not read) come in as `tutor` lines at their places.
 */
import type { Rect } from "../contracts";
import { looksLikeGeometry, statementOf, tokenize, type Statement, type Tok } from "./facts";
import type { ProofProblem } from "./checker";
import { normalizeReason, resolveBisector, type ReasonId } from "./vocab";

export interface BoardLine {
  id: string;
  latex: string;
  bounds: Rect;
  /** a row the tutor wrote (its LaTeX known, not read): part of the proof, never marked */
  tutor?: boolean;
}

export type LineRole =
  | { role: "given"; statement: Statement }
  | { role: "prove"; statement: Statement }
  | { role: "header" }
  | { role: "reason"; reason: ReasonId | "bisector" }
  | { role: "row"; statement: Statement; reason: ReasonId | "bisector" }
  | { role: "statement"; statement: Statement }
  | { role: "other" };

export interface ReadRow {
  statement: BoardLine | null;
  reason: BoardLine | null;
  /** a statement and its reason read as one line */
  merged: BoardLine | null;
}

export interface ProofRead {
  given: BoardLine[];
  prove: BoardLine[];
  header: BoardLine[];
  rows: ReadRow[];
  /** every line that is part of this proof */
  lineIds: string[];
  bounds: Rect;
  /** where the columns start, the height of a line and the distance between rows (for the next row) */
  statementX: number;
  reasonX: number;
  lineHeight: number;
  rowPitch: number;
  /** the bottom of the last row (or of the Prove / Given line when there is none yet) */
  bottom: number;
}

const HEADER_WORDS = /\b(statements?|reasons?|justifications?)\b/;

function words(toks: readonly Tok[]): string[] {
  return toks.filter((t): t is Extract<Tok, { k: "word" }> => t.k === "word").map((t) => t.w);
}

/** The tail tokens as plain text for `normalizeReason`. */
function tokText(toks: readonly Tok[]): string {
  return toks
    .map((t) => {
      switch (t.k) {
        case "word":
          return t.w;
        case "caps":
          return t.s;
        case "lower":
          return t.s;
        case "op":
          return t.op === "cong" ? "congruent" : t.op === "perp" ? "perpendicular" : t.op === "par" ? "parallel" : t.op === "eq" ? "=" : "";
        default:
          return "";
      }
    })
    .join(" ");
}

/** What a line is to a proof. */
export function classifyLine(latex: string): LineRole {
  const toks = tokenize(latex);
  if (toks.length === 0) return { role: "other" };
  const first = toks[0];
  // `Given: …` / `Prove: …` (a lone `Given` is a reason)
  if (first.k === "word" && (first.w === "given" || first.w === "prove" || first.w === "show")) {
    let rest = toks.slice(1);
    if (rest[0]?.k === "word" && rest[0].w === "that") rest = rest.slice(1);
    if (rest[0]?.k === "colon") rest = rest.slice(1);
    if (rest.length > 0) {
      const statement = statementOf(rest);
      if (statement.facts.length > 0 || looksLikeGeometry(latex)) return { role: first.w === "given" ? "given" : "prove", statement };
    }
  }
  const ws = words(toks).join(" ");
  if (HEADER_WORDS.test(ws) && !looksLikeGeometry(latex) && toks.every((t) => t.k === "word" || t.k === "sep" || t.k === "colon" || t.k === "bad")) return { role: "header" };
  const reason = normalizeReason(latex);
  if (reason) return { role: "reason", reason };
  const statement = statementOf(toks);
  if (statement.complete) return { role: "statement", statement };
  // a statement and its reason on one line: the reason is the tail
  for (let tail = 1; tail <= Math.min(8, toks.length - 1); tail++) {
    const head = toks.slice(0, toks.length - tail);
    const r = normalizeReason(tokText(toks.slice(-tail)));
    if (!r) continue;
    const st = statementOf(head);
    if (st.complete) return { role: "row", statement: st, reason: r };
  }
  if (statement.facts.length > 0 || looksLikeGeometry(latex)) return { role: "statement", statement };
  return { role: "other" };
}

const bottomOf = (r: Rect) => r.y + r.h;
const rightOf = (r: Rect) => r.x + r.w;
const centerY = (r: Rect) => r.y + r.h / 2;

function overlapY(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(bottomOf(a), bottomOf(b)) - Math.max(a.y, b.y));
}

function union(rects: readonly Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map(rightOf));
  const y1 = Math.max(...rects.map(bottomOf));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const rowRect = (row: ReadRow): Rect => union([row.statement, row.reason, row.merged].filter((l): l is BoardLine => l !== null).map((l) => l.bounds));

/** Finds the proofs among a screen's lines. */
export function readProofs(lines: readonly BoardLine[]): ProofRead[] {
  const roles = new Map<string, LineRole>(lines.map((l) => [l.id, classifyLine(l.latex)]));
  const byRole = (role: LineRole["role"]) => lines.filter((l) => roles.get(l.id)?.role === role);
  const reasons = byRole("reason");
  const statements = byRole("statement");
  const merged = byRole("row");

  // 1. each reason with the statement level with it, on its left (best overlap first)
  const cands: Array<{ s: BoardLine; r: BoardLine; score: number; gap: number }> = [];
  for (const r of reasons)
    for (const s of statements) {
      if (rightOf(s.bounds) > r.bounds.x + 0.6 * r.bounds.h) continue;
      const ov = overlapY(s.bounds, r.bounds) / Math.max(1, Math.min(s.bounds.h, r.bounds.h));
      const close = Math.abs(centerY(s.bounds) - centerY(r.bounds)) < 0.6 * Math.max(s.bounds.h, r.bounds.h);
      if (ov < 0.3 && !close) continue;
      cands.push({ s, r, score: ov, gap: r.bounds.x - rightOf(s.bounds) });
    }
  cands.sort((a, b) => b.score - a.score || a.gap - b.gap);
  const usedS = new Set<string>();
  const usedR = new Set<string>();
  const rows: ReadRow[] = [];
  for (const c of cands) {
    if (usedS.has(c.s.id) || usedR.has(c.r.id)) continue;
    usedS.add(c.s.id);
    usedR.add(c.r.id);
    rows.push({ statement: c.s, reason: c.r, merged: null });
  }
  for (const m of merged) rows.push({ statement: null, reason: null, merged: m });
  for (const r of reasons) if (!usedR.has(r.id)) rows.push({ statement: null, reason: r, merged: null });
  rows.sort((a, b) => centerY(rowRect(a)) - centerY(rowRect(b)));

  // 2. rows close enough one under the other are one proof
  const lh = median(lines.map((l) => l.bounds.h).filter((h) => h > 0)) || 40;
  const groups: ReadRow[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && rowRect(row).y - bottomOf(rowRect(prev)) <= Math.max(4 * lh, 160)) last.push(row);
    else groups.push([row]);
  }

  const taken = new Set<string>(rows.flatMap((r) => [r.statement, r.reason, r.merged]).filter((l): l is BoardLine => l !== null).map((l) => l.id));
  const givens = byRole("given");
  const proves = byRole("prove");
  const headers = byRole("header");
  const proofs: ProofRead[] = [];

  const build = (paired: ReadRow[], anchorTop: number, anchorBox: Rect | null): ProofRead | null => {
    let groupRows = paired;
    const box = groupRows.length > 0 ? union(groupRows.map(rowRect)) : anchorBox;
    if (!box) return null;
    if (groupRows.length > 0) {
      // a statement written in the statement column, its reason not yet: a row still being written
      const stmtX = Math.min(...groupRows.map((r) => (r.statement ?? r.merged)?.bounds.x ?? Infinity));
      const rx = Math.min(...groupRows.map((r) => r.reason?.bounds.x ?? Infinity));
      const pitch = Math.max(2 * lh, 80);
      const pending = statements.filter((s) => {
        if (taken.has(s.id) || usedS.has(s.id)) return false;
        const cy = centerY(s.bounds);
        const inColumn = Math.abs(s.bounds.x - stmtX) < 4 * lh && (!Number.isFinite(rx) || s.bounds.x < rx - lh);
        return inColumn && cy > box.y && cy < bottomOf(box) + 2.5 * pitch;
      });
      if (pending.length > 0) {
        groupRows = [...groupRows, ...pending.map((s) => ({ statement: s, reason: null, merged: null }))].sort((a, b) => centerY(rowRect(a)) - centerY(rowRect(b)));
        for (const s of pending) taken.add(s.id);
      }
    }
    const reach = Math.max(10 * lh, 400);
    const above = (l: BoardLine) => !taken.has(l.id) && bottomOf(l.bounds) <= anchorTop + 0.5 * l.bounds.h && anchorTop - bottomOf(l.bounds) <= reach && l.bounds.x < rightOf(box) + 2 * lh && rightOf(l.bounds) > box.x - 4 * lh;
    const pick = (list: BoardLine[]) => list.filter(above).sort((a, b) => bottomOf(b.bounds) - bottomOf(a.bounds))[0];
    const prove = pick(proves);
    const given = pick(givens.filter((g) => !prove || g.bounds.y <= prove.bounds.y));
    const top = Math.min(...[given, prove].filter((l): l is BoardLine => Boolean(l)).map((l) => l.bounds.y), anchorTop);
    const header = headers.filter((h) => !taken.has(h.id) && h.bounds.y >= top - 1 && bottomOf(h.bounds) <= anchorTop + 0.5 * h.bounds.h);
    // a Given continued on the next line(s): statements between it and the Prove line / the first row
    const givenLines = given ? [given] : [];
    if (given) {
      const until = prove ? prove.bounds.y : anchorTop;
      for (const s of statements) {
        if (taken.has(s.id) || usedS.has(s.id)) continue;
        if (s.bounds.y >= bottomOf(given.bounds) - 0.3 * s.bounds.h && bottomOf(s.bounds) <= until + 0.3 * s.bounds.h && Math.abs(s.bounds.x - given.bounds.x) < Math.max(6 * lh, given.bounds.w)) givenLines.push(s);
      }
    }
    if (groupRows.length === 0 && !given && !prove) return null;
    const withReason = groupRows.filter((r) => r.reason || r.merged).length;
    if (!given && !prove && header.length === 0 && withReason < 2) return null;

    const stmtLines = groupRows.map((r) => r.statement ?? r.merged).filter((l): l is BoardLine => l !== null);
    const reasonLines = groupRows.map((r) => r.reason).filter((l): l is BoardLine => l !== null);
    const lead = [...stmtLines, ...(prove ? [prove] : []), ...givenLines];
    const statementX = stmtLines.length > 0 ? Math.min(...stmtLines.map((l) => l.bounds.x)) : (prove ?? given)!.bounds.x;
    const heights = [...stmtLines, ...reasonLines].map((l) => l.bounds.h);
    // no rows yet: the Prove line is one line of writing; a Given can be two read as one (a second
    // given indented under the first), and would double every size below
    const lineHeight = median(heights.length > 0 ? heights : prove ? [prove.bounds.h] : lead.map((l) => l.bounds.h)) || lh;
    const widest = Math.max(0, ...stmtLines.map((l) => rightOf(l.bounds) - statementX));
    const reasonHeader = header.find((h) => /reason/i.test(h.latex));
    const reasonX =
      reasonLines.length > 0
        ? Math.min(...reasonLines.map((l) => l.bounds.x))
        : reasonHeader && reasonHeader.bounds.x > statementX + lineHeight
          ? reasonHeader.bounds.x
          : // no reason column yet: past the widest statement (the rows written widen it further,
            // `proofRowsPlan`), not so far right that it lands on a figure drawn beside the proof
            statementX + Math.max(widest + 2.5 * lineHeight, 7 * lineHeight);
    const centers = groupRows.map((r) => centerY(rowRect(r)));
    const gaps = centers.slice(1).map((c, i) => c - centers[i]);
    const rowPitch = gaps.length > 0 ? median(gaps) : 1.8 * lineHeight;
    const members = [...givenLines, ...(prove ? [prove] : []), ...header, ...groupRows.flatMap((r) => [r.statement, r.reason, r.merged]).filter((l): l is BoardLine => l !== null)];
    for (const l of members) taken.add(l.id);
    const bottom = groupRows.length > 0 ? bottomOf(rowRect(groupRows[groupRows.length - 1])) : Math.max(...[...givenLines, ...(prove ? [prove] : []), ...header].map((l) => bottomOf(l.bounds)));
    return {
      given: givenLines,
      prove: prove ? [prove] : [],
      header,
      rows: groupRows,
      lineIds: members.filter((l) => !l.tutor).map((l) => l.id),
      bounds: union(members.map((l) => l.bounds)),
      statementX,
      reasonX,
      lineHeight,
      rowPitch: Math.max(rowPitch, 1.2 * lineHeight),
      bottom,
    };
  };

  for (const g of groups) {
    const box = union(g.map(rowRect));
    const proof = build(g, box.y, box);
    if (proof) proofs.push(proof);
  }
  // Given / Prove written, no row yet: a proof the tutor can start
  for (const p of proves) {
    if (taken.has(p.id)) continue;
    const proof = build([], bottomOf(p.bounds) + 1, p.bounds);
    if (proof) proofs.push(proof);
  }
  for (const g of givens) {
    if (taken.has(g.id)) continue;
    const proof = build([], bottomOf(g.bounds) + 1, g.bounds);
    if (proof) proofs.push(proof);
  }
  return proofs;
}

/** The proof as the checker and planner take it: the Given / Prove facts and each row's statement and reason. */
export function proofProblem(read: ProofRead): ProofProblem {
  let givens: Statement | null = null;
  for (const l of read.given) {
    const role = classifyLine(l.latex);
    const st = role.role === "given" ? role.statement : role.role === "statement" ? role.statement : null;
    if (!st) continue;
    givens = givens ? { facts: [...givens.facts, ...st.facts], complete: givens.complete && st.complete } : st;
  }
  const proveRole = read.prove[0] ? classifyLine(read.prove[0].latex) : null;
  const prove = proveRole?.role === "prove" ? proveRole.statement : null;
  const rows = read.rows.map((row) => {
    if (row.merged) {
      const role = classifyLine(row.merged.latex);
      if (role.role === "row") return { statement: role.statement, reason: resolveBisector(role.reason, role.statement.facts.some((f) => f.t === "angCong")) };
      return { statement: null, reason: null };
    }
    const sRole = row.statement ? classifyLine(row.statement.latex) : null;
    const statement = sRole && (sRole.role === "statement" || sRole.role === "given" || sRole.role === "prove") ? sRole.statement : row.statement ? { facts: [], complete: false } : null;
    const rRole = row.reason ? classifyLine(row.reason.latex) : null;
    const reason = rRole?.role === "reason" ? resolveBisector(rRole.reason, statement?.facts.some((f) => f.t === "angCong") ?? false) : null;
    return { statement, reason };
  });
  return { givens, prove, rows };
}
