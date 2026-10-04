"use client";

import { useEffect } from "react";

/** How long the board waits for an idle moment before loading the learning runtime anyway. */
const IDLE_TIMEOUT_MS = 4_000;
/** Without `requestIdleCallback` (Safari): this long after the board is up. */
const FALLBACK_DELAY_MS = 1_500;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * The board's learning record (`src/lib/learning`): once the board is up, in idle time, the runtime
 * that turns what the board says (`learningBus`) into the student's attempts is loaded and started
 * (`boardLearning.ts`, a dynamic import: none of it is in the board's first load — this hook and the
 * bus are). What the board says before then waits on the bus. Stopped (and saved) on unmount.
 */
export function useBoardLearning(boardId: string, userId: string | undefined): void {
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    const w = window as IdleWindow;
    let cancelled = false;
    let stop: (() => void) | null = null;
    const load = () => {
      import("@/lib/learning/boardLearning")
        .then((m) => {
          if (!cancelled) stop = m.startBoardLearning({ boardId, userId }).stop;
        })
        .catch((err: unknown) => console.warn("[learning] the board's learning record did not load", err));
    };
    const idle = typeof w.requestIdleCallback === "function" ? w.requestIdleCallback(load, { timeout: IDLE_TIMEOUT_MS }) : null;
    const timer = idle === null ? setTimeout(load, FALLBACK_DELAY_MS) : null;
    return () => {
      cancelled = true;
      if (idle !== null) w.cancelIdleCallback?.(idle);
      if (timer !== null) clearTimeout(timer);
      stop?.();
    };
  }, [boardId, userId]);
}
