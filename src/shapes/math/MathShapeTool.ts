import {
  BaseBoxShapeTool,
  StateNode,
  createShapeId,
  type TLPointerEventInfo,
  type TLShapeId,
  type TLStateNodeConstructor,
} from "tldraw";
import { MATH_SHAPE_DEFAULTS, type MathShape } from "@/lib/live/contracts";

/**
 * "Math" tool (kbd `m`): a click places a `source:'student'` math shape centred on the
 * pointer and enters editing so the student can type LaTeX right away. The shape is not
 * resizable, so a drag behaves like a click (no rubber-band box).
 */
export class MathShapeTool extends BaseBoxShapeTool {
  static override id = "math";
  static override initial = "idle";
  static override children = (): TLStateNodeConstructor[] => [MathIdle, MathPointing];
  override shapeType = "math";
}

class MathIdle extends StateNode {
  static override id = "idle";
  override onEnter() {
    this.editor.setCursor({ type: "cross", rotation: 0 });
  }
  override onPointerDown(info: TLPointerEventInfo) {
    this.parent.transition("pointing", info);
  }
  override onCancel() {
    this.editor.setCurrentTool("select");
  }
}

class MathPointing extends StateNode {
  static override id = "pointing";
  private info: TLPointerEventInfo | undefined;
  private markId = "";

  override onEnter(info: TLPointerEventInfo) {
    this.info = info;
  }
  override onPointerUp() {
    this.complete();
  }
  override onComplete() {
    this.complete();
  }
  override onCancel() {
    this.cancel();
  }
  override onInterrupt() {
    this.cancel();
  }

  private complete() {
    const { editor } = this;
    const id: TLShapeId = createShapeId();
    this.markId = editor.markHistoryStoppingPoint(`creating_math:${id}`);
    const { originPagePoint } = editor.inputs;
    const { w, h } = MATH_SHAPE_DEFAULTS;
    editor.createShape<MathShape>({
      id,
      type: "math",
      x: originPagePoint.x - w / 2,
      y: originPagePoint.y - h / 2,
      props: { ...MATH_SHAPE_DEFAULTS, anchorIds: [], source: "student", tone: "normal" },
    });
    const shape = editor.getShape<MathShape>(id);
    if (!shape) {
      this.cancel();
      return;
    }
    editor.select(id);
    if (editor.getInstanceState().isToolLocked) {
      this.parent.transition("idle");
      return;
    }
    editor.setEditingShape(id);
    editor.setCurrentTool("select.editing_shape", { ...this.info, target: "shape", shape });
  }

  private cancel() {
    if (this.markId) this.editor.bailToMark(this.markId);
    this.parent.transition("idle");
  }
}
