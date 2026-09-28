/**
 * Writes a board makes as it closes: the autosave's final flush (data + thumbnail) and the
 * auto-name. The board page unmounts on the way back to the dashboard, so these are still in
 * flight when the dashboard reads the list; it waits for them (bounded) so the card it
 * shows already has the new thumbnail and name. Module state: one set per tab.
 */

const inFlight = new Set<Promise<unknown>>();

/** Registers a write that should land before the board list is read. Never rejects outward. */
export function trackExitWrite(write: Promise<unknown>): void {
  const settled = write.then(
    () => undefined,
    () => undefined,
  );
  inFlight.add(settled);
  void settled.finally(() => inFlight.delete(settled));
}

/** Number of exit writes still in flight (for tests and logs). */
export function pendingExitWrites(): number {
  return inFlight.size;
}

/**
 * Resolves once every exit write registered so far has settled, or after `timeoutMs`,
 * whichever is first. Resolves immediately when nothing is pending.
 */
export function settleExitWrites(timeoutMs: number): Promise<void> {
  if (inFlight.size === 0) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([Promise.all([...inFlight]).then(() => undefined), timeout]).finally(() => clearTimeout(timer));
}
