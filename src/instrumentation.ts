import type { Instrumentation } from "next";

/**
 * Server instrumentation (Next's hook). `onRequestError` turns every error the Next server
 * captures — a server component that throws, a route handler's uncaught error, a server action —
 * into one structured pino line, `module: "server-error"` (docs/RUNBOOK-ops.md). Route handlers
 * that map their own errors (`errorResponse`) never get here.
 *
 * Logged: the route file, its kind, the method, the path WITHOUT its query string, the digest
 * (the "Reference" the error page shows the student), the error's name, message and the top of
 * its stack (URLs in them without query strings), and the release. Never the request body or
 * headers.
 *
 * Node only: the logger is pino, which the Edge runtime cannot load (nothing here runs on Edge).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const [{ logger }, { RELEASE }, { stripUrlQueries }] = await Promise.all([
      import("@/lib/logger"),
      import("@/lib/release"),
      import("@/lib/clientErrors"),
    ]);
    const error = err as { name?: unknown; message?: unknown; stack?: unknown; digest?: unknown };
    logger.child({ module: "server-error" }).error(
      {
        route: context.routePath,
        routeType: context.routeType,
        method: request.method,
        path: request.path.replace(/[?#][\s\S]*/, ""),
        digest: typeof error.digest === "string" ? error.digest : undefined,
        name: typeof error.name === "string" ? error.name : undefined,
        error: stripUrlQueries(typeof error.message === "string" ? error.message : String(err)).slice(0, 1000),
        stack: typeof error.stack === "string" ? stripUrlQueries(error.stack).slice(0, 4000) : undefined,
        release: RELEASE,
      },
      "unhandled server error",
    );
  } catch {
    // Logging must never become the next error.
  }
};
