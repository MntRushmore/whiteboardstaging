"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { markStrokes } from "@/lib/live/marks";
import type { StartInkLine, StartInkSet } from "@/lib/start/inkSet";
import styles from "./start.module.css";

/**
 * The small pieces every /start screen shares: the tutor's check (the board's own mark,
 * `markStrokes`, drawn in its blue pen), a line in the board's hand from the ink set, and the ink
 * set itself (`GET /api/start/ink`, fetched once).
 */

// ------------------------------------------------------------------ the tutor's check

const round = (n: number) => Math.round(n * 10) / 10;

/** The board's check mark as one smooth SVG path in a box of its own; the seed varies the hand. */
function checkPath(seed: number): { d: string; viewBox: string } {
  const [stroke] = markStrokes("check", { x: 0, y: 0, w: 0, h: 40 }, seed);
  const pts = stroke?.points ?? [];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;
  const p = pts.map((q) => ({ x: round(q.x - minX), y: round(q.y - minY) }));
  // through the midpoints, so the pen turns round at the bottom instead of in a corner
  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 1; i < p.length - 1; i += 1) {
    const mx = round((p[i].x + p[i + 1].x) / 2);
    const my = round((p[i].y + p[i + 1].y) / 2);
    d += ` Q ${p[i].x} ${p[i].y} ${mx} ${my}`;
  }
  const last = p[p.length - 1];
  d += ` L ${last.x} ${last.y}`;
  const pad = 4;
  return { d, viewBox: `${-pad} ${-pad} ${round(w + 2 * pad)} ${round(h + 2 * pad)}` };
}

export interface TutorCheckProps {
  seed?: number;
  /** draw it in (from pen-down), `atMs` after it mounts */
  draw?: boolean;
  atMs?: number;
  forMs?: number;
  className?: string;
  label?: string;
}

/** The tutor's check mark, in its blue pen; it draws itself in when it mounts. */
export function TutorCheck({ seed = 7, draw = true, atMs = 0, forMs = 300, className, label }: TutorCheckProps) {
  const { d, viewBox } = checkPath(seed);
  return (
    <svg className={[styles.check, draw ? styles.draw : "", className].filter(Boolean).join(" ")} viewBox={viewBox} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })} focusable="false">
      <path d={d} pathLength={1} strokeWidth={4.2} style={{ "--at": `${atMs}ms`, "--for": `${forMs}ms` } as CSSProperties} />
    </svg>
  );
}

// ------------------------------------------------------------------ the board's hand

export interface HandLineProps {
  line: StartInkLine;
  /** the pen's width at the set's size */
  pen?: number;
  draw?: boolean;
  /** ms before the first stroke */
  atMs?: number;
  /** >1 writes faster */
  speed?: number;
  className?: string;
  style?: CSSProperties;
}

/** A line in the board's hand (from the ink set), in the tutor's blue; decorative. */
export function HandLine({ line, pen = 4.2, draw = false, atMs = 0, speed = 1, className, style }: HandLineProps) {
  const pad = pen;
  const w = round(line.width + 2 * pad);
  const h = round(line.height + 2 * pad);
  return (
    <svg className={[styles.hand, draw ? styles.draw : "", className].filter(Boolean).join(" ")} viewBox={`${-pad} ${-pad} ${w} ${h}`} width={w} height={h} style={style} aria-hidden focusable="false">
      {line.strokes.map((s, i) => (
        <path key={i} d={s.d} pathLength={1} strokeWidth={round(pen * s.w)} style={draw ? ({ "--at": `${Math.round(atMs + s.at / speed)}ms`, "--for": `${Math.round(s.for / speed)}ms` } as CSSProperties) : undefined} />
      ))}
    </svg>
  );
}

/** A skill's example (one or two lines) in the tutor's hand, `height` CSS px a line. */
export function SkillExample({ lines, height = 28, draw = false, atMs = 0 }: { lines: readonly StartInkLine[]; height?: number; draw?: boolean; atMs?: number }) {
  // each line starts once the one above is written
  const starts = lines.map((_, i) => lines.slice(0, i).reduce((ms, l) => ms + l.durationMs / 1.6 + 120, atMs));
  return (
    <span className={styles.example} aria-hidden>
      {lines.map((line, i) => {
        const at = starts[i];
        // `height` is a plain line's; a fraction or a power stands taller, at the same hand size
        const scale = height / START_INK_LINE;
        const tall = Math.min(line.height, START_INK_LINE * MAX_LINE_RATIO);
        return <HandLine key={i} line={line} draw={draw} atMs={at} speed={1.6} style={{ "--h": `${Math.round(tall * scale)}px` } as CSSProperties} />;
      })}
    </span>
  );
}

// ------------------------------------------------------------------ the ink set

const INK_URL = "/api/start/ink";
/** How tall a plain line of the set is (written at size 60, a line of digits is about 37 px). */
const START_INK_LINE = 37;
/** A fraction or a power stands taller; on a card it may be at most this many plain lines tall. */
const MAX_LINE_RATIO = 1.7;
let inkPromise: Promise<StartInkSet | null> | null = null;
let inkValue: StartInkSet | null = null;

/** Fetch the ink set once (later calls share it); null when it would not load. */
export function loadStartInk(): Promise<StartInkSet | null> {
  if (!inkPromise) {
    inkPromise = fetch(INK_URL)
      .then((res) => (res.ok ? (res.json() as Promise<StartInkSet>) : null))
      .then((set) => {
        inkValue = set && typeof set === "object" && set.skills && set.problems ? set : null;
        if (!inkValue) inkPromise = null;
        return inkValue;
      })
      .catch(() => {
        inkPromise = null;
        return null;
      });
  }
  return inkPromise;
}

/** The ink set once `load` is true (and from then on); null until it has loaded. */
export function useStartInk(load: boolean): StartInkSet | null {
  const [set, setSet] = useState<StartInkSet | null>(inkValue);
  useEffect(() => {
    if (!load || set) return;
    let live = true;
    void loadStartInk().then((value) => {
      if (live && value) setSet(value);
    });
    return () => {
      live = false;
    };
  }, [load, set]);
  return set;
}
