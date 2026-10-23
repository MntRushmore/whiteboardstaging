import type { InkLine, InkStroke } from "./contracts";
import { cellOf, type ProblemCell } from "./chat/cells";
import { isArithmetic } from "./engine/columnWork";
import { assignColumns, medianStrokeHeight, unionRects, type ColumnOptions } from "./strokeClusters";
import { isSignsOnly, isSpeckLine, ownTicks } from "./youngHand";

/**
 * The lines without what a young student puts on the page that is no maths (`youngHand.ts`): a line
 * of nothing but taps of the pen is no line (`isSpeckLine`: never read, so never given a "?"); under
 * one of the chat's problems, nor is one of nothing but level bars — `-`, `=`, `= -`, an answer
 * started whose number is still to come (`isSignsOnly`: Mathpix reads a lone minus `\backslash`, and
 * `= -` as `=`) — until the number joins it; and under one of the chat's sums her own tick after her
 * answer is not part of it (`ownTicks`; a line that was only a tick is none). Those strokes stay on
 * the page in no line, like a drawing's. A division bar's or a stacked sum's line is left as it is.
 * `writing`: the strokes clustered; `cells`: the chat's problems; `columns`: what the columns know
 * besides the lines, for the columns assigned again when a line changed.
 *
 * The web's board (`LiveLoop.flush`) and the iPad's brain (`clusterStrokes` with `cells`) both run it.
 */
export function withoutStrays(lines: InkLine[], writing: readonly InkStroke[], columns: ColumnOptions | undefined, cells: readonly ProblemCell[]): InkLine[] {
  const byId = new Map(writing.map((s) => [s.id as string, s]));
  const glyph = medianStrokeHeight([...writing]);
  let changed = false;
  const out: InkLine[] = [];
  for (const line of lines) {
    const strokes = line.strokeIds.map((id) => byId.get(id)).filter((s): s is InkStroke => Boolean(s));
    // a division bar's line, a stacked sum's: not the clusterer's, left alone
    if (strokes.length !== line.strokeIds.length) {
      out.push(line);
      continue;
    }
    if (isSpeckLine(strokes, glyph)) {
      changed = true;
      continue;
    }
    const cell = cellOf(line.bounds, cells);
    // `-`, `=`, `= -` under one of the chat's problems: an answer started, its number still to come
    if (cell && isSignsOnly(strokes)) {
      changed = true;
      continue;
    }
    const ticks = cell && cell.lines.every(isArithmetic) ? ownTicks(strokes) : [];
    if (ticks.length === 0) {
      out.push(line);
      continue;
    }
    changed = true;
    const kept = strokes.filter((s) => !ticks.includes(s));
    if (kept.length > 0) out.push({ ...line, strokeIds: kept.map((s) => s.id), bounds: unionRects(kept.map((s) => s.bounds)) });
  }
  return changed ? assignColumns(out, columns) : lines;
}
