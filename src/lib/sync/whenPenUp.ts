/**
 * The longest an autosave waits for the pen to lift before it is built anyway: longer than a stroke
 * of handwriting, short enough that a long drawing still saves (and the device backup, which is
 * small and cheap, never waits at all).
 */
export const PEN_UP_WAIT_MS = 2_000;
/** how often the pen is looked at while waiting */
export const PEN_UP_POLL_MS = 50;

export interface PenUpTimers {
  setTimeout(fn: () => void, ms: number): unknown;
}

/**
 * Resolves once no pointer is down on the board, or after `maxMs` whatever it is doing.
 *
 * Building an autosave serializes the whole board and renders its thumbnail: on a board with a
 * screenful of ink that is a long task (measured 2026-10-13 on ~550 strokes: 100-250 ms at full
 * speed, several times that on a slow Chromebook), and landing in the middle of a stroke it froze
 * the line being written. Waiting for the pen moves it to the gap between strokes. `isPointing`
 * that throws (an editor already gone) counts as the pen up.
 */
export function whenPenUp(
  isPointing: () => boolean,
  maxMs: number = PEN_UP_WAIT_MS,
  timers: PenUpTimers = globalThis,
  pollMs: number = PEN_UP_POLL_MS,
): Promise<void> {
  const down = (): boolean => {
    try {
      return isPointing();
    } catch {
      return false;
    }
  };
  if (!down()) return Promise.resolve();
  return new Promise((resolve) => {
    let waited = 0;
    const look = (): void => {
      waited += pollMs;
      if (!down() || waited >= maxMs) resolve();
      else timers.setTimeout(look, pollMs);
    };
    timers.setTimeout(look, pollMs);
  });
}
