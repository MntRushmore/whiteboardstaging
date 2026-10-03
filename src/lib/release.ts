/**
 * Which build this is, for log lines and error reports: the first 7 characters of the commit
 * Vercel built (`VERCEL_GIT_COMMIT_SHA`), else the local git HEAD, else a build stamp. Computed
 * once per build in next.config.ts and inlined as NEXT_PUBLIC_RELEASE into server and client code,
 * so a browser's report and the server's lines agree. Unset outside a Next build (tests): "dev".
 *
 * Carried by: client error reports (POST /api/client-errors), server error lines
 * (src/instrumentation.ts) and GET /api/health. See docs/RUNBOOK-ops.md.
 */
export const RELEASE: string = process.env.NEXT_PUBLIC_RELEASE || "dev";
