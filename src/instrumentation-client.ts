import { CHUNK_FAILED_REPORT, isChunkLoadError } from "@/lib/chunkReload";
import { preloadErrorReporter, reportAppError, reportUserError } from "@/lib/reportAppError";

// Runs on every page before hydration (Next's client instrumentation hook). Uncaught errors and
// unhandled promise rejections go to POST /api/client-errors (src/lib/reportAppError.ts, which loads
// the reporter lazily); the error boundaries report what they catch themselves. Bubble-phase
// `error` only: failed <img>/<script> loads do not bubble, so they are not reported as crashes.
// A chunk of an older release that an `import()` could not fetch (a deploy since the page loaded)
// is a warning, not a crash (src/lib/chunkReload.ts).
function report(source: "error" | "rejection", error: unknown): void {
  if (isChunkLoadError(error)) reportUserError(CHUNK_FAILED_REPORT);
  else reportAppError(source, error);
}

addEventListener("error", (e) =>
  report("error", e.error ?? { message: e.message, stack: e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : undefined }),
);
addEventListener("unhandledrejection", (e) => report("rejection", e.reason));
preloadErrorReporter();
