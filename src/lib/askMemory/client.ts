/**
 * "What Ask remembers", in the browser: GET and DELETE /api/live/ask/memory (the caller's own
 * notes), or with a kid's id their grown-up's view of that kid's (the Family page). Throws ApiError
 * on a refusal or a failure, so the card can say so.
 */
import { apiErrorFromResponse, authedFetch } from "@/lib/api-client";
import { ASK_MEMORY_PATH, AskMemoryResponseSchema, type LearnerMemory } from "@/lib/live/ask/contracts";

export function askMemoryUrl(kidId?: string | null): string {
  return kidId ? `${ASK_MEMORY_PATH}?kidId=${encodeURIComponent(kidId)}` : ASK_MEMORY_PATH;
}

async function call(method: "GET" | "DELETE", kidId?: string | null): Promise<LearnerMemory> {
  const res = await authedFetch(askMemoryUrl(kidId), { method, cache: "no-store" });
  if (!res.ok) throw await apiErrorFromResponse(res);
  const parsed = AskMemoryResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("The notes came back in a shape this page doesn't know. Reload the page.");
  return parsed.data;
}

/** The notes Ask keeps (the caller's own, or `kidId`'s for their grown-up). */
export function loadAskMemory(kidId?: string | null): Promise<LearnerMemory> {
  return call("GET", kidId);
}

/** Forget them all. Answers the memory as it now is (empty). */
export function clearAskMemory(kidId?: string | null): Promise<LearnerMemory> {
  return call("DELETE", kidId);
}
