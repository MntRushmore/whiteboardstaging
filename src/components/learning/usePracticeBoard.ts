"use client";

import { useEffect, useRef } from "react";
import type { ChatRunOrigin } from "@/lib/learning/contracts";
import { clearPracticeMarker, hasPracticeMarker, readPracticeMarker, type StorageLike } from "@/lib/learning/practiceMarker";
import type { ChatAction, ChatRunReport, ChatScreen } from "@/lib/live/chat/contracts";
import type { LiveController } from "@/lib/live/contracts";
import type { LoopReadiness } from "@/lib/live/loopGate";
import { reportUserError } from "@/lib/reportAppError";

/**
 * A practice board (the Progress page's Practice button, `practiceMarker.ts`): the page made the
 * board, left a marker naming the skill and its problems, and opened it. Here the board reads the
 * marker once, clears it, and has the tutor write the problems through the chat's executor (the
 * engine checks each, the tutor's hand writes them; no model, no ink), tagged `practice` for the
 * learning record.
 *
 * A topic (the home's or the board's topic picker) is a practice set with worked-example candidates:
 * the tutor first writes one as problem 1 and works it under it ("Watch me do one" — the same
 * local engine Solve uses, so still no model and no ink; `topicExample.ts` picks one the engine
 * answers on the device, and with none the example is left out), recorded as a problem the tutor
 * taught (`teach`). A moment to look at it, then the problems go on a fresh screen ("Now you try",
 * the chat's executor moves on from a screen with work on it), tagged `practice`.
 *
 * A reload never writes them twice: the marker is cleared BEFORE the problems are written, a board
 * already started this visit is not started again (React's development double effects, a remount),
 * and problems already on the screen are left out.
 *
 * A run outlives the render that started it (the example, the look at it, the problems), and the
 * kid can leave at any point of it. Every run waits on the board's own readiness first
 * (`LiveController.whenReady`, event-driven, with a ceiling) rather than sleeping and guessing, and
 * a run whose board has gone stops without a toast or a report ("abandoned"). Before, it went on
 * against the closed board's controller: on 2026-10-12 a kid left a topic board during the look at
 * its example, and the home page said "Now you try!", then "Couldn't write the problems for that
 * topic" (reported as live.practice `board_not_ready` from "/").
 */

export const PRACTICE_COPY = {
  /** a toast as the tutor starts writing */
  start: (skill: string | null) => (skill ? `Let's practise ${skill}!` : "Let's practise!"),
  failed: "Couldn't write the practice problems. Try again from your Progress page.",
  /** a topic: as the tutor starts the worked example */
  watch: (skill: string | null) => (skill ? `${skill}: watch me do one!` : "Watch me do one!"),
  /** a topic: as the problems go on after it */
  yourTurn: "Now you try! Work each one out under it.",
  topicFailed: "Couldn't write the problems for that topic. Try picking it again.",
} as const;

/**
 * How long a run waits for the board's loop to come up before it says so. It is up in well under a
 * second, even on an old iPad (it is made as the board mounts): this is only the ceiling.
 */
export const BOARD_READY_MS = 15_000;
/** Tries at a run that throws on a board that is up (a chunk that did not load: the engine is fetched again). */
const RUN_TRIES = 4;
const RUN_RETRY_MS = 500;
/** After the worked example, before the problems: a moment to look at it (the screen changes next). */
export const TOPIC_PAUSE_MS = 4000;

/** Boards whose practice has started in this tab. */
const started = new Set<string>();
/** Boards whose practice problems are being written in this tab, and who waits for that to end. */
const writing = new Set<string>();
const runEndListeners = new Set<(boardId: string) => void>();

/**
 * True while this board's practice problems are still to be written in this tab: its marker is
 * there (the run has not started) or the run is writing. A Today's practice board (`DailyBoard`)
 * waits for this before it decides its set came up short.
 */
