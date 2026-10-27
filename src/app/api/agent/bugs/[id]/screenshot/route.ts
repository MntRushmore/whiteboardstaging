import { agentGate, bugScreenshot, restClient } from "@/lib/server/bugAgent";
import { json } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/agent/bugs/<id>/screenshot — the report's picture of the board, for the agent to look at. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = agentGate(req);
  if ("response" in gate) return gate.response;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, "invalid_request", "That isn't a report id.");
  const shot = await bugScreenshot(restClient(gate.deps), id).catch(() => null);
  if (!shot) return json(404, "not_found", "No screenshot.");
  return new Response(new Uint8Array(shot.bytes), { headers: { "content-type": shot.type, "cache-control": "no-store" } });
}
