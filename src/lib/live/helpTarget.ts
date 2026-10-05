import type { TLShapeId } from "tldraw";
import type { LiveLineState, Rect } from "./contracts";
import { unionRects } from "./strokeClusters";

/**
 * Which problem Help me / Solve it act on when the screen holds several.
 *
 * A column of lines is one problem (`assignColumns`): lines one under another, until a blank gap of
 * a few lines (`problemGapFactor`) — a problem written further down is a problem of its own. The
 * line Help starts from decides which.
 * That line FOLLOWS THE PEN: the line holding the student's last fresh stroke. It used to be the line
 * Live happened to read last, and rubbing something out, dragging ink, Undo and a remote change all
 * re-read lines: rub out a slip in problem A while working on B, tap Help, and the tutor wrote under
 * A (and when one pass re-read several lines, the last in row order won). And the student can PICK:
 * a tap or a lasso with the select tool on a problem's ink, or on what the tutor wrote for it, wins
 * over the pen until the selection is cleared.
 *
 * Pure. The loop keeps the pen and reads the selection (`LiveLoop.helpTargetLine`) and publishes
 * the problem it would act on (`liveStore.helpTarget`); the outline around it (`ProblemHighlight`)
 * only reads that.
 */

type Line = Pick<LiveLineState, "line">;

/**
 * What the ask button acts on, for the outline drawn around it. `key` names the problem and stays
 * the same while the student works in it (`c:` + its top line, `p:` + a chat problem's cell, `d:` +
 * a drawing); `column` is -1 for a drawing, or for a chat problem with nothing of the student's
 * under it yet.
 */
export interface HelpTarget {
  key: string;
  column: number;
  /** the problem's ink: its lines, and the chat's problem above them (page coordinates) */
  bounds: Rect;
  /** picked with the select tool, or where the pen last wrote */
  by: "selection" | "pen";
  /** the problems on this screen (columns, and chat problems with no work under them yet) */
  problems: number;
  /** when the target last moved to another problem (ms; 0: not since it appeared) */
  changedAt: number;
}

export type HelpTargetDraft = Omit<HelpTarget, "changedAt">;

/**
 * The line the pen last wrote in: the one holding its last stroke, else (that stroke rubbed out
 * since) the line it was in, while that line is still there. Null when neither is.
 */
export function penLine<T extends Line>(lines: Readonly<Record<string, T>>, strokeId: string | null, lineId: string | null): T | null {
  if (strokeId) {
    for (const s of Object.values(lines)) if (s.line.strokeIds.includes(strokeId as TLShapeId)) return s;
  }
  return (lineId && lines[lineId]) || null;
}

/**
 * Of the lines the student selected, the one Help starts from: in the column holding most of them
 * (a lasso that clips the problem beside still means this one), the lowest — as the pen's line is
 * the latest one written. Null with none.
 */
export function pickedLine<T extends Line>(picked: readonly T[]): T | null {
  const count = new Map<number, number>();
  for (const s of picked) count.set(s.line.column, (count.get(s.line.column) ?? 0) + 1);
  const n = (s: T) => count.get(s.line.column) ?? 0;
  const bottom = (s: T) => s.line.bounds.y + s.line.bounds.h;
  return [...picked].sort((a, b) => n(b) - n(a) || bottom(b) - bottom(a))[0] ?? null;
}

/**
 * The problem around a column: its key and the box of its lines and of the chat's problem heading
 * it (`head`). With no column (a chat problem nothing is written under yet) the problem alone.
 * Null when there is nothing to draw around.
 */
export function problemTarget(lines: readonly Line[], column: number | null, head: { key: string; head: Rect } | null): Pick<HelpTarget, "key" | "column" | "bounds"> | null {
  const mine = column === null ? [] : lines.filter((s) => s.line.column === column).sort((a, b) => a.line.row - b.line.row);
  const rects = mine.map((s) => s.line.bounds);
  if (head) rects.push(head.head);
  if (rects.length === 0) return null;
  return { key: head ? `p:${head.key}` : `c:${mine[0].line.id}`, column: column ?? -1, bounds: unionRects(rects) };
}

/** Problems on the screen: its columns, and the chat's problems with nothing of the student's under them. */
export function problemCount(lines: readonly Line[], openProblems: number): number {
  return new Set(lines.map((s) => s.line.column)).size + openProblems;
}

/**
 * The target to publish after `next` was worked out: `prev` itself when nothing changed (the atom
 * is not set again, so the outline does not re-render at every flush), `changedAt` = `now` when it
 * moved to another problem — not when it first appears, on a load or a fresh screen, and not when
 * `quiet`: the tutor's own work moved it (a problem being written, then done), not the student.
 */
export function nextHelpTarget(prev: HelpTarget | null, next: HelpTargetDraft | null, now: number, opts: { quiet?: boolean } = {}): HelpTarget | null {
  if (!next) return null;
  const changedAt = prev && prev.key !== next.key && !opts.quiet ? now : (prev?.changedAt ?? 0);
  const b = prev?.bounds;
  const same =
    prev !== null &&
    prev.key === next.key &&
    prev.column === next.column &&
    prev.by === next.by &&
    prev.problems === next.problems &&
    b !== undefined &&
    b.x === next.bounds.x &&
    b.y === next.bounds.y &&
    b.w === next.bounds.w &&
    b.h === next.bounds.h;
  return same ? prev : { ...next, changedAt };
}
