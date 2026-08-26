import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import { isTutorShape } from "./cluster";
import { planTutorInk } from "./hand/plan";
import { PROBLEM_META, TUTOR_LAYER_META, type TutorMark, type TutorMode } from "./types";

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

export function getTutorShapeIds(editor: Editor, problemId?: number): TLShapeId[] {
  return editor
    .getCurrentPageShapes()
    .filter((shape) => {
      if (!isTutorShape(shape)) return false;
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
    ...extra,
  };
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
