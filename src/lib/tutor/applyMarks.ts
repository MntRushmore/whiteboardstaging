import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import { isTutorShape } from "./cluster";
import { composeDiagram } from "./hand/diagrams";
import { planTutorInk } from "./hand/plan";
import { getDemoProblem } from "./problems";
import {
  PROBLEM_META,
  TUTOR_DIAGRAM_META,
  TUTOR_LAYER_META,
  TUTOR_PENDING_META,
  isPendingTutorMeta,
  type TutorMark,
  type TutorMode,
} from "./types";

export { planTutorInk } from "./hand/plan";
export type { InkPlan } from "./hand/plan";

const TUTOR_DRAW = {
  color: "red" as const,
  fill: "none" as const,
  dash: "draw" as const,
  size: "s" as const,
  isComplete: true,
  isPen: true,
  scale: 1,
};

function isDiagramShape(shape: { meta?: Record<string, unknown> }): boolean {
  return shape.meta?.[TUTOR_DIAGRAM_META] === true;
}

export function isPendingTutorShape(shape: { meta?: Record<string, unknown> }): boolean {
  return isPendingTutorMeta(shape.meta);
}

export function getPendingTutorShapeIds(editor: Editor, problemId?: number): TLShapeId[] {
  return editor
    .getCurrentPageShapes()
    .filter((shape) => {
      if (!isPendingTutorShape(shape)) return false;
      if (problemId == null) return true;
      return (shape.meta as Record<string, unknown> | undefined)?.[PROBLEM_META] === problemId;
    })
    .map((shape) => shape.id);
}

export function getTutorShapeIds(
  editor: Editor,
  problemId?: number,
  opts?: { diagrams?: boolean },
): TLShapeId[] {
  return editor
    .getCurrentPageShapes()
    .filter((shape) => {
      if (!isTutorShape(shape)) return false;
      if (!opts?.diagrams && isDiagramShape(shape)) return false;
      if (problemId == null) return true;
      return (shape.meta as Record<string, unknown> | undefined)?.[PROBLEM_META] === problemId;
    })
    .map((shape) => shape.id);
}

export function clearTutorMarks(editor: Editor, problemId?: number): void {
  const ids = getTutorShapeIds(editor, problemId);
  if (ids.length === 0) return;

  editor.run(
    () => {
      for (const id of ids) {
        const shape = editor.getShape(id);
        if (!shape) continue;
        editor.updateShape({ id, type: shape.type, isLocked: false });
      }
      editor.deleteShapes(ids);
    },
    { ignoreShapeLock: true },
  );
}

function tutorMeta(mark: TutorMark, extra?: Record<string, unknown>) {
  return {
    [TUTOR_LAYER_META]: true,
    [PROBLEM_META]: mark.problemId,
    latex: mark.latex,
    bbox: mark.bbox,
    markKind: mark.kind,
    [TUTOR_PENDING_META]: true,
    ...extra,
  };
}

export function acceptTutorMarks(editor: Editor, problemId?: number): void {
  const ids = getPendingTutorShapeIds(editor, problemId);
  if (ids.length === 0) return;
  editor.run(
    () => {
      for (const id of ids) {
        const shape = editor.getShape(id);
        if (!shape) continue;
        const meta = (shape.meta ?? {}) as Record<string, unknown>;
        editor.updateShape({
          id,
          type: shape.type,
          meta: { ...meta, [TUTOR_PENDING_META]: false },
        });
      }
    },
    { history: "ignore", ignoreShapeLock: true },
  );
}

export function rejectTutorMarks(editor: Editor, problemId?: number): TLShapeId[] {
  const ids = getPendingTutorShapeIds(editor, problemId);
  if (ids.length === 0) return [];
  editor.run(
    () => {
      for (const id of ids) {
        const shape = editor.getShape(id);
        if (!shape) continue;
        editor.updateShape({ id, type: shape.type, isLocked: false });
      }
      editor.deleteShapes(ids);
    },
    { ignoreShapeLock: true },
  );
  return ids;
}

