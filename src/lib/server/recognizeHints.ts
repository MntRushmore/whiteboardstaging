import { isMathpixAuthFailure, type MathpixFailure } from "@/lib/server/mathpix";

/**
 * Additive fields on the recognize route's `recognizer_failed` 502 body (the response schema in
 * src/lib/live/contracts.ts is frozen and describes success only). Both are hints, never
 * requirements: an old client that ignores them behaves exactly as before. The client side is
 * `recognizeFailureHints` in src/lib/live/recognizeClient.ts.
 *
 *  - `needsCrop`      we had no crop to fall back on; send one and this line can still be
 *                     read by the vision recognizer. The client retries the line once.
 *  - `recognizerDown` Mathpix rejected our credentials, so every line will fail the same
 *                     way: the client flips to the vision recognizer for the rest of the
 *                     session instead of paying a failed round-trip per line.
 *
 * Lives here, not in the route file: a route file may only export handlers and segment config
 * (`next dev` type-checks it against that list, and `tsc` then fails on any other export).
 */
export type RecognizeFailureHints = { needsCrop?: true; recognizerDown?: true };

export function recognizeFailureHints(hadCrop: boolean, mathpixFailure: MathpixFailure | null): RecognizeFailureHints {
  return {
    ...(hadCrop ? {} : { needsCrop: true as const }),
    ...(mathpixFailure && isMathpixAuthFailure(mathpixFailure) ? { recognizerDown: true as const } : {}),
  };
}