export function practicePending(boardId: string, storage?: StorageLike | null): boolean {
  return writing.has(boardId) || hasPracticeMarker(boardId, storage);
}

/** Called with the board's id each time a practice run ends in this tab (written or not). */
export function onPracticeRunEnd(fn: (boardId: string) => void): () => void {
  runEndListeners.add(fn);
  return () => {
    runEndListeners.delete(fn);
  };
}

/** "abandoned": the board went away under the run (the kid left), so nothing more was said or written. */
export type PracticeRunResult = "none" | "already" | "written" | "failed" | "abandoned";

/** What one practice or topic set writes. */
export interface PracticeSetInput {
  skill: string;
  problems: string[][];
  /** a topic: worked-example candidates, easiest first */
  examples?: string[][];
}

export interface PracticeSetDeps {
  /** the board's controller's `runChatActions` */
  run: (actions: readonly ChatAction[], from: ChatRunOrigin) => Promise<ChatRunReport>;
  /** the skill's name for the toast (`skillDef(id)?.name`) */
  skillName: (skill: string) => string | null;
  toast: (text: string) => void;
  /** once the problems are about to be written: help mode and pen for practice */
  prepare?: () => void;
  /** after each block is written: the screen it went on named for the skill */
  nameScreen?: (skill: string) => void;
  /** a topic's worked example: the first candidate the engine works out on the device, or null (`topicExample.ts`) */
  pickExample?: (candidates: readonly string[][]) => Promise<string[] | null>;
  metric?: (name: string, fields: Record<string, unknown>) => void;
  /**
   * The failure toast was shown: tell the admin page (`live.practice`, src/lib/reportAppError.ts).
   * `none_written`: the engine kept none; `board_not_ready`: the board's loop never came up within
   * `BOARD_READY_MS`; `run_failed`: the run kept throwing on a board that was up.
   */
  reportFailure?: (code: PracticeFailure, message: string) => void;
  /** the board's loop for this board (`LiveController.whenReady`): every run waits on it */
  whenReady?: (timeoutMs: number) => Promise<LoopReadiness>;
  /** the board has gone (`LiveController.boardClosed`: the kid left, it unmounted): the run ends quietly */
  gone?: () => boolean;
  wait?: (ms: number) => Promise<void>;
}

export type PracticeFailure = "none_written" | "board_not_ready" | "run_failed";

/** A run's readiness and leaving, from the board's controller (`whenReady`, `boardClosed`), for `boardId`. */
export function boardLifeDeps(boardId: string, controller: Pick<LiveController, "whenReady" | "boardClosed">): Pick<PracticeSetDeps, "whenReady" | "gone"> {
  return {
    whenReady: controller.whenReady ? (ms) => controller.whenReady!(boardId, ms) : undefined,
    gone: controller.boardClosed ? () => controller.boardClosed!(boardId) : undefined,
  };
}

/** What the board page gives a practice or topic run (`practiceDeps` in PracticeBoard.tsx). */
export type BoardPracticeDeps = Pick<PracticeSetDeps, "skillName" | "toast" | "prepare" | "nameScreen" | "metric" | "pickExample">;

