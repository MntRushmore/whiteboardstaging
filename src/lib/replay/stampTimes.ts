import type { Editor, TLShape } from "tldraw";
import { STROKE_TIME } from "./strokeTime";

/**
 * Times on the board's shapes, for the replay (src/lib/replay/timeline.ts): every shape the student
 * makes gets `meta.t` (pen down, ms since the epoch) as it is created, and a draw (or highlight)
 * stroke gets `meta.t1` (pen up) when it completes.
 *
 * Both are tldraw "before" side effects, so the stamp is part of the very change that creates or
 * completes the shape: no extra store change, no extra undo entry, no extra save (the autosave's
 * dirty tracker sees the one change it always saw).
 *
 * Only changes from this tab's user (`source === "user"`): the student's pen, paste, duplicate,
 * undo and redo. Never a `"remote"` change: the tutor's writing (LiveLoop writes through
 * `mergeRemoteChanges`, and its shapes carry `meta.createdAt` already), another tab's records merged
 * in by the save queue, a device backup restored (those are old strokes: stamping them "now" would
 * be wrong, and would make this tab's copy differ from the row it just merged, so save again). A
 * snapshot load runs with side effects off, so a board's old strokes stay unstamped.
 *
 * Never `meta.live`: LiveLoop tells the student's ink from the tutor's by its absence.
 *
 * A shape that comes back (undo of a delete or of an erase, redo of a stroke, a deleted screen
 * restored: an id this editor saw deleted) comes back exactly as it was, stamped or not: its time is
 * when it was first drawn. A copy (duplicate, paste, alt-drag) is a new id carrying the original's
 * stamps: it gets its own pen-down time, and loses the original's pen-up.
 */

type Meta = Record<string, unknown>;

const STROKE_TYPES = new Set(["draw", "highlight"]);

/**
 * The shape as it should be created: `meta.t` = now for a new shape; a copy of a stamped one gets
 * its own `t` (and no `t1`: it was not drawn); a shape `restoring` (an undo, a redo) is left as it was.
 */
export function stampCreated<S extends TLShape>(shape: S, now: number, restoring = false): S {
  if (restoring) return shape;
  const meta = shape.meta as Meta;
  if (meta[STROKE_TIME.start] === undefined && meta[STROKE_TIME.end] === undefined) return { ...shape, meta: { ...meta, [STROKE_TIME.start]: now } };
  const rest: Meta = { ...meta };
  delete rest[STROKE_TIME.end];
  return { ...shape, meta: { ...rest, [STROKE_TIME.start]: now } };
}

/**
 * The stroke with `meta.t1` = now when this change completes it (isComplete false -> true), else as
 * it is. A change that brings its own new `t1` (a redo) keeps it.
 */
export function stampCompleted<S extends TLShape>(prev: S, next: S, now: number): S {
  if (!STROKE_TYPES.has(next.type)) return next;
  const was = (prev.props as { isComplete?: unknown }).isComplete === true;
  const is = (next.props as { isComplete?: unknown }).isComplete === true;
  if (was || !is) return next;
  const before = (prev.meta as Meta)[STROKE_TIME.end];
  const after = (next.meta as Meta)[STROKE_TIME.end];
  if (typeof after === "number" && after !== before) return next;
  return { ...next, meta: { ...(next.meta as Meta), [STROKE_TIME.end]: now } };
}

/** Registers both stamps on the board's editor; returns the function that removes them. */
export function registerStrokeTimes(editor: Pick<Editor, "sideEffects">, now: () => number = Date.now): () => void {
  // ids deleted while the board is open: one created again is coming back (undo, redo), not new
  const deleted = new Set<string>();
  const offDelete = editor.sideEffects.registerAfterDeleteHandler("shape", (shape) => {
    deleted.add(shape.id);
  });
  const offCreate = editor.sideEffects.registerBeforeCreateHandler("shape", (shape, source) => (source === "user" ? stampCreated(shape, now(), deleted.has(shape.id)) : shape));
  const offChange = editor.sideEffects.registerBeforeChangeHandler("shape", (prev, next, source) => (source === "user" ? stampCompleted(prev, next, now()) : next));
  return () => {
    offDelete();
    offCreate();
    offChange();
  };
}
