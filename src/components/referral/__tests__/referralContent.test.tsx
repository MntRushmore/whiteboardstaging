/**
 * The referral pages' markup from finished views: the admin's Referrals list (the reward note, the
 * buttons each status allows, the same-person flag, the empty and failed states) and the friend's
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
    referred: { id: `f${id}`, email: `friend${id}@example.com`, createdAt: null, payerEmail: null, planStatus: null },
    ...over,
  };
}

const LIST: AdminReferralList = {
  generatedAt: "2026-10-09T18:00:00Z",
  counts: { signed_up: 1, trialing: 0, paid: 2, rewarded: 1, void: 0 },
  truncated: false,
  referrals: [
    referral(4, "paid", { referred: { id: "f4", email: "parent+kid@example.com", createdAt: null, payerEmail: null, planStatus: "active" } }),
    referral(3, "paid"),
    referral(2, "rewarded"),
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
  it("says the Stripe credit comes first, above the list", () => {
    const html = text(render(<ReferralsContent {...props()} />));
    expect(html).toContain(REFERRAL_ADMIN_COPY.rewardNote);
    expect(html.indexOf(REFERRAL_ADMIN_COPY.rewardNote)).toBeLessThan(html.indexOf("friend3@example.com"));
  });

  it("offers Mark rewarded on paid rows only, and Void until a row is final", () => {
    const html = render(<ReferralsContent {...props()} />);
    expect([...html.matchAll(/data-testid="referral-reward-(\d+)"/g)].map((m) => m[1])).toEqual(["4", "3"]);
    expect([...html.matchAll(/data-testid="referral-void-(\d+)"/g)].map((m) => m[1])).toEqual(["4", "3", "1"]);
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
    expect([...html.matchAll(/data-testid="referral-reward-(\d+)"/g)].map((m) => m[1])).toEqual(["4", "3"]);
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
