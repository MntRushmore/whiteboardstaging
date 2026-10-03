"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor, TLRecord, TLShapeId } from "tldraw";
import { Flame } from "lucide-react";
import { markKindOf } from "@/lib/onboarding/state";
import { celebrate, INITIAL_CELEBRATE, MarkSettler, STREAK_FROM, streakText, type Cheer } from "@/lib/live/celebrate";
import { cn } from "@/lib/utils";

/**
 * Cheers on the board: when the tutor ticks a student's line, a word of praise pops up beside
 * the tick with a burst of confetti (a bigger one on a 5, 10… streak), and from three in a row it
 * counts the streak. A ring gets a kind word instead. What to say is `celebrate`'s call; this
 * layer only watches the tutor's marks land and draws the result. Motion honours
 * prefers-reduced-motion (globals.css): the words still show, the confetti does not.
 */

/** A finished stroke of the student's own (not the tutor's hand). */
function isFinishedStudentStroke(rec: TLRecord): boolean {
  if (rec.typeName !== "shape" || rec.type !== "draw") return false;
  return (rec.props as { isComplete?: boolean }).isComplete === true && (rec.meta as Record<string, unknown>).live !== true;
}

/** how long a cheer stays up (matches the `celebrate-pop` animation) */
const SHOW_MS = 2200;
const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#facc15"];
/** keep the bubble this far inside the window */
const EDGE = 12;
const BUBBLE_W = 200;

interface Piece {
  dx: number;
  dy: number;
  rot: number;
  color: string;
  delay: number;
  round: boolean;
}

interface Pop {
  id: number;
  cheer: Cheer;
  /** the mark's right edge, middle, in client pixels */
  x: number;
  y: number;
  pieces: Piece[];
}

function confetti(count: number, spread: number): Piece[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const dist = spread * (0.5 + Math.random() * 0.6);
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - spread * 0.35,
      rot: (Math.random() - 0.5) * 720,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 80,
      round: i % 3 === 0,
    };
  });
}

/** The tutor's mark for this line on the page, as a client-pixel point (its right edge, middle). */
function markPoint(editor: Editor, lineId: string, fallback: TLShapeId): { x: number; y: number } | null {
  let minY = Infinity;
  let maxY = -Infinity;
  let maxX = -Infinity;
  for (const s of editor.getCurrentPageShapes()) {
    const meta = s.meta as Record<string, unknown>;
    if (meta.lineId !== lineId || !markKindOf(meta)) continue;
    const b = editor.getShapePageBounds(s);
    if (!b) continue;
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
    maxX = Math.max(maxX, b.maxX);
  }
  if (!Number.isFinite(maxX)) {
    const b = editor.getShapePageBounds(fallback);
    if (!b) return null;
    minY = b.minY;
    maxY = b.maxY;
    maxX = b.maxX;
  }
  const p = editor.pageToScreen({ x: maxX, y: (minY + maxY) / 2 });
  const v = editor.getViewportScreenBounds();
  return {
    x: Math.min(Math.max(p.x, v.x + EDGE), v.x + v.w - BUBBLE_W - EDGE),
    y: Math.min(Math.max(p.y, v.y + 48), v.y + v.h - 48),
  };
}

