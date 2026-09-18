"use client";

import { useLayoutEffect, useRef } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  stopEventPropagation,
  useEditor,
  useIsEditing,
  type Editor,
  type RecordProps,
  type TLShapeId,
} from "tldraw";
import { TUTOR_INK_HEX, answerContinuation, composeAnswer } from "@/lib/live/answer";
import {
  LIVE_VERDICTS,
  MATH_SHAPE_DEFAULTS,
  MATH_SIZES,
  MATH_SOURCES,
  MATH_TONES,
  type MathShape,
  type MathSize,
} from "@/lib/live/contracts";
import { scheduleLiveWrite } from "@/lib/live/liveWrite";
import { badgeLabel, badgeTitle, dispatchBadgeTap, isBadgeStatus, noteLineFor } from "./badge";
import { renderLatex } from "./katex";
import { MathEditor } from "./MathEditor";

export { BADGE_TAP_EVENT, type BadgeTapDetail } from "./badge";

export const MATH_FONT_PX: Record<MathSize, number> = { s: 18, m: 24, l: 32 };
export const MATH_COLORS = {
  ok: "#16a34a",
  warn: "#d97706",
  /** the tutor's colour, shared with the handwriting (`TUTOR_INK_COLOR`) */
  accent: TUTOR_INK_HEX,
  muted: "#6b7280",
} as const;
export const UNREADABLE_COPY = "Couldn't read this — tap to type it";

/** Reserved migration ids: the first real prop change adds `AddFoo: 1` here and a step below. */
export const mathShapeVersions = createShapePropsMigrationIds("math", {});
export const mathShapeMigrations = createShapePropsMigrationSequence({ sequence: [] });

export const mathShapeProps: RecordProps<MathShape> = {
  w: T.number,
  h: T.number,
  latex: T.string,
  source: T.literalEnum(...MATH_SOURCES),
  status: T.literalEnum(...LIVE_VERDICTS),
  resultLatex: T.string,
  note: T.string,
  anchorIds: T.arrayOf(T.string),
  lineId: T.string,
  size: T.literalEnum(...MATH_SIZES),
  tone: T.literalEnum(...MATH_TONES),
};

export class MathShapeUtil extends ShapeUtil<MathShape> {
  static override type = "math" as const;
  static override props = mathShapeProps;
  static override migrations = mathShapeMigrations;

  getDefaultProps(): MathShape["props"] {
    return { ...MATH_SHAPE_DEFAULTS, anchorIds: [] };
  }

