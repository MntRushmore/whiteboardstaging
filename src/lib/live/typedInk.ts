import type { TLShapeId } from "tldraw";
import { TYPED_COUNT_META, TYPED_ID_META, TYPED_LATEX_META, TYPED_TEXT_META } from "@/lib/typeMath/contracts";

/**
 * Ink written as one line in one go, not stroke by stroke with the pen: a line the kid typed (Type
 * it, docs/TYPE-MATH.md), and later a line sent from a phone used as a pen. Its strokes share a
 * `typedId`, and the first of them (the lead) says how many there are. Everything is on the strokes'
 * meta, so a reload, Undo, another tab or a sync gives the same groups with nothing kept in memory.
 */
export interface LineGroup {
  /** the strokes' `typedId` */
  id: string;
  strokeIds: TLShapeId[];
  /** what the line says, when it was typed: read as this, with no recognizer */
  latex?: string;
  /** what the kid typed, given back to the box when they edit the line */
  text?: string;
}

/**
 * The whole line groups among these strokes: each is one line of its own, whatever the clusterer
 * would make of it. Whole means its lead is there and it has exactly the strokes the lead counts: a
 * stroke rubbed out (or a copy pasted beside it, which brings a second lead) and its ink is read like
 * any other ink.
 */
export function lineGroupsOf(shapes: Iterable<{ id: TLShapeId; meta: unknown }>): LineGroup[] {
  const groups = new Map<string, { ids: TLShapeId[]; count: number; leads: number; latex?: string; text?: string }>();
  for (const s of shapes) {
    const meta = s.meta as Record<string, unknown> | null;
    const id = meta?.[TYPED_ID_META];
    if (typeof id !== "string" || !id) continue;
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { ids: [], count: 0, leads: 0 }));
    g.ids.push(s.id);
    const count = meta[TYPED_COUNT_META];
    if (typeof count !== "number") continue;
    g.count = count;
    g.leads++;
    const latex = meta[TYPED_LATEX_META];
    const text = meta[TYPED_TEXT_META];
    if (typeof latex === "string" && latex.trim()) g.latex = latex;
    if (typeof text === "string") g.text = text;
  }
  const out: LineGroup[] = [];
  for (const [id, g] of groups) {
    if (g.leads !== 1 || g.count !== g.ids.length) continue;
    out.push({ id, strokeIds: g.ids, ...(g.latex !== undefined ? { latex: g.latex } : {}), ...(g.text !== undefined ? { text: g.text } : {}) });
  }
  return out;
}
