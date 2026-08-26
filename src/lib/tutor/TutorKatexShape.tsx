"use client";

import katex from "katex";
import "katex/dist/katex.min.css";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type TLBaseShape,
} from "tldraw";

export type TutorKatexShape = TLBaseShape<"tutor-katex", { w: number; h: number; latex: string }>;

function renderKatex(latex: string): string {
  try {
    return katex.renderToString(latex.replace(/^\$+|\$+$/g, ""), {
      throwOnError: false,
      displayMode: false,
    });
  } catch {
    return latex;
  }
}

export class TutorKatexShapeUtil extends BaseBoxShapeUtil<TutorKatexShape> {
  static override type = "tutor-katex" as const;
  static override props = {
    w: T.number,
    h: T.number,
    latex: T.string,
  };

  getDefaultProps(): TutorKatexShape["props"] {
    return { w: 80, h: 22, latex: "" };
  }

  override canEdit() {
    return false;
  }

  override canResize() {
    return false;
  }

  override hideSelectionBoundsFg() {
    return true;
  }

  component(shape: TutorKatexShape) {
    return (
      <HTMLContainer
        className="tutor-katex"
        style={{
          width: shape.props.w,
          height: shape.props.h,
          overflow: "visible",
          pointerEvents: "none",
          background: "none",
          border: "none",
          boxShadow: "none",
        }}
      >
        <span dangerouslySetInnerHTML={{ __html: renderKatex(shape.props.latex) }} />
      </HTMLContainer>
    );
  }

  indicator(shape: TutorKatexShape) {
    return <rect width={shape.props.w} height={shape.props.h} fill="none" />;
  }
}
