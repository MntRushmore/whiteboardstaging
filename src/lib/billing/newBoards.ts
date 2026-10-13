/**
 * New boards on the home, held while the account is on its free board (`freeBoard.ts`): an account
 * without a plan has ONE free board, so New Board, a topic, Today's practice, Practice more and Ask
 * go to the plan screen instead of making another. The home holds them (`useFreeBoard`); whatever
 * makes a board there asks `mayMakeBoard()` first. Opening an existing board is not held: the
 * board's own gate decides (the free board opens, any other goes to the plan screen).
 *
 * Module state, not React: the board makers live in lazily loaded cards (TodayCard, TopicStart, the
 * skill path) with their own hooks, and one hold for the page is all they need to ask about.
 */

let held: (() => void) | null = null;

/** Hold new boards: making one runs `onHeld` (to the plan screen) instead. Returns the release. */
export function holdNewBoards(onHeld: () => void): () => void {
  held = onHeld;
  return () => {
    if (held === onHeld) held = null;
  };
}

/** True when a new board may be made now; otherwise the hold's `onHeld` runs and it is false. */
export function mayMakeBoard(): boolean {
  if (!held) return true;
  held();
  return false;
}
