import { reportClientError } from "@/lib/clientErrors";

// Runs on every page before hydration (Next's client instrumentation hook). Uncaught errors and
// unhandled promise rejections go to POST /api/client-errors (src/lib/clientErrors.ts); the error
// boundaries report what they catch themselves. Bubble-phase `error` only: failed <img>/<script>
// loads do not bubble, so they are not reported as crashes.
addEventListener("error", (e) =>
  reportClientError("error", e.error ?? { message: e.message, stack: e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : undefined }),
);
addEventListener("unhandledrejection", (e) => reportClientError("rejection", e.reason));
