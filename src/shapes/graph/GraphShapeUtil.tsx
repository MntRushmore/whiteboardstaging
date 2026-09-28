"use client";

import { useEffect, useMemo, useState } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  resizeBox,
  stopEventPropagation,
  useEditor,
  type RecordProps,
  type TLResizeInfo,
} from "tldraw";
import { GRAPH_SHAPE_DEFAULTS, type GraphFn, type GraphShape } from "@/lib/live/contracts";
// the engine (and mathjs) load on demand: they are not part of the board's first load
const getEngine = () => import("@/lib/live/engine").then((m) => m.getEngine());
import { scheduleLiveWrite } from "@/lib/live/liveWrite";
import { renderLatex } from "../math/katex";
import { TICK_FONT_PX, buildPlot, type PlotOutput, type Sampler } from "./plot";

export const GRAPH_HEADER_PX = 22;
export const GRAPH_MIN_W = 160;
export const GRAPH_MIN_H = 120;

/** Reserved migration ids: the first real prop change adds `AddFoo: 1` here and a step below. */
export const graphShapeVersions = createShapePropsMigrationIds("graph", {});
export const graphShapeMigrations = createShapePropsMigrationSequence({ sequence: [] });

export const graphShapeProps: RecordProps<GraphShape> = {
  w: T.number,
  h: T.number,
  fns: T.arrayOf(T.object({ id: T.string, expr: T.string, latex: T.string, color: T.string })),
  points: T.arrayOf(T.object({ x: T.number, y: T.number, label: T.string })),
  xMin: T.number,
  xMax: T.number,
  yMin: T.number,
  yMax: T.number,
  autoY: T.boolean,
  grid: T.boolean,
  title: T.string,
  lineId: T.string,
};

export class GraphShapeUtil extends ShapeUtil<GraphShape> {
  static override type = "graph" as const;
  static override props = graphShapeProps;
  static override migrations = graphShapeMigrations;

  getDefaultProps(): GraphShape["props"] {
    return { ...GRAPH_SHAPE_DEFAULTS, fns: [], points: [] };
  }

