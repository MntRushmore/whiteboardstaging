/**
 * The referral pages' markup from finished views: the admin's Referrals list (the reward note with
 * the plan's price, the buttons each row allows and why a paid one waits, the friend's plan, the
 * same-person flag, the empty and failed states) and the friend's
 * invitation on the sign-up page (never naming the code, the free month only with its link).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {}, rpc: vi.fn() } }));

import { ReferralsContent, type ReferralsContentProps } from "../AdminReferralsScreen";
import { ReferralInvite } from "../ReferralInvite";
import { buildReferralsView, type AdminReferral, type AdminReferralList } from "@/lib/referral/admin";
import { REFERRAL_ADMIN_COPY } from "@/lib/referral/copy";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";

const NOW = Date.parse("2026-10-09T18:00:00Z");
const CLOCK = { now: NOW, timeZone: "America/New_York" };

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const noop = () => {};

function referral(id: number, status: AdminReferral["status"], over: Partial<AdminReferral> = {}): AdminReferral {
  return {
    id,
    code: "BCDF2345",
    status,
    createdAt: "2026-10-09T15:00:00Z",
    paidAt: status === "paid" || status === "rewarded" ? "2026-10-09T16:00:00Z" : null,
    rewardedAt: status === "rewarded" ? "2026-10-09T17:00:00Z" : null,
    updatedAt: "2026-10-09T17:00:00Z",
    rewardedByEmail: status === "rewarded" ? "owner@agathon.app" : null,
    referrer: { id: "a", email: "parent@example.com", createdAt: null, payerEmail: null, customerId: "cus_A1" },
    referred: { id: `f${id}`, email: `friend${id}@example.com`, createdAt: null, payerEmail: null, planStatus: null, trialEnd: null },
    ...over,
  };
}

const LIST: AdminReferralList = {
  generatedAt: "2026-10-09T18:00:00Z",
  counts: { signed_up: 1, trialing: 0, paid: 2, rewarded: 1, void: 0 },
  truncated: false,
  referrals: [
    // paid four days ago and still active: rewardable
    referral(4, "paid", { paidAt: "2026-10-05T16:00:00Z", referred: { id: "f4", email: "parent+kid@example.com", createdAt: null, payerEmail: null, planStatus: "active", trialEnd: null } }),
    // paid two hours ago: the first charge may still fail
    referral(3, "paid", { referred: { id: "f3", email: "friend3@example.com", createdAt: null, payerEmail: null, planStatus: "active", trialEnd: "2026-10-09T15:00:00Z" } }),
    referral(2, "rewarded", { referred: { id: "f2", email: "friend2@example.com", createdAt: null, payerEmail: null, planStatus: "past_due", trialEnd: null } }),
    referral(1, "signed_up"),
  ],
};

const props = (over: Partial<ReferralsContentProps> = {}): ReferralsContentProps => ({
  view: buildReferralsView(LIST, "all", CLOCK),
  filter: "all",
  onFilter: noop,
  loading: false,
  error: null,
  updated: "Updated just now",
  onRefresh: noop,
  onMark: noop,
  layout: "table",
  ...over,
});

describe("the admin's Referrals list", () => {
  it("says the Stripe checks and credit come first, above the list", () => {
    const html = text(render(<ReferralsContent {...props()} />));
    expect(html).toContain(REFERRAL_ADMIN_COPY.rewardNote);
    expect(html.indexOf(REFERRAL_ADMIN_COPY.rewardNote)).toBeLessThan(html.indexOf("friend3@example.com"));
  });

  it("names the credit at the plan's own price, and has the friend's invoice checked first", () => {
    const price = `$${UNLIMITED_PLAN.monthlyUsd} credit`;
    expect(REFERRAL_ADMIN_COPY.rewardNote).toContain(price);
    expect(REFERRAL_ADMIN_COPY.rewardBody("parent@example.com")).toContain(price);
    expect(REFERRAL_ADMIN_COPY.rewardNote).toMatch(/first real invoice .* says Paid/);
    expect(REFERRAL_ADMIN_COPY.rewardBody("parent@example.com")).toMatch(/first real invoice .* says Paid/);
  });

  it("offers Mark rewarded only on a settled paid row, says when a paid one may be, and Void until a row is final", () => {
    const html = render(<ReferralsContent {...props()} />);
    expect([...html.matchAll(/data-testid="referral-reward-(\d+)"/g)].map((m) => m[1])).toEqual(["4"]);
    expect([...html.matchAll(/data-testid="referral-wait-(\d+)"/g)].map((m) => m[1])).toEqual(["3"]);
    expect(text(html)).toContain(REFERRAL_ADMIN_COPY.rewardFrom("Oct 12"));
    expect([...html.matchAll(/data-testid="referral-void-(\d+)"/g)].map((m) => m[1])).toEqual(["4", "3", "1"]);
  });

  it("shows the friend's plan, a failing one marked", () => {
    const html = render(<ReferralsContent {...props()} />);
    const plain = text(html);
    expect(plain).toContain(REFERRAL_ADMIN_COPY.friendPlan(REFERRAL_ADMIN_COPY.planWords.active));
    expect(plain).toContain(REFERRAL_ADMIN_COPY.noPlan);
    expect(html).toMatch(new RegExp(`data-alarm="true"[^>]*>${REFERRAL_ADMIN_COPY.friendPlan(REFERRAL_ADMIN_COPY.planWords.past_due)}<`));
  });

  it("shows both emails, the referrer's Stripe customer, and who rewarded a row", () => {
    const html = text(render(<ReferralsContent {...props()} />));
    expect(html).toContain("parent@example.com");
    expect(html).toContain("friend3@example.com");
    expect(html).toContain("cus_A1");
    expect(html).toContain(REFERRAL_ADMIN_COPY.rewardedBy("owner@agathon.app", "today"));
  });

  it("flags a friend whose address is the referrer's own", () => {
    const html = render(<ReferralsContent {...props()} />);
    const row4 = html.slice(html.indexOf('data-testid="referral-row-4"'), html.indexOf('data-testid="referral-row-3"'));
    expect(row4).toContain(REFERRAL_ADMIN_COPY.samePerson);
    expect(html.match(new RegExp(REFERRAL_ADMIN_COPY.samePerson, "g"))).toHaveLength(1);
  });

  it("renders the phone's cards with the same buttons", () => {
    const html = render(<ReferralsContent {...props({ layout: "list" })} />);
    expect(html).not.toContain("<table");
    expect([...html.matchAll(/data-testid="referral-reward-(\d+)"/g)].map((m) => m[1])).toEqual(["4"]);
    expect([...html.matchAll(/data-testid="referral-wait-(\d+)"/g)].map((m) => m[1])).toEqual(["3"]);
  });

  it("is calm before anyone is invited, and says what failed when it cannot read", () => {
    const empty = buildReferralsView({ ...LIST, referrals: [], counts: { signed_up: 0, trialing: 0, paid: 0, rewarded: 0, void: 0 } }, "all", CLOCK);
    expect(text(render(<ReferralsContent {...props({ view: empty })} />))).toContain(REFERRAL_ADMIN_COPY.emptyTitle);
    const failed = text(render(<ReferralsContent {...props({ view: null, error: "Couldn't read admin_referrals: status 500" })} />));
    expect(failed).toContain("Couldn't load the referrals");
    expect(failed).toContain("status 500");
  });
});

describe("the friend's invitation", () => {
  it("renders nothing on the server (the invite lives on the device)", () => {
    expect(render(<ReferralInvite />)).toBe("");
  });
});
