import { PROBLEM_COUNT, type ClusterBounds, type ProblemRecord } from "./types";

export function createProblemSet(): ProblemRecord[] {
  return Array.from({ length: PROBLEM_COUNT }, (_, i) => ({
    id: i + 1,
    unlocked: true,
    finished: false,
    latex: "",
    bbox: null,
  }));
}

export function extractLatex(nearbyText: string, previous = ""): string {
  const next = nearbyText.trim();
  if (next) return next;
  return previous.trim();
}

export function unionOrReplace(
  prev: ClusterBounds | null,
  next: ClusterBounds,
): ClusterBounds {
  if (!prev) return next;
  const minX = Math.min(prev.x, next.x);
  const minY = Math.min(prev.y, next.y);
  const maxX = Math.max(prev.x + prev.w, next.x + next.w);
  const maxY = Math.max(prev.y + prev.h, next.y + next.h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Ink on the current page belongs to that problem only. */
export function recordInkOnProblem(
  problems: ProblemRecord[],
  problemId: number,
  bbox: ClusterBounds,
  latex: string,
): ProblemRecord[] {
  return problems.map((p) =>
    p.id === problemId
      ? {
          ...p,
          latex: extractLatex(latex, p.latex),
          bbox: unionOrReplace(p.bbox, bbox),
        }
      : p,
  );
}

export function markProblemFinished(
  problems: ProblemRecord[],
  problemId: number,
): ProblemRecord[] {
  return problems.map((p) =>
    p.id === problemId && (p.latex || p.bbox) ? { ...p, finished: true } : p,
  );
}

export function canSelectProblem(id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= PROBLEM_COUNT;
}