  getGeometry(shape: GraphShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canEdit() {
    return false;
  }
  override canResize() {
    return true;
  }
  override isAspectRatioLocked() {
    return false;
  }
  override hideRotateHandle() {
    return true;
  }
  override getText(shape: GraphShape) {
    return graphTitle(shape.props);
  }

  override onResize(shape: GraphShape, info: TLResizeInfo<GraphShape>) {
    return resizeBox(shape, info, { minWidth: GRAPH_MIN_W, minHeight: GRAPH_MIN_H });
  }

  component(shape: GraphShape) {
    return <GraphShapeView shape={shape} />;
  }

  indicator(shape: GraphShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={6} />;
  }

  override async toSvg(shape: GraphShape) {
    const engine = await getEngine();
    const samplers = new Map<string, Sampler | null>();
    for (const fn of shape.props.fns) samplers.set(fn.expr, compileMemo(fn.expr, engine.compileExpr));
    const plot = plotFor(shape, samplers);
    return (
      <g>
        <rect width={shape.props.w} height={shape.props.h} rx={6} fill="#ffffff" stroke="#e5e7eb" />
        <text
          x={8}
          y={15}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize={11}
          fill="#374151"
        >
          {graphTitle(shape.props)}
        </text>
        <g transform={`translate(0 ${GRAPH_HEADER_PX})`}>
          <PlotSvgBody plot={plot} />
        </g>
      </g>
    );
  }
}

// ---------------------------------------------------------------------------

/** Per-expression sampler cache shared by every graph shape (and `toSvg`). */
const samplerMemo = new Map<string, Sampler | null>();
function compileMemo(expr: string, compile: (e: string) => Sampler | null): Sampler | null {
  if (samplerMemo.has(expr)) return samplerMemo.get(expr) ?? null;
  let s: Sampler | null = null;
  try {
    s = compile(expr);
  } catch {
    s = null;
  }
  samplerMemo.set(expr, s);
  return s;
}

function samplersFromMemo(exprs: string[]): Map<string, Sampler | null> {
  const m = new Map<string, Sampler | null>();
  for (const e of exprs) m.set(e, samplerMemo.get(e) ?? null);
  return m;
}

/** Resolves samplers for the given fns; re-renders once the engine has compiled them. */
function useSamplers(fns: GraphFn[]): Map<string, Sampler | null> {
  const key = fns.map((f) => f.expr).join("\u0000");
  const exprs = useMemo(() => key.split("\u0000").filter((e) => e.length > 0), [key]);
  const [compiled, setCompiled] = useState<Map<string, Sampler | null> | null>(null);
  useEffect(() => {
    let alive = true;
    if (exprs.every((e) => samplerMemo.has(e))) return;
    void getEngine().then((engine) => {
      if (!alive) return;
      const next = new Map<string, Sampler | null>();
      for (const e of exprs) next.set(e, compileMemo(e, engine.compileExpr));
      setCompiled(next);
    });
    return () => {
      alive = false;
    };
  }, [exprs]);
  return useMemo(() => {
    if (compiled && exprs.every((e) => compiled.has(e))) return compiled;
    return samplersFromMemo(exprs);
  }, [compiled, exprs]);
}

function plotFor(shape: GraphShape, samplers: Map<string, Sampler | null>): PlotOutput {
  const p = shape.props;
  return buildPlot({
    fns: p.fns.slice(0, 6).map((f) => ({ id: f.id, sampler: samplers.get(f.expr) ?? null, color: f.color })),
    points: p.points,
    xMin: p.xMin,
    xMax: p.xMax,
    yMin: p.yMin,
    yMax: p.yMax,
    autoY: p.autoY,
    grid: p.grid,
    w: p.w,
    h: Math.max(1, p.h - GRAPH_HEADER_PX),
  });
}

function graphTitle(props: GraphShape["props"]): string {
  if (props.title) return props.title;
  return props.fns.map((f) => f.latex || f.expr).join(",\\; ");
}

const STYLE = `
.live-graph{background:#fff;border:1px solid #e5e7eb;border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,.06);overflow:hidden;display:flex;flex-direction:column;pointer-events:all}
.live-graph__header{display:flex;align-items:center;gap:6px;height:${GRAPH_HEADER_PX}px;padding:0 6px 0 8px;border-bottom:1px solid #f3f4f6;font:12px/1 ui-sans-serif,system-ui,sans-serif;color:#374151;flex:none}
.live-graph__title{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px}
.live-graph__title .katex{font-size:1em}
.live-graph__btn{all:unset;cursor:pointer;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;color:#6b7280;font:600 13px/1 ui-sans-serif,system-ui,sans-serif}
.live-graph__btn:hover{background:#f3f4f6;color:#111827}
.live-graph__svg{display:block;flex:1;min-height:0}
`;

function GraphShapeView({ shape }: { shape: GraphShape }) {
  const editor = useEditor();
  const samplers = useSamplers(shape.props.fns);
  const plot = useMemo(() => plotFor(shape, samplers), [shape, samplers]);
  const titleHtml = useMemo(() => renderLatex(graphTitle(shape.props)), [shape.props]);

  const scaleX = (factor: number) => {
    const { xMin, xMax } = shape.props;
    const c = (xMin + xMax) / 2;
    const half = ((xMax - xMin) / 2) * factor;
    if (half < 1e-6 || half > 1e9) return;
    scheduleLiveWrite(editor, () => {
      if (!editor.getShape(shape.id)) return;
      editor.updateShape<GraphShape>({ id: shape.id, type: "graph", props: { xMin: c - half, xMax: c + half } });
    });
  };
  const close = () => {
    scheduleLiveWrite(editor, () => {
      if (editor.getShape(shape.id)) editor.deleteShape(shape.id);
    });
  };

  return (
    <HTMLContainer className="live-graph" data-line-id={shape.props.lineId}>
      <style>{STYLE}</style>
      <div className="live-graph__header">
        <span className="live-graph__title" dangerouslySetInnerHTML={{ __html: titleHtml || "&nbsp;" }} />
        <HeaderButton label="Zoom out (wider x-range)" onClick={() => scaleX(2)}>
          {"−"}
        </HeaderButton>
        <HeaderButton label="Zoom in (narrower x-range)" onClick={() => scaleX(0.5)}>
          +
        </HeaderButton>
        <HeaderButton label="Close graph" onClick={close}>
          {"×"}
        </HeaderButton>
      </div>
      <svg
        className="live-graph__svg"
        viewBox={`0 0 ${plot.w} ${plot.h}`}
        width={plot.w}
        height={plot.h}
        preserveAspectRatio="none"
      >
        <PlotSvgBody plot={plot} />
      </svg>
    </HTMLContainer>
  );
}

function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="live-graph__btn"
      aria-label={label}
      title={label}
      onPointerDown={stopEventPropagation}
      onPointerUp={stopEventPropagation}
      onTouchStart={stopEventPropagation}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** Shared between the live component and `toSvg` so exports are pixel-identical. */
export function PlotSvgBody({ plot }: { plot: PlotOutput }) {
  return (
    <g fontFamily="ui-sans-serif, system-ui, sans-serif">
      <rect width={plot.w} height={plot.h} fill="#ffffff" />
      {plot.gridLines.map((l, i) => (
        <line key={`g${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#f1f5f9" strokeWidth={1} />
      ))}
      {plot.axes.x0 !== null ? (
        <line x1={plot.axes.x0} y1={0} x2={plot.axes.x0} y2={plot.h} stroke="#94a3b8" strokeWidth={1} />
      ) : null}
      {plot.axes.y0 !== null ? (
        <line x1={0} y1={plot.axes.y0} x2={plot.w} y2={plot.axes.y0} stroke="#94a3b8" strokeWidth={1} />
      ) : null}
      {plot.tickLabels.map((t, i) => (
        <text
          key={`t${i}`}
          x={t.x}
          y={t.y}
          fontSize={TICK_FONT_PX}
          fill="#94a3b8"
          textAnchor={t.axis === "x" ? "middle" : "start"}
        >
          {t.text}
        </text>
      ))}
      {plot.paths.map((p) => (
        <path
          key={p.id}
          d={p.d}
          fill="none"
          stroke={p.color}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {plot.points.map((pt, i) => (
        <g key={`p${i}`}>
          <circle cx={pt.cx} cy={pt.cy} r={3.5} fill="#111827" stroke="#ffffff" strokeWidth={1.5} />
          {pt.label ? (
            <text x={pt.cx + 6} y={pt.cy - 6} fontSize={10} fill="#111827">
              {pt.label}
            </text>
          ) : null}
        </g>
      ))}
    </g>
  );
}
