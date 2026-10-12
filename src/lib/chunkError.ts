/**
 * Telling a stale chunk from any other error: shared by the browser (src/lib/chunkReload.ts, which
 * reloads or reports it) and POST /api/client-errors (which records one from an older build at
 * info). No imports, so a route handler can use it without pulling in React's client hooks.
 *
 * A chunk of the release the page was loaded with could not be fetched: a deploy since (the new
 * release no longer has the old one's files), or the connection dropped as it was fetched.
 * Webpack's and Turbopack's words (`ChunkLoadError`, "Loading chunk 12 failed", "Failed to load
 * chunk /_next/static/chunks/….js"), and each browser's for a failed `import()`: Chrome "Failed to
 * fetch dynamically imported module", Safari "Importing a module script failed", Firefox "error
 * loading dynamically imported module".
 */
export const CHUNK_LOAD_ERROR =
  /ChunkLoadError|Loading chunk|Failed to load chunk|dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

/** The code of a stale chunk outside the error boundaries (`live.app`, CHUNK_FAILED_REPORT in chunkReload.ts). */
export const CHUNK_FAILED_CODE = "chunk_failed";

export function isChunkLoadError(error: unknown): boolean {
  try {
    const e = error as { name?: unknown; message?: unknown } | null | undefined;
    const name = typeof e?.name === "string" ? e.name : "";
    const message = typeof e?.message === "string" ? e.message : typeof error === "string" ? error : "";
    return CHUNK_LOAD_ERROR.test(`${name}: ${message}`);
  } catch {
    return false;
  }
}
