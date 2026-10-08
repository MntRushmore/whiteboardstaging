import { isMathpixAuthFailure, type MathpixFailure } from "@/lib/server/mathpix";

/**
 * Additive fields on the recognize route's `recognizer_failed` 502 body (the response schema in
 * src/lib/live/contracts.ts is frozen and describes success only). All are hints, never
 * requirements: an old client that ignores them behaves exactly as before. The client side is
 * `recognizeFailureHints` in src/lib/live/recognizeClient.ts.
 *
 *  - `needsCrop`      we had no crop to fall back on; send one and this line can still be
 *                     read by the vision recognizer. The client retries the line once.
 *  - `recognizerDown` Mathpix rejected our credentials, so every line will fail the same
 *                     way: the client flips to the vision recognizer for the rest of the
 *                     session instead of paying a failed round-trip per line.
 *  - `unreadable`     Mathpix answered, and could not make sense of the ink (its `api_error`:
 *                     a scribble, a young child's `=`). Nothing is down: when no crop can be
 *                     sent either, the board treats the line as one it could not read (its
 *                     gentle "couldn't read this" and "?"), never as the tutor service failing.
 *  - `transient`      Mathpix timed out, could not be reached or answered an error status: the
 *                     same ink is worth one more try on its own (the client's blip retry).
 *
 * Lives here, not in the route file: a route file may only export handlers and segment config
 * (`next dev` type-checks it against that list, and `tsc` then fails on any other export).
 */
export type RecognizeFailureHints = { needsCrop?: true; recognizerDown?: true; unreadable?: true; transient?: true };

const TRANSIENT: ReadonlySet<MathpixFailure["reason"]> = new Set(["timeout", "network", "http"]);

export function recognizeFailureHints(hadCrop: boolean, mathpixFailure: MathpixFailure | null): RecognizeFailureHints {
  return {
    ...(hadCrop ? {} : { needsCrop: true as const }),
    ...(mathpixFailure && isMathpixAuthFailure(mathpixFailure) ? { recognizerDown: true as const } : {}),
    ...(mathpixFailure?.reason === "api_error" ? { unreadable: true as const } : {}),
    ...(mathpixFailure && TRANSIENT.has(mathpixFailure.reason) ? { transient: true as const } : {}),
  };
}
