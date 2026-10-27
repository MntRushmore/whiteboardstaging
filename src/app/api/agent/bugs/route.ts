import { agentGate, listBugs, restClient } from "@/lib/server/bugAgent";
import { json } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/agent/bugs?status=new — the bug agent's queue (src/lib/server/bugAgent.ts). */
export async function GET(req: Request): Promise<Response> {
  const gate = agentGate(req);
  if ("response" in gate) return gate.response;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "new";
  const limit = Number(url.searchParams.get("limit") ?? "20");
  try {
    const bugs = await listBugs(restClient(gate.deps), status, Number.isFinite(limit) ? limit : 20);
    return Response.json({ bugs });
  } catch (err) {
    return json(502, "upstream_error", err instanceof Error ? err.message : "The reports couldn't be read.");
  }
}
