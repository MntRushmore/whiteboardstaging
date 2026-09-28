/**
 * When the board's out-of-credits dialog may open. Kept apart from outOfCredits.ts (the words and
 * the upgrade choices) because this part is in the board's first load, through
 * OutOfCreditsWatcher; the rest arrives lazily with the dialog. Unit-tested in
 * __tests__/outOfCredits.test.ts.
 *
 * The path of a 402: a Live route answers `402 credits_exhausted` -> classifyLiveFailure
 * (src/components/live/errorView.ts) records a LiveError with code 'credits' -> the watcher asks
 * creditsDialogWanted, then opens the dialog once penIsResting.
 */

/** How long the pen must have been still before the dialog may cover the board. */
export const PEN_REST_MS = 1_500;

/**
 * True when the student is not writing: no pointer is down and nothing touched the board for
 * PEN_REST_MS. The dialog never lands mid-stroke, nor between the strokes of one expression.
 */
export function penIsResting(input: { pointerDown: boolean; lastPenAt: number; now: number }): boolean {
  return !input.pointerDown && input.now - input.lastPenAt >= PEN_REST_MS;
}

/**
 * The 402 -> dialog mapping: a Live error with code 'credits' (classifyLiveFailure's mapping of
 * `402 credits_exhausted`) asks for the dialog, once per visit to the board; every later credits
 * error is left to the status pill, which already links to the account page.
 */
export function creditsDialogWanted(error: { code: string } | null | undefined, alreadyShown: boolean): boolean {
  return !alreadyShown && error?.code === "credits";
}
