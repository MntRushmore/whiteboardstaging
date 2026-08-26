import {
  PROBLEM_COUNT,
  type ClusterBounds,
  type ProblemRecord,
  type ProblemSubject,
} from "./types";

export type DemoProblem = {
  id: number;
  subject: ProblemSubject;
  title: string;
  socratic: string;
};

/** Three sets, four problems each. Stub titles — Simon can replace wording. */
export const DEMO_PROBLEMS: DemoProblem[] = [
  { id: 1, subject: "algebra", title: "expand (x+2)^2", socratic: "What do you get if you foil first?" },
  { id: 2, subject: "algebra", title: "factor x^2-5x+6", socratic: "Which two numbers multiply to 6 and add to -5?" },
  { id: 3, subject: "algebra", title: "solve 2x+3=7", socratic: "What happens if you move the 3 first?" },
  { id: 4, subject: "algebra", title: "simplify (x^2-1)/(x-1)", socratic: "Can you factor the top?" },
  { id: 5, subject: "calculus", title: "d/dx x^2", socratic: "What is the derivative of x^n?" },
  { id: 6, subject: "calculus", title: "d/dx (x^3-4x)", socratic: "Can you take it term by term?" },
  { id: 7, subject: "calculus", title: "∫ 2x dx", socratic: "What power do you add when you undo a derivative?" },
  { id: 8, subject: "calculus", title: "related rates (cone)", socratic: "Which two quantities are changing?" },
  { id: 9, subject: "geometry", title: "find the angle", socratic: "What do the three angles of a triangle add to?" },
  { id: 10, subject: "geometry", title: "parallel lines", socratic: "If the lines are parallel, what stays equal?" },
  { id: 11, subject: "geometry", title: "right triangle", socratic: "Which side is across from the right angle?" },
  { id: 12, subject: "geometry", title: "similar triangles", socratic: "Which triangle gets the larger scale number?" },
];

export function getDemoProblem(id: number): DemoProblem | undefined {
  return DEMO_PROBLEMS.find((p) => p.id === id);
}

export function isGeometryProblem(id: number): boolean {
  return getDemoProblem(id)?.subject === "geometry";
}

export function createProblemSet(): ProblemRecord[] {
  return DEMO_PROBLEMS.map((demo) => ({
    id: demo.id,
    unlocked: true,
    finished: false,
    latex: "",
    bbox: null,
    subject: demo.subject,
    title: demo.title,
    socratic: demo.socratic,
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