export interface PracticeRunDeps extends PracticeSetDeps {
  boardId: string;
  /** what is on the current screen (problems already written are left out) */
  screen?: () => ChatScreen;
  storage?: StorageLike | null;
  now?: () => number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The board went away under the run (the kid left, it unmounted): it ends without a word. */
class BoardGone extends Error {}
/** The board's loop did not come up within `BOARD_READY_MS`. */
class BoardNotReady extends Error {}

/**
 * Waits for the board's loop (`deps.whenReady`: resolves the moment it is up, no polling). Throws
 * `BoardGone` once the board has gone, `BoardNotReady` past the ceiling. A run without the gate
 * (a test double) goes straight on.
 */
async function boardUp(deps: PracticeSetDeps): Promise<void> {
  const state = deps.whenReady ? await deps.whenReady(BOARD_READY_MS) : "ready";
  if (state === "closed" || deps.gone?.()) throw new BoardGone();
  if (state === "timeout") throw new BoardNotReady("The board is not ready yet.");
}

/**
 * `run` on a board that is up, tried again while it throws (a chunk that did not load), each try
 * on the board up again — and never once the board has gone: a run cut short by the kid leaving
 * throws as the loop stops, and that is not a failure.
 */
async function runWhenReady(deps: PracticeSetDeps, actions: readonly ChatAction[], from: ChatRunOrigin): Promise<ChatRunReport> {
  const wait = deps.wait ?? sleep;
  for (let i = 1; ; i++) {
    await boardUp(deps);
    try {
      return await deps.run(actions, from);
    } catch (e) {
      if (deps.gone?.()) throw new BoardGone();
      if (i >= RUN_TRIES) throw e;
      await wait(RUN_RETRY_MS * i);
    }
  }
}

const NEW_SCREEN: readonly ChatAction[] = [{ type: "new_screen" }];

/**
 * The worked example, written and worked under it; true when it is on the board. A failure to
 * write it leaves it out (the problems still go on); throws only when the board has gone or never
 * came up (`boardUp`), which ends the whole set.
 */
async function writeExample(set: PracticeSetInput, deps: PracticeSetDeps, newScreen: boolean): Promise<boolean> {
  if (!set.examples?.length || !deps.pickExample) return false;
  let example: string[] | null = null;
  try {
    example = await deps.pickExample(set.examples);
  } catch {
    example = null;
  }
  deps.metric?.("learning.topic.example", { skill: set.skill, local: Boolean(example) });
  if (!example) return false;
  // the board up, and still there, before its toast: never "watch me do one!" over the home page
  await boardUp(deps);
  deps.toast(PRACTICE_COPY.watch(deps.skillName(set.skill)));
  try {
    const report = await runWhenReady(
      deps,
      [
        ...(newScreen ? NEW_SCREEN : []),
        { type: "write_problems", problems: [example] },
        { type: "help_problem", problem: 1, depth: "solve" },
      ],
      { origin: "teach" },
    );
    if (report.problemsWritten === 0) return false;
    deps.nameScreen?.(set.skill);
    return true;
  } catch (e) {
    if (e instanceof BoardGone || e instanceof BoardNotReady) throw e;
    return false;
  }
}

export interface PracticeSetOptions {
  /** start on a new screen (the board's New topic, over a screen with work on it): the chat's own `new_screen` */
  newScreen?: boolean;
}

/**
 * Writes a practice set: a topic's worked example first (when it has one the engine works out),
 * then the problems. "written" when any problem was written; "abandoned", without a word, when the
 * board went away under it (the kid left — during the look at the example, say); else a quiet
 * toast and "failed".
 */
export async function writePracticeSet(set: PracticeSetInput, deps: PracticeSetDeps, opts: PracticeSetOptions = {}): Promise<"written" | "failed" | "abandoned"> {
  const topic = Boolean(set.examples?.length);
  const failedCopy = topic ? PRACTICE_COPY.topicFailed : PRACTICE_COPY.failed;
  const fail = (code: PracticeFailure): "failed" => {
    deps.toast(failedCopy);
    deps.reportFailure?.(code, failedCopy);
    return "failed";
  };
  deps.prepare?.();
  let shown = false;
  try {
    shown = await writeExample(set, deps, Boolean(opts.newScreen));
    if (shown) await (deps.wait ?? sleep)(TOPIC_PAUSE_MS);
    // after the look at the example: the board still there (and up) before "Now you try!"
    await boardUp(deps);
    deps.toast(shown ? PRACTICE_COPY.yourTurn : PRACTICE_COPY.start(deps.skillName(set.skill)));
    // after the example the problems go on a fresh screen anyway (the executor's rule for a screen with work)
    const fresh = opts.newScreen && !shown ? NEW_SCREEN : [];
    const report = await runWhenReady(deps, [...fresh, { type: "write_problems", problems: set.problems.map((p) => [...p]) }], { origin: "practice" });
    if (report.problemsWritten > 0) deps.nameScreen?.(set.skill);
    deps.metric?.("learning.practice.board", { skill: set.skill, written: report.problemsWritten, dropped: report.problemsDropped, topic, example: shown });
    if (report.problemsWritten > 0) return "written";
    // the hand stopped because the board went (the kid left as it wrote): not the engine's doing
    if (deps.gone?.()) throw new BoardGone();
    return fail("none_written");
  } catch (e) {
    if (e instanceof BoardGone) {
      deps.metric?.("learning.practice.board.abandoned", { skill: set.skill, topic, example: shown });
      return "abandoned";
    }
    deps.metric?.("learning.practice.board.failed", { skill: set.skill, error: e instanceof Error ? e.message : String(e) });
    return fail(e instanceof BoardNotReady ? "board_not_ready" : "run_failed");
  }
}

/** Reads this board's practice marker and writes its problems (a topic's worked example first), once. */
export async function runPracticeMarker(deps: PracticeRunDeps): Promise<PracticeRunResult> {
  const { boardId } = deps;
  if (started.has(boardId)) return "already";
  const storage = deps.storage;
  const marker = readPracticeMarker(boardId, (deps.now ?? Date.now)(), storage);
  if (!marker) return "none";
  started.add(boardId);
  writing.add(boardId);
  try {
    // first: a reload from here on finds no marker, whatever happens to the writing
    clearPracticeMarker(boardId, storage);

    // the board up before its screen is read: a loop not up yet reads as an empty screen
    try {
      await boardUp(deps);
    } catch (e) {
      if (e instanceof BoardGone) {
        deps.metric?.("learning.practice.board.abandoned", { skill: marker.skill, topic: Boolean(marker.examples?.length), example: false });
        return "abandoned";
      }
      const copy = marker.examples?.length ? PRACTICE_COPY.topicFailed : PRACTICE_COPY.failed;
      deps.toast(copy);
      deps.reportFailure?.("board_not_ready", copy);
      return "failed";
    }
    const screen = deps.screen?.();
    const onScreen = new Set(screen?.problems ?? []);
    const problems = marker.problems.filter((p) => !onScreen.has(p.join("; "))).map((p) => [...p]);
    if (problems.length === 0) return "already";
    // a topic's example only on a fresh board (a marker that could not be cleared finds work there)
    const examples = marker.examples && (!screen || screen.empty) ? marker.examples : undefined;
    return await writePracticeSet({ skill: marker.skill, problems, ...(examples ? { examples } : {}) }, deps);
  } finally {
    writing.delete(boardId);
    for (const fn of [...runEndListeners]) {
      try {
        fn(boardId);
      } catch {
        // a listener is never worth the run
      }
    }
  }
}

/** Forget the boards started in this tab (tests). */
export function resetPracticeBoards(): void {
  started.clear();
  writing.clear();
}

/** Runs this board's practice marker once the board (editor and controller) is up. */
export function usePracticeBoard(
  boardId: string,
  controller: LiveController,
  deps: BoardPracticeDeps,
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
      nameScreen: d.nameScreen ? (skill) => depsRef.current.nameScreen?.(skill) : undefined,
      pickExample: d.pickExample ? (candidates) => depsRef.current.pickExample?.(candidates) ?? Promise.resolve(null) : undefined,
      metric: (name, fields) => depsRef.current.metric?.(name, fields),
      reportFailure: (code, message) => reportUserError({ kind: "live.practice", code, message, boardId }),
      run: (actions, from) => controller.runChatActions!(actions, from),
      // the run outlives this effect: it waits on the board's own readiness, and ends quietly once the board has gone
      ...boardLifeDeps(boardId, controller),
      screen: controller.chatScreen ? () => controller.chatScreen!() : undefined,
    });
  }, [boardId, controller]);
}
