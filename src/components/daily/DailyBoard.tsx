"use client";

import type { LiveController } from "@/lib/live/contracts";

/**
 * A Today's practice board's progress and celebration (src/lib/daily/contracts.ts): loaded with a
 * dynamic import, only on a board with a daily marker (`hasDailyMarker`, read synchronously by the
 * board page).
 *
 * SLOT (contract 2026-10-09): the daily-practice agent fills this in (feat/kcb-daily).
 */

export interface DailyBoardProps {
  boardId: string;
  userId: string;
  controller: LiveController;
}

export default function DailyBoard(_props: DailyBoardProps) {
  return null;
}
