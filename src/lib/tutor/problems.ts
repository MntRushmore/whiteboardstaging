import { boxesNear } from "./geometry";
import { CLUSTER_GAP_PX, PROBLEM_COUNT, type ClusterBounds, type ProblemRecord } from "./types";

export function createProblemSet(): ProblemRecord[] {
  return Array.from({ length: PROBLEM_COUNT }, (_, i) => ({
    id: i + 1,
    unlocked: false,
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

/**
 * Ink unlocks a problem. Tapping a locked number must not advance.
 * A new cluster far from the active work finishes the current problem
 * and unlocks the next one.
 */
export function assignClusterToProblem(
  problems: ProblemRecord[],
  activeId: number,
  bbox: ClusterBounds,
  latex: string,
): { problemId: number; activeId: number; problems: ProblemRecord[] } {
  const next = problems.map((p) => ({ ...p }));
  const active = next[activeId - 1];
  if (!active) {
    return { problemId: 1, activeId: 1, problems: next };
  }

  const nearActive = Boolean(active.bbox && boxesNear(active.bbox, bbox, CLUSTER_GAP_PX));
  const continueActive = !active.unlocked || nearActive || !active.bbox;

  let problemId = active.id;
  if (!continueActive) {
    const nextLocked =
      next.find((p) => !p.unlocked && p.id > active.id) ?? next.find((p) => !p.unlocked);
    if (nextLocked) {
      active.finished = true;
      problemId = nextLocked.id;
    }
  }

  const target = next[problemId - 1];
  target.unlocked = true;
  target.latex = extractLatex(latex, target.latex);
  target.bbox = unionOrReplace(nearActive || problemId === active.id ? target.bbox : null, bbox);

  return { problemId, activeId: problemId, problems: next };
}

export function canSelectProblem(problems: ProblemRecord[], id: number): boolean {
  const problem = problems[id - 1];
  return Boolean(problem?.unlocked);
}

export function finishProblemsBehind(problems: ProblemRecord[], activeId: number): ProblemRecord[] {
  return problems.map((p) =>
    p.unlocked && p.id < activeId && !p.finished ? { ...p, finished: true } : p,
  );
}
