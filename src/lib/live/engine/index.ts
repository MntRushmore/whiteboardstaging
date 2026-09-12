import type { LiveEngine } from "../contracts";

// STUB — WP-B replaces this body (keeps the `getEngine` export). Pure TS, no DOM.
const stub: LiveEngine = {
  analyzeLine: () => ({ kind: "unknown", math: "", resultLatex: "", verdict: "unknown", note: "" }),
  compileExpr: () => null,
  solveLatex: () => null,
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};

let enginePromise: Promise<LiveEngine> | null = null;

/** Lazily loads mathjs (WP-B). Safe to call at mount to pre-warm. */
export function getEngine(): Promise<LiveEngine> {
  if (!enginePromise) enginePromise = Promise.resolve(stub);
  return enginePromise;
}
