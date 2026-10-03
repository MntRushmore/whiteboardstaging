/**
 * When the board's ink dialog may open. Kept apart from outOfInk.ts (the words) because this part
 * is in the board's first load, through OutOfInkWatcher and the ink meter; the rest arrives lazily
 * with the dialog. Unit-tested in __tests__/inkDialog.test.ts.
 *
 * Two ways in: a Live route's `402 ink_empty` (classifyLiveFailure records a LiveError with code
 * 'ink'; the watcher asks inkDialogWanted, then opens the dialog once penIsResting), and the
 * student asking for it (the meter's "Get ink", the status pill's "Get ink": openInkDialog()).
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
 * The 402 -> dialog mapping: a Live error with code 'ink' (classifyLiveFailure's mapping of
 * `402 ink_empty`) asks for the dialog, once per visit to the board; every later ink error is
 * left to the status pill, whose "Get ink" opens the dialog on request.
 */
export function inkDialogWanted(error: { code: string } | null | undefined, alreadyShown: boolean): boolean {
  return !alreadyShown && error?.code === "ink";
}

/** Window event the board's watcher listens for: open the ink dialog now (the student asked). */
export const OPEN_INK_DIALOG_EVENT = "agathon:open-ink-dialog";

/** Ask the board to show the ink dialog (packs to buy). A no-op where no board is listening. */
export function openInkDialog(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_INK_DIALOG_EVENT));
}
