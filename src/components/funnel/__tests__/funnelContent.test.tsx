import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The admin Funnel's page body (FunnelContent) with "Before the account": above "From sign-up to
 * paying", the same bars (the try's checked line marked as a part of the bar above), the notes, and
 * a calm line when there is nothing to count or the database does not count it.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {}, rpc: vi.fn() } }));

import { FunnelContent } from "../FunnelScreen";
import { FUNNEL_COPY, START_STAGE_LABELS, buildFunnelView } from "@/lib/funnel/funnelView";
import { buildFunnelReport, type FunnelRpc } from "@/lib/funnel/report";

const NOW = Date.parse("2026-10-13T23:00:00Z");

const render = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function rpc(start: FunnelRpc["start"], accounts: FunnelRpc["accounts"] = [{ week: "2026-10-12", signed_up_at: "2026-10-13T11:01Z", source: "x", stages: ["signed_up"], steps: [], trial_ended: false, canceled: false }]): FunnelRpc {
  return { time_zone: "America/New_York", generated_at: "2026-10-13T23:00:00Z", tracking_since: "2026-10-12T19:30:42Z", active_subscriptions: 0, kid_profiles: 0, accounts, start };
}

const START: NonNullable<FunnelRpc["start"]> = {
  since: "2026-08-14T14:07Z",
  journeys: [
    { first_at: "2026-10-13T10:00Z", events: ["start_shown"], n: 3 },
    { first_at: "2026-10-13T10:03Z", events: ["start_shown", "start_who", "start_grade", "start_try_shown", "start_try_checked", "start_plan", "start_account_shown", "start_account"], n: 1 },
  ],
};

function page(r: FunnelRpc) {
  const view = buildFunnelView(buildFunnelReport(r, { monthlyUsd: 25 }), NOW);
  return render(<FunnelContent view={view} loading={false} error={null} updated={null} onRefresh={() => {}} cohort="paywall" onCohort={() => {}} />);
}

describe("Before the account", () => {
  it("sits above From sign-up to paying, with a bar per step and the notes", () => {
    const html = page(rpc(START));
    const before = html.indexOf(FUNNEL_COPY.startTitle);
    expect(before).toBeGreaterThan(html.indexOf(FUNNEL_COPY.moneyTitle));
    expect(before).toBeLessThan(html.indexOf(FUNNEL_COPY.stagesTitle));
    for (const label of Object.values(START_STAGE_LABELS)) expect(html).toContain(label);
    expect(html).toContain(`aria-label="${START_STAGE_LABELS.start_who}: 1, 25% of the step before"`);
    expect(html).toMatch(/<li[^>]*data-branch="true"[^>]*aria-label="The tutor checked a line: 1/);
    expect(html).toContain(FUNNEL_COPY.startTryNote);
    expect(html).toContain("No kid has sent their plan to a grown-up yet.");
  });

  it("says so when nobody started, and when the database does not count it", () => {
    expect(page(rpc({ since: START.since, journeys: [] }))).toContain(FUNNEL_COPY.startEmpty);
    expect(page(rpc(null))).toContain(FUNNEL_COPY.startMissing);
  });

  it("shows above the empty state when visits started but nobody signed up yet", () => {
    const html = page(rpc(START, []));
    expect(html).toContain(FUNNEL_COPY.emptyTitle);
    expect(html).toContain(FUNNEL_COPY.startTitle);
    expect(page(rpc(null, []))).not.toContain(FUNNEL_COPY.startTitle);
  });
});
