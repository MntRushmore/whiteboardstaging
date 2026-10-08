/**
 * Following a board live: the viewer holds the records it last read, the poll brings the board's
 * newer ones, and only what changed is applied (put / remove, in an order the store accepts:
 * the document and pages before the shapes on them, parents before children, bindings last;
 * shapes removed before the pages they were on).
 */
import type { TLRecord } from "tldraw";
import { deepEqual } from "@/lib/sync/deepEqual";

/** What the replay's store holds of a board: everything but the session (camera, instance…). */
export const DOCUMENT_TYPE_NAMES: ReadonlySet<string> = new Set(["document", "page", "shape", "asset", "binding"]);

const ORDER: Record<string, number> = { document: 0, page: 1, asset: 2, shape: 3, binding: 4 };

export interface RecordsDiff {
  put: TLRecord[];
  remove: TLRecord["id"][];
}

/** How deep a shape sits (0 on a page), so parents are put first. */
function depthOf(rec: TLRecord, byId: ReadonlyMap<string, TLRecord>): number {
  let depth = 0;
  let parent = (rec as { parentId?: string }).parentId;
  while (parent && depth < 64) {
    const up = byId.get(parent);
    if (!up || up.typeName !== "shape") break;
    depth++;
    parent = (up as { parentId?: string }).parentId;
  }
  return depth;
}

/** From the records shown (`prev`, by id) to `next`: what to put and what to remove. */
export function diffRecords(prev: ReadonlyMap<string, TLRecord>, next: readonly TLRecord[]): RecordsDiff {
  const nextById = new Map<string, TLRecord>();
  for (const r of next) if (DOCUMENT_TYPE_NAMES.has(r.typeName)) nextById.set(r.id, r);
  const put: TLRecord[] = [];
  for (const r of nextById.values()) {
    const old = prev.get(r.id);
    if (!old || (old !== r && !deepEqual(old, r))) put.push(r);
  }
  const removed: TLRecord[] = [];
  for (const [id, r] of prev) if (!nextById.has(id) && DOCUMENT_TYPE_NAMES.has(r.typeName)) removed.push(r);
  put.sort((a, b) => (ORDER[a.typeName] ?? 9) - (ORDER[b.typeName] ?? 9) || (a.typeName === "shape" && b.typeName === "shape" ? depthOf(a, nextById) - depthOf(b, nextById) : 0));
  removed.sort((a, b) => (ORDER[b.typeName] ?? 9) - (ORDER[a.typeName] ?? 9));
  return { put, remove: removed.map((r) => r.id) };
}
