import { agentGate, replyAsAgent } from "@/lib/server/bugAgent";
import { json } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/agent/bugs/<id>/reply {body} — a reply the reporter sees in the app's Bug reports. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = agentGate(req);
  if ("response" in gate) return gate.response;
  if (!gate.adminId) return json(503, "feature_unavailable", "Replies need BUG_AGENT_ADMIN_ID.");
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, "invalid_request", "That isn't a report id.");
  let body: { body?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, "invalid_request", "Send JSON: {body}.");
  }
  try {
    const ok = await replyAsAgent(gate.deps, gate.adminId, id, typeof body.body === "string" ? body.body : "");
    return ok ? Response.json({ ok: true }) : json(404, "not_found", "No such report.");
  } catch (err) {
    if (err instanceof TypeError) return json(400, "invalid_request", err.message);
    return json(502, "upstream_error", err instanceof Error ? err.message : "The reply couldn't be sent.");
  }
}
