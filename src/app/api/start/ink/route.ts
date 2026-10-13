import { buildStartInkSet } from "@/lib/start/inkSet";

/**
 * GET /api/start/ink: the handwriting /start shows (src/lib/start/inkSet.ts), written once at build
 * time and served as static JSON from the CDN. /start fetches it after the first answer, so the
 * first screen never waits on it and the browser never loads the hand engine.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(buildStartInkSet(), {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