  getGeometry(shape: MathShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canEdit() {
    return true;
  }
  override canResize() {
    return false;
  }
  override hideRotateHandle() {
    return true;
  }
  override isAspectRatioLocked() {
    return true;
  }
  override getText(shape: MathShape) {
    return shape.props.latex;
  }

  component(shape: MathShape) {
    return <MathShapeView shape={shape} />;
  }

  indicator(shape: MathShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={6} />;
  }

  override toSvg(shape: MathShape) {
    const { latex, resultLatex, tone, size } = shape.props;
    const text = resultLatex ? composeAnswer(latex, resultLatex) : latex;
    return (
      <text
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize={Math.round(MATH_FONT_PX[size] * 0.6)}
        fill={tone === "muted" ? MATH_COLORS.muted : tone === "accent" ? "#1d4ed8" : "#111827"}
        x={8}
        y={shape.props.h / 2 + 5}
      >
        {text}
      </text>
    );
  }
}

// ---------------------------------------------------------------------------

const STYLE = `
.live-math{font-family:KaTeX_Main,"Times New Roman",serif;color:#111827;overflow:visible}
.live-math__inner{position:absolute;left:0;top:0;display:inline-flex;align-items:center;gap:8px;width:max-content;max-width:640px;min-height:100%;padding:6px 10px;border-radius:6px;box-sizing:border-box;white-space:nowrap}
.live-math[data-tone="muted"] .live-math__inner{color:#374151;opacity:.6}
.live-math[data-tone="accent"] .live-math__inner{color:#1e3a8a;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.35)}
.live-math__ai{position:absolute;right:-2px;top:-8px;font:600 9px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.04em;color:#fff;background:${MATH_COLORS.accent};border-radius:4px;padding:2px 4px}
.live-math__badge{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:none;font:600 12px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;pointer-events:all;touch-action:manipulation}
.live-math__badge:focus-visible{outline:2px solid ${MATH_COLORS.accent};outline-offset:2px;border-radius:999px}
.live-math__badge--ok{color:${MATH_COLORS.ok}}
.live-math__badge--warn{width:9px;height:9px;border-radius:50%;background:${MATH_COLORS.warn}}
.live-math__badge--solved{color:${MATH_COLORS.ok};background:rgba(22,163,74,.12);border-radius:999px;padding:3px 8px;font-size:11px}
.live-math__body{display:flex;flex-direction:column;align-items:stretch;width:max-content;min-width:0}
.live-math__main{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.live-math__note{width:0;min-width:100%;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px/1.3 ui-sans-serif,system-ui,sans-serif;color:${MATH_COLORS.muted}}
.live-math__note .katex{font-size:1.05em}
.live-math__result{color:${MATH_COLORS.muted};font-size:.85em}
.live-math__unreadable{color:#9ca3af;font:italic 13px/1.3 ui-sans-serif,system-ui,sans-serif;white-space:nowrap}
.live-math__editor{position:absolute;left:0;top:0;display:flex;flex-direction:column;gap:6px;width:max-content;min-width:220px;max-width:640px;padding:6px 10px;background:#fff;border:1px solid #3b82f6;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.12);box-sizing:border-box}
.live-math__textarea{font:14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#111827;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:4px 6px;resize:none;outline:none;min-width:200px}
.live-math__textarea:focus{border-color:#3b82f6}
.live-math__preview{min-height:1.4em;color:#111827}
.live-math .katex{font-size:1em;line-height:1.2}
`;

function MathShapeView({ shape }: { shape: MathShape }) {
  const editor = useEditor();
  const isEditing = useIsEditing(shape.id);
  const { latex, status, source, tone, size, resultLatex, note } = shape.props;
  const fontSize = MATH_FONT_PX[size];
  const innerRef = useRef<HTMLDivElement>(null);

  useMeasuredSize(editor, shape.id, innerRef, shape.props.w, shape.props.h, isEditing);

  const unreadable = status === "unknown" && latex.trim() === "";
  const noteLine = noteLineFor(status, note);

  return (
    <HTMLContainer
      className="live-math"
      data-status={status}
      data-source={source}
      data-tone={tone}
      data-size={size}
      style={{ fontSize }}
    >
      <style>{STYLE}</style>
      {isEditing ? (
        <div ref={innerRef} style={{ position: "absolute", left: 0, top: 0, width: "max-content" }}>
          <MathEditor shape={shape} fontSize={fontSize} />
        </div>
      ) : (
        <div ref={innerRef} className="live-math__inner">
          {tone === "accent" ? <span className="live-math__ai">AI</span> : null}
          <Badge status={status} note={note} lineId={shape.props.lineId} shapeId={shape.id} />
          <div className="live-math__body">
            <div className="live-math__main">
              {unreadable ? (
                <span className="live-math__unreadable">{UNREADABLE_COPY}</span>
              ) : (
                <span className="live-math__latex" dangerouslySetInnerHTML={{ __html: renderLatex(latex) }} />
              )}
              {resultLatex ? (
                <span
                  className="live-math__result"
                  // `36 + 2 =` already ends in a relation: what follows is `38`, not `= 38`.
                  dangerouslySetInnerHTML={{ __html: renderLatex(answerContinuation(latex, resultLatex)) }}
                />
              ) : null}
            </div>
            {noteLine ? <NoteLine line={noteLine} title={note} /> : null}
          </div>
        </div>
      )}
    </HTMLContainer>
  );
}

export interface BadgeProps {
  status: MathShape["props"]["status"];
  note: string;
  lineId: string;
  shapeId: string;
}

/**
 * ok: green check; warn: amber dot; solved: "Solved" chip. A real button: tapping it stops the
 * pointer event before the canvas (no select/drag) and dispatches `live:badge-tap` for the loop.
 */
export function Badge({ status, note, lineId, shapeId }: BadgeProps) {
  if (!isBadgeStatus(status)) return null;
  return (
    <button
      type="button"
      className={`live-math__badge live-math__badge--${status}`}
      data-testid="live-math-badge"
      aria-label={badgeLabel(status, note)}
      title={badgeTitle(status, note)}
      onPointerDown={stopEventPropagation}
      onPointerUp={stopEventPropagation}
      onTouchStart={stopEventPropagation}
      onClick={(e) => {
        e.stopPropagation();
        dispatchBadgeTap({ lineId, shapeId });
      }}
    >
      {status === "ok" ? "✓" : status === "solved" ? "Solved" : null}
    </button>
  );
}

/** One muted line under the LaTeX (ellipsis when wider than the echo); `Balanced: …` renders its equation with KaTeX. */
export function NoteLine({ line, title }: { line: { text: string; latex: string }; title: string }) {
  return (
    <div className="live-math__note" data-testid="live-math-note" title={title}>
      {line.text}
      {line.latex ? (
        <>
          {" "}
          <span dangerouslySetInnerHTML={{ __html: renderLatex(line.latex) }} />
        </>
      ) : null}
    </div>
  );
}

/**
 * Keeps `props.w/h` in sync with the rendered KaTeX box. Writes go through scheduleLiveWrite
 * (source 'remote' → not undoable, invisible to the legacy user listeners) and are guarded by
 * a last-written ref so a write that re-renders us cannot loop.
 */
function useMeasuredSize(
  editor: Editor,
  id: TLShapeId,
  ref: React.RefObject<HTMLDivElement | null>,
  w: number,
  h: number,
  isEditing: boolean,
) {
  const lastWritten = useRef<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || isEditing || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const zoom = editor.getZoomLevel() || 1;
      const nw = Math.max(24, Math.round(rect.width / zoom));
      const nh = Math.max(24, Math.round(rect.height / zoom));
      if (!Number.isFinite(nw) || !Number.isFinite(nh)) return;
      const cur = editor.getShape(id);
      if (!cur || cur.type !== "math") return;
      const cw = (cur as MathShape).props.w;
      const ch = (cur as MathShape).props.h;
      if (Math.abs(nw - cw) <= 2 && Math.abs(nh - ch) <= 2) return;
      const last = lastWritten.current;
      if (last && Math.abs(nw - last.w) <= 2 && Math.abs(nh - last.h) <= 2) return;
      lastWritten.current = { w: nw, h: nh };
      scheduleLiveWrite(editor, () => {
        const s = editor.getShape(id);
        if (!s || s.type !== "math") return;
        editor.updateShape<MathShape>({ id, type: "math", props: { w: nw, h: nh } });
      });
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
    // w/h are deps so a prop change from elsewhere re-checks the measurement
  }, [editor, id, ref, w, h, isEditing]);
}
