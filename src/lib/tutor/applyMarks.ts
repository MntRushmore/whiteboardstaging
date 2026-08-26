import { createShapeId, toRichText, type Editor, type TLShapeId } from "tldraw";
import { isTutorShape } from "./cluster";
import { CIRCLE_STROKE_SCALE, NOTE_FONT_SCALE, unscaledTextWidth } from "./layout";
import { PROBLEM_META, TUTOR_LAYER_META, type TutorMark } from "./types";

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

function tutorMeta(mark: TutorMark) {
  return {
    [TUTOR_LAYER_META]: true,
    [PROBLEM_META]: mark.problemId,
    latex: mark.latex,
    bbox: mark.bbox,
    markKind: mark.kind,
  };
}

export function applyTutorMarks(editor: Editor, marks: TutorMark[]): TLShapeId[] {
  const created: TLShapeId[] = [];
  const problemId = marks[0]?.problemId;

  editor.run(
    () => {
      if (problemId != null) clearTutorMarks(editor, problemId);

      for (const mark of marks) {
        const id = createShapeId();
        const common = {
          id,
          x: mark.x,
          y: mark.y,
          opacity: 0,
          isLocked: true,
          meta: tutorMeta(mark),
        };

        if (mark.kind === "circle") {
          editor.createShape({
            ...common,
            type: "geo",
            props: {
              geo: "ellipse",
              w: mark.w,
              h: mark.h,
              color: "red",
              fill: "none",
              dash: "solid",
              size: "s",
              scale: CIRCLE_STROKE_SCALE,
            },
          });
        } else if (mark.kind === "caret") {
          editor.createShape({
            ...common,
            x: mark.x - mark.w / 2,
            type: "text",
            props: {
              color: "red",
              size: "s",
              font: "sans",
              textAlign: "middle",
              w: unscaledTextWidth(mark.w),
              richText: toRichText("^"),
              scale: NOTE_FONT_SCALE,
              autoSize: true,
            },
          });
        } else if (mark.kind === "underline") {
          editor.createShape({
            ...common,
            type: "line",
            y: mark.y + mark.h,
            props: {
              color: "orange",
              dash: "solid",
              size: "m",
              spline: "line",
              points: {
                a1: { id: "a1", index: "a1", x: 0, y: 0 },
                a2: { id: "a2", index: "a2", x: Math.max(16, mark.w), y: 0 },
              },
            },
          });
        } else if (mark.kind === "arrow") {
          editor.createShape({
            ...common,
            type: "arrow",
            props: {
              color: "blue",
              fill: "none",
              dash: "solid",
              size: "m",
              kind: "arc",
              arrowheadStart: "none",
              arrowheadEnd: "arrow",
              start: { x: 0, y: mark.h / 2 },
              end: { x: Math.max(24, mark.w), y: mark.h / 2 },
            },
          });
        } else {
          const text = mark.text?.trim();
          if (!text) continue;
          editor.createShape({
            ...common,
            type: "text",
            props: {
              color: "red",
              size: "s",
              font: "sans",
              textAlign: "start",
              w: unscaledTextWidth(mark.w),
              richText: toRichText(text),
              scale: NOTE_FONT_SCALE,
              autoSize: false,
            },
          });
        }

        created.push(id);
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
