"use client";

import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { formatClock } from "@/lib/replay/format";
import type { ReplayPlayer } from "./player";
import styles from "./replay.module.css";

export interface ScrubberMarker {
  /** on the replay's clock */
  at: number;
  kind: "check" | "circle" | "question" | "error" | "warn";
  label?: string;
}

/**
 * The replay's position as a track to drag or tap (a slider: ←/→, Home/End move it, handled by
 * the player's region), with the tutor's ticks and rings above it and the board's errors below.
 * Dragging pauses the replay and plays on when let go.
 */
export function Scrubber({
  player,
  ms,
  durationMs,
  markers,
  size = "md",
  label,
}: {
  player: ReplayPlayer;
  ms: number;
  durationMs: number;
  markers: readonly ScrubberMarker[];
  size?: "md" | "lg";
  label: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const resume = useRef(false);
  const at = (e: ReactPointerEvent) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return 0;
    return (Math.min(box.width, Math.max(0, e.clientX - box.left)) / box.width) * durationMs;
  };
  const share = durationMs > 0 ? Math.min(1, ms / durationMs) : 0;

  return (
    <div
      ref={track}
      className={styles.scrubber}
      data-size={size}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(ms / 1000)}
      aria-valuetext={`${formatClock(ms)} of ${formatClock(durationMs)}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || durationMs <= 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        resume.current = player.getState().playing;
        player.pause();
        player.seek(at(e));
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) player.seek(at(e));
      }}
      onPointerUp={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (resume.current && player.getState().ms < durationMs) player.play();
      }}
      onPointerCancel={() => {
        if (resume.current) player.play();
      }}
    >
      <div className={styles.scrubTrack}>
        <div className={styles.scrubFill} style={{ width: `${share * 100}%` }} />
      </div>
      {durationMs > 0 &&
        markers.map((m, i) => (
          <span
            key={`${m.kind}-${i}`}
            aria-hidden
            title={m.label}
            className={styles.marker}
            data-kind={m.kind}
            style={{ "--at": `${Math.min(100, Math.max(0, (m.at / durationMs) * 100))}%` } as CSSProperties}
          />
        ))}
      <span aria-hidden className={styles.scrubThumb} style={{ left: `${share * 100}%` }} />
    </div>
  );
}
