import type pino from "pino";
import { parseInkSummary } from "@/lib/billing/inkSummary";
import { hasPlan, parseUnlimitedState } from "@/lib/billing/unlimited";
import { billingEnforced } from "@/lib/env";
import { SPEAK_STARTER_WINDOW_MS } from "@/lib/speech/contracts";
import type { RpcClient } from "@/lib/server/billing";

/**
 * Whether this account gets ElevenLabs for its speech, both ways: the Hope voice reading the tutor
 * aloud (POST /api/live/speak) and Scribe hearing a spoken ask (POST /api/live/transcribe). Anyone
 * else gets the browser's own voice and recognizer, which cost nothing.
 *
 * Yes for an account with Agathon Unlimited (`hasPlan` on ink_summary()'s plan, which is a kid's
 * grown-up's through plan_owner_of), or one on its guided first board (starter ink left, granted at
 * most SPEAK_STARTER_WINDOW_MS ago: speech spends no ink, so a balance alone would keep it for good
 * on an account that never starts a plan). Always where billing is not enforced. A check that fails
 * is a no: the browser's, never a free ElevenLabs.
 */
export async function speechEntitled(client: RpcClient, log: pino.Logger): Promise<boolean> {
  if (!billingEnforced()) return true;
  try {
    const { data, error } = await client.rpc("ink_summary");
    const summary = error ? null : parseInkSummary(data);
    if (!summary) {
      log.warn({ error: error?.message ?? "unreadable" }, "speech: ink_summary failed; the browser's voice");
      return false;
    }
    if (hasPlan(parseUnlimitedState(summary.unlimited))) return true;
    const starterAt = summary.starter_at ? Date.parse(summary.starter_at) : Number.NaN;
    return summary.balance > 0 && Number.isFinite(starterAt) && Date.now() - starterAt <= SPEAK_STARTER_WINDOW_MS;
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, "speech: ink_summary threw; the browser's voice");
    return false;
  }
}
