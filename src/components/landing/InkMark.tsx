import type { CSSProperties, ReactNode } from "react";
import { composeArrow, composeUnderline, polylineToSvgD } from "@/lib/hand";
import { BOARD_LINES } from "@/lib/landing/boardInk";
import { pathBounds } from "@/lib/landing/replay";
import { INK_DRAW_ATTR } from "./inkStart";
import styles from "./ink.module.css";

/**
 * The tutor's marks, on the page's own words (v3). The check and the circle are the very strokes the
 * board's live tutor drew on a real board (boardInk.ts), scaled to fit; the underline and the arrow
 * are the hand engine's teacher marks (src/lib/hand/compose.ts). So the page never wears a mark the
 * product would not make. Server-rendered, static; the words stay real text. With `draw` (a key,
 * unique on the page) the mark draws itself once in view, `atMs` after that, over `forMs`.
 */

type Ink = "tutor" | "kid" | "white";

interface DrawProps {
  ink?: Ink;
  draw?: string;
  atMs?: number;
  forMs?: number;
  /** the pen's width in CSS px */
  pen?: number;
  className?: string;
}

const TICK = BOARD_LINES.find((l) => l.mark.kind === "tick")!.mark.stroke.d;
const RING = BOARD_LINES.find((l) => l.mark.kind === "ring")!.mark.stroke.d;

function box(d: string, pad: number): string {
  const b = pathBounds(d);
  return `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
}

function drawAttrs(draw: string | undefined) {
  return draw ? { [INK_DRAW_ATTR]: draw } : {};
}

function timing(draw: string | undefined, atMs: number, forMs: number): CSSProperties | undefined {
  return draw ? ({ "--at": `${atMs}ms`, "--for": `${forMs}ms` } as CSSProperties) : undefined;
}

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/**
 * A mark stretched over words of any size: the stroke keeps an even width however it is stretched
 * (non-scaling), and it draws through a mask of the same path, because a dashed non-scaling stroke
 * draws wrongly in Chrome and Safari (measured 2026-10-12).
 */
function StretchedMark({ kind, d, viewBox, maskWidth, ink, draw, atMs, forMs, pen }: { kind: "circle" | "underline"; d: string; viewBox: string; maskWidth: number } & Required<Pick<DrawProps, "ink" | "atMs" | "forMs" | "pen">> & Pick<DrawProps, "draw">) {
  const [x, y, w, h] = viewBox.split(" ").map(Number);
  const maskId = draw ? `lp-mask-${draw}` : undefined;
  return (
    <svg className={cls(styles.mark, styles[ink], draw && styles.draw)} data-kind={kind} viewBox={viewBox} preserveAspectRatio="none" aria-hidden {...drawAttrs(draw)}>
      {maskId && (
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x={x - maskWidth} y={y - maskWidth} width={w + 2 * maskWidth} height={h + 2 * maskWidth}>
            <path d={d} pathLength={1} stroke="#fff" strokeWidth={maskWidth} style={timing(draw, atMs, forMs)} />
          </mask>
        </defs>
      )}
      <path className={styles.masked} d={d} strokeWidth={pen} vectorEffect="non-scaling-stroke" mask={maskId ? `url(#${maskId})` : undefined} />
    </svg>
  );
}

/** Words the tutor circled (the ring a live tutor drew round a slip). It stretches to the words. */
export function InkCircle({ children, ink = "tutor", draw, atMs = 0, forMs = 620, pen = 3, className }: DrawProps & { children: ReactNode }) {
  return (
    <span className={cls(styles.marked, className)}>
      {children}
      <StretchedMark kind="circle" d={RING} viewBox={box(RING, 2)} maskWidth={14} ink={ink} draw={draw} atMs={atMs} forMs={forMs} pen={pen} />
    </span>
  );
}

/** Words the tutor underlined. */
export function InkUnderline({ children, ink = "tutor", draw, atMs = 0, forMs = 380, pen = 3, seed = 7, className }: DrawProps & { children: ReactNode; seed?: number }) {
  const line = composeUnderline(100, seed);
  const d = polylineToSvgD(line.segments[0].points);
  return (
    <span className={cls(styles.marked, className)}>
      {children}
      <StretchedMark kind="underline" d={d} viewBox={`-1 -1 ${line.width + 2} ${line.height + 2}`} maskWidth={12} ink={ink} draw={draw} atMs={atMs} forMs={forMs} pen={pen} />
    </span>
  );
}

/** The tutor's check mark, 0.78em square, after a word or on its own. */
export function InkCheck({ ink = "tutor", draw, atMs = 0, forMs = 260, pen, className, label }: DrawProps & { label?: string }) {
  const b = pathBounds(TICK);
  // the tutor's pen on the board, in the tick's own units (it is drawn at the board's scale)
  const width = pen ?? Math.max(b.maxX - b.minX, b.maxY - b.minY) / 9;
  return (
    <svg
      className={cls(styles.check, styles[ink], draw && styles.draw, className)}
      viewBox={box(TICK, width)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      {...drawAttrs(draw)}
    >
      <path d={TICK} pathLength={1} strokeWidth={width} style={timing(draw, atMs, forMs)} />
    </svg>
  );
}

/** The tutor's arrow, `length` px long, pointing right; rotate it with CSS to point elsewhere. */
export function InkArrow({ ink = "tutor", draw, atMs = 0, forMs = 520, pen = 3, length = 96, seed = 11, className }: DrawProps & { length?: number; seed?: number }) {
  const arrow = composeArrow(length, 16, seed);
  const pad = pen;
  return (
    <svg
      className={cls(styles.arrow, styles[ink], draw && styles.draw, className)}
      viewBox={`${-pad} ${-pad} ${arrow.width + 2 * pad} ${arrow.height + 2 * pad}`}
      width={arrow.width + 2 * pad}
      height={arrow.height + 2 * pad}
      aria-hidden
      {...drawAttrs(draw)}
    >
      {arrow.segments.map((segment, i) => (
        <path
          key={i}
          d={polylineToSvgD(segment.points)}
          pathLength={1}
          strokeWidth={pen}
          // the shaft, then the head
          style={timing(draw, atMs + (i === 0 ? 0 : Math.round(forMs * 0.7)), i === 0 ? Math.round(forMs * 0.7) : Math.round(forMs * 0.3))}
        />
      ))}
    </svg>
  );
}
