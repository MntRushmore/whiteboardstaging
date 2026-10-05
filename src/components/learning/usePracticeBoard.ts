"use client";

import { useEffect, useRef } from "react";
import type { ChatRunOrigin } from "@/lib/learning/contracts";
import { clearPracticeMarker, readPracticeMarker, type StorageLike } from "@/lib/learning/practiceMarker";
import type { ChatAction, ChatRunReport, ChatScreen } from "@/lib/live/chat/contracts";
import type { LiveController } from "@/lib/live/contracts";
import { reportUserError } from "@/lib/reportAppError";

/**
 * A practice board (the Progress page's Practice button, `practiceMarker.ts`): the page made the
 * board, left a marker naming the skill and its problems, and opened it. Here the board reads the
 * marker once, clears it, and has the tutor write the problems through the chat's executor (the
 * engine checks each, the tutor's hand writes them; no model, no ink), tagged `practice` for the
 * learning record.
 *
 * A reload never writes them twice: the marker is cleared BEFORE the problems are written, a board
 * already started this visit is not started again (React's development double effects, a remount),
 * and problems already on the screen are left out.
 */

export const PRACTICE_COPY = {
  /** a toast as the tutor starts writing */
  start: (skill: string | null) => (skill ? `Let's practise ${skill}!` : "Let's practise!"),
  failed: "Couldn't write the practice problems. Try again from your Progress page.",
} as const;

/** Tries at the board's controller before giving up (it is there by the time this runs; a margin). */
const RUN_TRIES = 4;
const RUN_RETRY_MS = 500;

/** Boards whose practice has started in this tab. */
const started = new Set<string>();

export type PracticeRunResult = "none" | "already" | "written" | "failed";

export interface PracticeRunDeps {
  boardId: string;
  /** the board's controller's `runChatActions` */
  run: (actions: readonly ChatAction[], from: ChatRunOrigin) => Promise<ChatRunReport>;
  /** what is on the current screen (problems already written are left out) */
  screen?: () => ChatScreen;
  /** the skill's name for the toast (`skillDef(id)?.name`) */
  skillName: (skill: string) => string | null;
  toast: (text: string) => void;
  /** once the problems are about to be written: help mode and pen for practice */
  prepare?: () => void;
  metric?: (name: string, fields: Record<string, unknown>) => void;
  /** the failure toast was shown: tell the admin page (`live.practice`, src/lib/reportAppError.ts) */
  reportFailure?: (code: "none_written" | "board_not_ready", message: string) => void;
  storage?: StorageLike | null;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Reads this board's practice marker and writes its problems, once. */
export async function runPracticeMarker(deps: PracticeRunDeps): Promise<PracticeRunResult> {
  const { boardId } = deps;
  if (started.has(boardId)) return "already";
  const storage = deps.storage;
  const marker = readPracticeMarker(boardId, (deps.now ?? Date.now)(), storage);
  if (!marker) return "none";
  started.add(boardId);
  // first: a reload from here on finds no marker, whatever happens to the writing
  clearPracticeMarker(boardId, storage);

  const onScreen = new Set(deps.screen?.().problems ?? []);
  const problems = marker.problems.filter((p) => !onScreen.has(p.join("; "))).map((p) => [...p]);
  if (problems.length === 0) return "already";

  deps.prepare?.();
  deps.toast(PRACTICE_COPY.start(deps.skillName(marker.skill)));
  const wait = deps.wait ?? sleep;
  for (let i = 1; ; i++) {
    try {
      const report = await deps.run([{ type: "write_problems", problems }], { origin: "practice" });
      deps.metric?.("learning.practice.board", { skill: marker.skill, written: report.problemsWritten, dropped: report.problemsDropped });
      if (report.problemsWritten > 0) return "written";
      deps.toast(PRACTICE_COPY.failed);
      deps.reportFailure?.("none_written", PRACTICE_COPY.failed);
      return "failed";
    } catch (e) {
      // only "the board is not ready yet" throws before anything is written
      if (i >= RUN_TRIES) {
        deps.metric?.("learning.practice.board.failed", { skill: marker.skill, error: e instanceof Error ? e.message : String(e) });
        deps.toast(PRACTICE_COPY.failed);
        deps.reportFailure?.("board_not_ready", PRACTICE_COPY.failed);
        return "failed";
      }
      await wait(RUN_RETRY_MS * i);
    }
  }
}

/** Forget the boards started in this tab (tests). */
export function resetPracticeBoards(): void {
  started.clear();
}

/** Runs this board's practice marker once the board (editor and controller) is up. */
export function usePracticeBoard(
  boardId: string,
  controller: LiveController,
  deps: Pick<PracticeRunDeps, "skillName" | "toast" | "prepare" | "metric">,
): void {
  // the caller's callbacks, read when it runs: the run itself happens once per board
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });
  useEffect(() => {
    if (!controller.runChatActions) return;
    const d = depsRef.current;
    void runPracticeMarker({
      boardId,
      skillName: (skill) => depsRef.current.skillName(skill),
      toast: (text) => depsRef.current.toast(text),
      prepare: d.prepare ? () => depsRef.current.prepare?.() : undefined,
      metric: (name, fields) => depsRef.current.metric?.(name, fields),
      reportFailure: (code, message) => reportUserError({ kind: "live.practice", code, message, boardId }),
      run: (actions, from) => controller.runChatActions!(actions, from),
      screen: controller.chatScreen ? () => controller.chatScreen!() : undefined,
    });
  }, [boardId, controller]);
}
