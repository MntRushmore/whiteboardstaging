import {
  PROBLEM_COUNT,
  type ClusterBounds,
  type ProblemRecord,
  type ProblemSubject,
} from "./types";
import type { DiagramKind } from "./hand/diagrams";

export type DemoProblem = {
  id: number;
  subject: ProblemSubject;
  title: string;
  socratic: string;
  diagram?: DiagramKind;
};

/** Simon's 12 — titles + socratic openers verbatim. */
export const DEMO_PROBLEMS: DemoProblem[] = [
  {
    id: 1,
    subject: "algebra",
    title: "Solve for x: 3(x - 2) = 2x + 5",
    socratic: "What happens if you distribute the 3 first?",
  },
  {
    id: 2,
    subject: "algebra",
    title: "Factor: x^2 - x - 12",
    socratic: "Which two numbers multiply to -12 and add to -1?",
  },
  {
    id: 3,
    subject: "algebra",
    title: "A rectangle is 3 more than twice its width. The perimeter is 46. Find the sides.",
    socratic: "If width is w, how do you write the length?",
  },
  {
    id: 4,
    subject: "algebra",
    title: "Solve: (x + 1) / (x - 2) = 3",
    socratic: "What value of x would make this fraction undefined?",
  },
  {
    id: 5,
    subject: "calculus",
    title: "Find d/dx [x^3 - 4x]",
    socratic: "What is the derivative of x^n?",
  },
  {
    id: 6,
    subject: "calculus",
    title: "If f(x) = (2x + 1)(x^2), find f'(x).",
    socratic: "Product, or do you want to expand first?",
  },
  {
    id: 7,
    subject: "calculus",
    title: "Evaluate ∫ (3x^2 - 2) dx",
    socratic: "What power do you add when you undo a derivative?",
  },
  {
    id: 8,
    subject: "calculus",
    title:
      "Water drains from an inverted cone. Height is 3 times the radius. When h = 6, dh/dt = -2. Find dr/dt.",
    socratic: "What is the volume of a cone, and which two quantities are changing?",
  },
  {
    id: 9,
    subject: "geometry",
    title: "Triangle ABC has angle A = 47° and angle B = 62°. Find angle C.",
    socratic: "What do the three angles of a triangle add to?",
    diagram: "triangle",
  },
  {
    id: 10,
    subject: "geometry",
    title:
      "Line l is parallel to line m, transversal t. One interior angle is 118°. Find the alternate interior angle.",
    socratic: "If the lines are parallel, what is true of alternate interior angles?",
    diagram: "parallel-transversal",
  },
  {
    id: 11,
    subject: "geometry",
    title: "A right triangle has legs 6 and 8. Find the hypotenuse.",
    socratic: "Which side is across from the right angle?",
    diagram: "right-triangle",
  },
  {
    id: 12,
    subject: "geometry",
    title:
      "Two similar triangles have scale factor 2:3. The smaller has a side of 10. Find the matching side on the larger.",
    socratic: "Which triangle gets the 3 in 2:3?",
    diagram: "similar-triangles",
  },
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
    diagram: demo.diagram,
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
