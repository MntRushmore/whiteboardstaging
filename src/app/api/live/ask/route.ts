/**
 * POST /api/live/ask — Ask, rebuilt (docs/ASK-V2.md, part "server"). CONTRACT STUB: answers 501
 * until the server part builds the streamed route.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json({ error: "Not built yet", code: "not_implemented" }, { status: 501 });
}
