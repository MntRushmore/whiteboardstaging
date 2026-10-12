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

/** A release that is a git commit: what next.config.ts's buildRelease names a Vercel or git build. */
const COMMIT = /^[0-9a-f]{7,40}$/i;

/**
 * Whether `release` (a browser report's) names another build than `current` (this deployment's
 * RELEASE): both git commits, compared as short shas (7 characters, as buildRelease cuts
 * VERCEL_GIT_COMMIT_SHA). False when either is not a commit ("dev", a `build-…` stamp, a name set
 * by hand in NEXT_PUBLIC_RELEASE): an unknown release is never "another" one.
 */
export function isOtherRelease(release: string | null | undefined, current: string): boolean {
  if (!release || !COMMIT.test(release) || !COMMIT.test(current)) return false;
  return release.slice(0, 7).toLowerCase() !== current.slice(0, 7).toLowerCase();
}
