/**
 * The grown-up's referral summary, read in the browser with their own session: one call to
 * referral_summary() (which also makes their code the first time), checked against its schema and
 * turned into the contract's ReferralSummary with a link to this deployment. Never throws: the card
 * that asks simply stays hidden when there is nothing to show.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReferralSummary } from "./contracts";
import { ReferralSummaryRpcSchema, siteBase, toReferralSummary } from "./summary";

export type ReferralSummaryResult =
  | { kind: "ok"; summary: ReferralSummary }
  /** a kid profile (42501, hint family_kid): referrals are for grown-ups */
  | { kind: "kid" }
  /** offline, signed out under us, the database without the migration, or an answer in another shape */
  | { kind: "error"; message: string };

/** One call to referral_summary(); `origin` is the page's (window.location.origin). */
export async function readReferralSummary(client: Pick<SupabaseClient, "rpc">, origin: string | null): Promise<ReferralSummaryResult> {
  try {
    const { data, error } = await client.rpc("referral_summary");
    if (error) {
      if (error.code === "42501" && error.hint === "family_kid") return { kind: "kid" };
      return { kind: "error", message: error.message };
    }
    const parsed = ReferralSummaryRpcSchema.safeParse(data);
    if (!parsed.success) return { kind: "error", message: "referral_summary answered in an unknown shape" };
    const base = siteBase(process.env.NEXT_PUBLIC_SITE_URL, origin);
    if (!base) return { kind: "error", message: "no site address to build the link with" };
    return { kind: "ok", summary: toReferralSummary(parsed.data, base) };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
