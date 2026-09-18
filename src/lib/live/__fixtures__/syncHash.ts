import { afterEach, beforeEach } from "vitest";

/**
 * Makes stroke hashing synchronous for a Live loop test file.
 *
 * Why this exists: the loop tests drive time with `vi.useFakeTimers()`, but a pen-up is not
 * purely timer driven — `hashPayload` awaits `crypto.subtle.digest`, which is real native work
 * completed on libuv's thread pool. Fake timers cannot flush that, so "advance the clock, turn
 * the event loop N times, assert" is a race: it passed on a fast laptop and failed on a loaded
 * two-core CI runner, in a different subset of tests each run.
 *
 * `hashPayload` already falls back to a synchronous FNV-1a hash when `crypto.subtle` is absent
 * (it has to: the loop runs in browsers without a secure context). Hiding `subtle` for the
 * duration of the file takes that path, so every await in the pen-up pipeline resolves on the
 * microtask queue and the tests become deterministic.
 *
 * What this gives up: these tests no longer exercise the SHA-1 branch. That is fine — the two
 * branches are covered directly in `strokePayload.test.ts`, and what the loop cares about is
 * that a hash is stable for identical ink and differs for changed ink, which FNV-1a gives just
 * as well. Values differ (an `fnv_` prefix), but no loop test asserts a literal hash; they
 * compare against `hashPayload` output, which stays self-consistent.
 */
export function useSyncHash(): void {
  let original: SubtleCrypto | undefined;

  beforeEach(() => {
    original = globalThis.crypto?.subtle;
    if (original) {
      Object.defineProperty(globalThis.crypto, "subtle", { value: undefined, configurable: true });
    }
  });

  afterEach(() => {
    if (original) {
      Object.defineProperty(globalThis.crypto, "subtle", { value: original, configurable: true });
      original = undefined;
    }
  });
}