export function Celebrations({ editor }: { editor: Editor }) {
  const [pops, setPops] = useState<Pop[]>([]);
  const [said, setSaid] = useState("");
  const state = useRef(INITIAL_CELEBRATE);
  const seq = useRef(0);

  useEffect(() => {
    const clearing = new Set<ReturnType<typeof setTimeout>>();
    // which mark shape each line's cheer is drawn beside, if its own are gone by then
    const lastMark = new Map<string, TLShapeId>();
    // a tick counts after a moment, a ring only once the line has stopped changing (`MarkSettler`)
    const settler = new MarkSettler((lineId, kind) => {
      const { state: next, cheer } = celebrate(state.current, lineId, kind);
      state.current = next;
      const fallback = lastMark.get(lineId);
      if (!cheer || !fallback) return;
      const at = markPoint(editor, lineId, fallback);
      if (!at) return;
      const id = ++seq.current;
      const pieces = cheer.tone === "win" ? (cheer.burst === "big" ? confetti(36, 110) : confetti(16, 64)) : [];
      setPops((all) => [...all.slice(-2), { id, cheer, ...at, pieces }]);
      setSaid(cheer.tone === "win" && cheer.streak >= STREAK_FROM ? `${cheer.text} ${streakText(cheer.streak)}` : cheer.text);
      const done = setTimeout(() => {
        clearing.delete(done);
        setPops((all) => all.filter((p) => p.id !== id));
      }, SHOW_MS);
      clearing.add(done);
    });
    const verdict = (rec: TLRecord) => {
      if (rec.typeName !== "shape") return null;
      const kind = markKindOf(rec.meta);
      const meta = rec.meta as Record<string, unknown>;
      if ((kind !== "check" && kind !== "circle") || typeof meta.lineId !== "string") return null;
      return { kind, lineId: meta.lineId, mark: String(meta.mark) };
    };
    /** the student finished a stroke: a ring waiting on the line it extends does not count */
    const studentInk = (rec: TLRecord) => {
      const b = editor.getShapePageBounds(rec.id as TLShapeId);
      if (b) settler.ink({ x: b.x, y: b.y, w: b.w, h: b.h });
    };
    const off = editor.store.listen(
      ({ changes }) => {
        for (const rec of Object.values(changes.added)) {
          const v = verdict(rec);
          if (v) {
            lastMark.set(v.lineId, rec.id as TLShapeId);
            settler.mark(v.lineId, v.kind, v.mark);
          } else if (isFinishedStudentStroke(rec)) studentInk(rec);
        }
        for (const [from, to] of Object.values(changes.updated)) {
          if (isFinishedStudentStroke(to) && !isFinishedStudentStroke(from)) studentInk(to);
        }
        for (const rec of Object.values(changes.removed)) {
          const v = verdict(rec);
          if (v) settler.markRemoved(v.lineId, v.kind);
        }
      },
      { scope: "document", source: "all" },
    );
    return () => {
      off();
      settler.dispose();
      clearing.forEach((t) => clearTimeout(t));
    };
  }, [editor]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {said}
      </div>
      {pops.map((pop) => (
        <div
          key={pop.id}
          aria-hidden
          data-celebration={pop.cheer.tone}
          className="pointer-events-none fixed z-1180"
          style={{ left: pop.x, top: pop.y }}
        >
          {pop.pieces.map((p, i) => (
            <span
              key={i}
              className={cn("celebrate-confetti absolute left-0 top-0 block h-2 w-1.5", p.round && "size-2 rounded-full")}
              style={
                {
                  backgroundColor: p.color,
                  animationDelay: `${p.delay}ms`,
                  "--dx": `${p.dx}px`,
                  "--dy": `${p.dy}px`,
                  "--rot": `${p.rot}deg`,
                } as React.CSSProperties
              }
            />
          ))}
          <div
            className={cn(
              "celebrate-pop absolute top-0 left-3 -translate-y-1/2 whitespace-nowrap rounded-2xl px-3.5 py-1.5 shadow-lg",
              pop.cheer.tone === "win"
                ? "bg-emerald-500 text-base font-bold text-white"
                : "w-max max-w-56 whitespace-normal border border-amber-200 bg-amber-50 text-sm font-medium text-amber-900",
            )}
          >
            {pop.cheer.text}
            {pop.cheer.tone === "win" && pop.cheer.streak >= STREAK_FROM && (
              <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-emerald-50">
                <Flame className="size-3.5 text-amber-300" aria-hidden />
                {streakText(pop.cheer.streak)}
              </span>
            )}
          </div>
        </div>
      ))}
    </>,
    document.body,
  );
}
