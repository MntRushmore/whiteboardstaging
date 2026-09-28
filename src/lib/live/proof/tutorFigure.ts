/**
 * A proof the TUTOR wrote (the board chat's `write_proof`), as its strokes carry it so the proof desk
 * knows it again — after a reload too — without reading any of its ink:
 *
 *  - every stroke of its figure carries `meta.proofFigure`: the figure as the proof desk reads one
 *    (`FigureRead`: its points, y down, and the lines through them), exact, from the spec it was
 *    drawn from — a few bytes (`A:0,50;B:50,0|AB,BDC|1:ABD`);
 *  - every stroke of its table's rules carries `meta.proofTable`: the tutor's next rows are written
 *    across them (`LiveLoop.writeProofRows` keeps clear of everything else);
 *  - its writing (`Given:`, `Prove:`, the header and the rows) carries `meta.proofRows`
 *    (`PROOF_ROWS_META`), read back as the tutor's lines of the proof (`tutorLinesOf`).
 *
 * Pure.
 */
import type { Rect } from "../contracts";
import type { FigureRead } from "./figure";

export const PROOF_FIGURE_META = "proofFigure";
export const PROOF_TABLE_META = "proofTable";

const round = (v: number): number => Math.round(v * 1000) / 1000;

export function encodeFigureRead(read: FigureRead): string {
  const pts = Object.entries(read.points)
    .map(([n, [x, y]]) => `${n}:${round(x)},${round(y)}`)
    .join(";");
  const angles = Object.entries(read.angles ?? {})
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return `${pts}|${read.lines.join(",")}${angles ? `|${angles}` : ""}`;
}

/** The figure read back from its meta, or null when the string is not one. */
export function decodeFigureRead(s: unknown): FigureRead | null {
  if (typeof s !== "string" || !s) return null;
  const [pts, lines, angles] = s.split("|");
  const points: Record<string, readonly [number, number]> = {};
  for (const part of (pts ?? "").split(";")) {
    const m = /^([A-Z]):(-?[\d.e+-]+),(-?[\d.e+-]+)$/.exec(part);
    if (!m) continue;
    const x = Number(m[2]);
    const y = Number(m[3]);
    if (Number.isFinite(x) && Number.isFinite(y)) points[m[1]] = [x, y];
  }
  const ls = (lines ?? "").split(",").filter((l) => /^[A-Z]{2,12}$/.test(l));
  const ang: Record<string, string> = {};
  for (const part of (angles ?? "").split(";")) {
    const m = /^(\d{1,2}):([A-Z]{3})$/.exec(part);
    if (m) ang[m[1]] = m[2];
  }
  if (Object.keys(points).length < 2 || ls.length === 0) return null;
  return { points, lines: ls, ...(Object.keys(ang).length ? { angles: ang } : {}) };
}

/**
 * The tutor's proof figures on a screen, from its strokes: grouped by the block they were drawn as,
 * each with where its ink is. A figure partly rubbed out still reads; one rubbed out entirely is gone.
 */
export function tutorFiguresOf(shapes: ReadonlyArray<{ block: string; meta: unknown; bounds: Rect }>): Array<{ key: string; read: FigureRead; bounds: Rect }> {
  const byBlock = new Map<string, { key: string; read: FigureRead; bounds: Rect }>();
  for (const s of shapes) {
    const raw = s.meta && typeof s.meta === "object" ? (s.meta as Record<string, unknown>)[PROOF_FIGURE_META] : undefined;
    if (typeof raw !== "string") continue;
    const key = `${s.block}|${raw}`;
    const cur = byBlock.get(key);
    if (cur) {
      const x0 = Math.min(cur.bounds.x, s.bounds.x);
      const y0 = Math.min(cur.bounds.y, s.bounds.y);
      const x1 = Math.max(cur.bounds.x + cur.bounds.w, s.bounds.x + s.bounds.w);
      const y1 = Math.max(cur.bounds.y + cur.bounds.h, s.bounds.y + s.bounds.h);
      cur.bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      continue;
    }
    const read = decodeFigureRead(raw);
    if (read) byBlock.set(key, { key, read, bounds: { ...s.bounds } });
  }
  return [...byBlock.values()];
}
