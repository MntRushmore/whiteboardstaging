"use client";

import { useEffect } from "react";
import { learningBus } from "@/lib/learning/bus";
import { whenIdle } from "@/lib/whenIdle";

/**
 * The board's learning record (`src/lib/learning`): once the board is up, in idle time, the runtime
 * that turns what the board says (`learningBus`) into the student's attempts is loaded and started
 * (`boardLearning.ts`, a dynamic import: none of it is in the board's first load — this hook and the
 * bus are). What the board says before then waits on the bus. Stopped (and saved) on unmount.
 */
export function useBoardLearning(boardId: string, userId: string | undefined): void {
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    const load = () => {
      import("@/lib/learning/boardLearning")
        .then((m) => {
          if (!cancelled) stop = m.startBoardLearning({ boardId, userId }).stop;
        })
        .catch((err: unknown) => console.warn("[learning] the board's learning record did not load", err));
    };
    const cancelIdle = whenIdle(load);
    return () => {
      cancelled = true;
      cancelIdle();
      stop?.();
      // what this board said that no runtime heard (left before one started) is not the next board's
      learningBus.reset();
    };
  }, [boardId, userId]);
}