export function syncGeometryDiagram(
  editor: Editor,
  problemId: number,
  opts?: { skip?: boolean },
): TLShapeId[] {
  if (opts?.skip) return [];
  const demo = getDemoProblem(problemId);
  const existing = editor.getCurrentPageShapes().filter((shape) => isTutorShape(shape) && isDiagramShape(shape));

  if (!demo?.diagram) {
    if (existing.length) {
      editor.run(
        () => {
          for (const shape of existing) {
            editor.updateShape({ id: shape.id, type: shape.type, isLocked: false });
          }
          editor.deleteShapes(existing.map((s) => s.id));
        },
        { ignoreShapeLock: true },
      );
    }
    return [];
  }

  if (existing.some((s) => (s.meta as Record<string, unknown>)[PROBLEM_META] === problemId)) {
    return existing.map((s) => s.id);
  }

  const ink = composeDiagram(demo.diagram);
  const id = createShapeId();
  editor.run(
    () => {
      for (const shape of existing) {
        editor.updateShape({ id: shape.id, type: shape.type, isLocked: false });
      }
      if (existing.length) editor.deleteShapes(existing.map((s) => s.id));
      editor.createShape({
        id,
        type: "draw",
        x: ink.x,
        y: ink.y,
        opacity: 1,
        isLocked: true,
        meta: {
          [TUTOR_LAYER_META]: true,
          [PROBLEM_META]: problemId,
          [TUTOR_DIAGRAM_META]: true,
          [TUTOR_PENDING_META]: true,
          diagram: demo.diagram,
        },
        props: {
          ...TUTOR_DRAW,
          isClosed: false,
          segments: ink.segments,
        },
      });
    },
    { ignoreShapeLock: true },
  );
  return [id];
}

export function applyTutorMarks(editor: Editor, marks: TutorMark[], mode?: TutorMode): TLShapeId[] {
  const created: TLShapeId[] = [];
  const problemId = marks[0]?.problemId;

  editor.run(
    () => {
      if (problemId != null) clearTutorMarks(editor, problemId);

      for (const mark of marks) {
        for (const plan of planTutorInk(mark, mode)) {
          const id = createShapeId();
          const meta = tutorMeta(mark, { ink: plan.kind });

          if (plan.kind === "draw") {
            if (plan.segments.length === 0) continue;
            editor.createShape({
              id,
              type: "draw",
              x: plan.x,
              y: plan.y,
              opacity: 0,
              isLocked: true,
              meta,
              props: {
                ...TUTOR_DRAW,
                isClosed: plan.closed,
                segments: plan.segments,
              },
            });
          } else {
            editor.createShape({
              id,
              type: "tutor-katex",
              x: plan.x,
              y: plan.y,
              opacity: 0,
              isLocked: true,
              meta,
              props: {
                w: plan.w,
                h: plan.h,
                latex: plan.latex,
              },
            });
          }

          created.push(id);
        }
      }
    },
    { ignoreShapeLock: true },
  );

  return created;
}

export function fadeInTutorShapes(editor: Editor, ids: TLShapeId[]): void {
  if (ids.length === 0) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      editor.run(
        () => {
          for (const id of ids) {
            const shape = editor.getShape(id);
            if (!shape) continue;
            editor.updateShape({ id, type: shape.type, opacity: 1 });
          }
        },
        { history: "ignore", ignoreShapeLock: true },
      );
    });
  });
}

export function stampStudentProblemId(
  editor: Editor,
  shapeIds: TLShapeId[],
  problemId: number,
): void {
  editor.run(
    () => {
      for (const id of shapeIds) {
        const shape = editor.getShape(id);
        if (!shape || isTutorShape(shape)) continue;
        const meta = (shape.meta ?? {}) as Record<string, unknown>;
        if (meta[PROBLEM_META] === problemId) continue;
        editor.updateShape({
          id,
          type: shape.type,
          meta: { ...meta, [PROBLEM_META]: problemId },
        });
      }
    },
    { history: "ignore" },
  );
}
