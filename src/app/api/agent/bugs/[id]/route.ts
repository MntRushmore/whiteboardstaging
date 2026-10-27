import { agentGate, restClient, updateBug } from "@/lib/server/bugAgent";
import { json } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/agent/bugs/<id> {status?, note?} — the agent's findings on a report. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = agentGate(req);
  if ("response" in gate) return gate.response;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, "invalid_request", "That isn't a report id.");
  let body: { status?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, "invalid_request", "Send JSON: {status?, note?}.");
  }
  try {
    const bug = await updateBug(restClient(gate.deps), id, {
      status: typeof body.status === "string" ? body.status : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
    }, new Date());
    return bug ? Response.json({ bug }) : json(404, "not_found", "No such report.");
  } catch (err) {
    if (err instanceof TypeError) return json(400, "invalid_request", err.message);
    return json(502, "upstream_error", err instanceof Error ? err.message : "The report couldn't be changed.");
  }
}
