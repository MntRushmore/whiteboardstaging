/**
 * Draining pending async work in the Live loop tests.
 *
 * The loop is not pure-timer driven: a pen-up runs through `hashPayload`, which awaits
 * `crypto.subtle.digest` — real native work that resolves through libuv, not through the fake
 * timer queue. So `vi.advanceTimersByTimeAsync(...)` alone does not guarantee the recognize call
 * has been made by the time the assertion runs; the test also has to let the event loop turn.
 *
 * Flushing a FIXED number of ticks (the old `settle(8)`) is a race: it passed on a fast laptop
 * and failed on a loaded 2-core CI runner, where the digest needed more turns. Prefer
 * `settleUntil(condition)`, which waits for the thing the test actually cares about and gives up
 * only after a generous cap, so a genuine regression still fails (and fails fast).
 */

/** One event-loop turn plus a microtask drain. */
async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

/**
 * Flush `ticks` event-loop turns. Use only where there is nothing specific to wait for
 * (asserting that something did NOT happen); otherwise use `settleUntil`.
 */
export async function settle(ticks = 24): Promise<void> {
  for (let i = 0; i < ticks; i++) await tick();
}

/**
 * Turn the event loop until `done()` is true, then return. Returns as soon as the condition
 * holds, so the common case costs one or two turns; `maxTicks` only bounds the failure case.
 * The assertion after it still decides pass/fail — this never throws.
 */
export async function settleUntil(done: () => boolean, maxTicks = 400): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (done()) return;
    await tick();
  }
}
