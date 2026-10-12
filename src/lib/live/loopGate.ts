/**
 * Whether a board's Live loop is up, for work that outlives a render (`LiveController.whenReady`,
 * `boardClosed`). `useLiveMath` makes the loop in an effect — after its children's effects, and
 * again for a new editor or React's development double effects — and stops it when the board
 * unmounts. The controller it hands out stays the same object throughout, so a run holding it
 * cannot tell "not up yet" from "gone for good": both threw "The board is not ready yet."
 *
 * That mattered on 2026-10-12 (prod, live.practice `board_not_ready` reported from "/"): a topic
 * board wrote its worked example, the kid left during the 4 s look at it, and the practice run
 * carried on against the closed board's controller — "Now you try!" on the home page, four tries,
 * then "Couldn't write the problems for that topic" and a report. The gate answers the question
 * instead of a sleep and a guess: "ready" once the loop for that board is up (event-driven, no
 * polling), "closed" once the board has gone (unmounted, or another board's loop in its place —
 * the run stops without a word), "timeout" when it never came up within the caller's ceiling.
 *
 * Pure and tiny: it is in the board's first load (docs/BUNDLE.md).
 */

export type LoopReadiness = "ready" | "closed" | "timeout";

export interface LoopGate {
  /** The loop for `boardId` is up (the effect made and started it). */
  open(boardId: string): void;
  /**
   * The loop stopped (the effect's cleanup). Gone for good unless `open` follows in the same turn:
   * React runs an effect's cleanup and its next run back to back (development double effects, a
   * new editor), so the verdict waits for `defer` (a microtask) and a reopened board never closes.
   */
  close(): void;
  /** The board `boardId` is gone from this controller: a run for it should stop quietly. */
  closed(boardId: string): boolean;
  /** Resolves as soon as the loop for `boardId` is up ("ready"), the board has gone ("closed"), or `timeoutMs` passes ("timeout"). */
  whenReady(boardId: string, timeoutMs: number): Promise<LoopReadiness>;
}

export function createLoopGate(defer: (fn: () => void) => void = queueMicrotask): LoopGate {
  /** the board whose loop is up now, or null (not yet, or between a cleanup and the next run) */
  let up: string | null = null;
  /** the board last opened: a run for any other one is for a board no longer here */
  let last: string | null = null;
  /** unmounted for good */
  let gone = false;
  const waiters = new Set<() => void>();
  const wake = () => {
    for (const fn of [...waiters]) fn();
  };
  const state = (boardId: string): LoopReadiness | null => {
    if (gone || (last !== null && last !== boardId)) return "closed";
    return up === boardId ? "ready" : null;
  };

  return {
    open(boardId) {
      up = last = boardId;
      gone = false;
      wake();
    },
    close() {
      up = null;
      defer(() => {
        if (up !== null) return;
        gone = true;
        wake();
      });
    },
    closed: (boardId) => state(boardId) === "closed",
    whenReady(boardId, timeoutMs) {
      const now = state(boardId);
      if (now) return Promise.resolve(now);
      return new Promise<LoopReadiness>((resolve) => {
        const settle = (result: LoopReadiness) => {
          waiters.delete(check);
          clearTimeout(timer);
          resolve(result);
        };
        const check = () => {
          const s = state(boardId);
          if (s) settle(s);
        };
        const timer = setTimeout(() => settle("timeout"), timeoutMs);
        waiters.add(check);
      });
    },
  };
}
