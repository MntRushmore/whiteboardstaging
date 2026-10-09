/**
 * The admin Referrals page as data (src/lib/referral/admin.ts): admin_referrals()'s answer checked
 * and renamed, the abuse flag, which buttons a row may show (a reward only once the friend's plan is
 * active and its first payment has settled: rewardGate), the friend's plan, the tiles and filters,
 * and the change a mark makes at once on the page.
 */
import { describe, expect, it } from "vitest";
import { REFERRAL_ADMIN_COPY } from "../copy";
import {
  AdminReferralListSchema,
  ReferralRpcListSchema,
  applyReferralMark,
  buildReferralsView,
  canMark,
  countsOf,
  defaultReferralFilter,
  looksLikeSamePerson,
  mailboxOf,
  REFERRAL_SETTLE_DAYS,
  referralRow,
  rewardFrom,
  rewardGate,
  toAdminReferralList,
  type AdminReferral,
  type AdminReferralList,
} from "../admin";

const NOW = Date.parse("2026-10-09T18:00:00Z");
const clock = { now: NOW, timeZone: "America/New_York" };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function rpcEntry(id: number, status: string, over: Record<string, unknown> = {}) {
  return {
    id,
    code: "BCDF2345",
    status,
    created_at: "2026-10-09T15:00:00Z",
    paid_at: status === "paid" || status === "rewarded" ? "2026-10-09T16:00:00Z" : null,
    rewarded_at: status === "rewarded" ? "2026-10-09T17:00:00Z" : null,
    updated_at: "2026-10-09T17:00:00Z",
    rewarded_by_email: status === "rewarded" ? "owner@agathon.app" : null,
    referrer: { id: A, email: "parent@example.com", created_at: "2026-09-01T00:00:00Z", customer_id: "cus_A", payer_email: "parent@example.com" },
    referred: { id: B, email: `friend${id}@example.com`, created_at: "2026-10-09T15:00:00Z", payer_email: null, plan_status: status === "paid" ? "active" : null, trial_end: null },
    ...over,
  };
}

const RPC = {
  generated_at: "2026-10-09T18:00:00Z",
  counts: { signed_up: 1, trialing: 1, paid: 1, rewarded: 1, void: 1 },
  truncated: false,
  referrals: [rpcEntry(5, "void"), rpcEntry(4, "rewarded"), rpcEntry(3, "paid"), rpcEntry(2, "trialing"), rpcEntry(1, "signed_up")],
};

const list = (): AdminReferralList => toAdminReferralList(ReferralRpcListSchema.parse(RPC));

describe("admin_referrals()'s answer", () => {
  it("is checked, then renamed into the route's shape (which the page checks again)", () => {
    const out = list();
    expect(AdminReferralListSchema.safeParse(out).success).toBe(true);
    expect(out.referrals[2]).toEqual({
      id: 3,
      code: "BCDF2345",
      status: "paid",
      createdAt: "2026-10-09T15:00:00Z",
      paidAt: "2026-10-09T16:00:00Z",
      rewardedAt: null,
      updatedAt: "2026-10-09T17:00:00Z",
      rewardedByEmail: null,
      referrer: { id: A, email: "parent@example.com", createdAt: "2026-09-01T00:00:00Z", payerEmail: "parent@example.com", customerId: "cus_A" },
      referred: { id: B, email: "friend3@example.com", createdAt: "2026-10-09T15:00:00Z", payerEmail: null, planStatus: "active", trialEnd: null },
    });
  });

  it("reads the friend's trial end, and its absence (a database before 20261009140000) as unknown", () => {
    const withTrial = ReferralRpcListSchema.parse({ ...RPC, referrals: [rpcEntry(3, "paid", { referred: { ...rpcEntry(3, "paid").referred, trial_end: "2026-10-09T15:00:00Z" } })] });
    expect(toAdminReferralList(withTrial).referrals[0].referred.trialEnd).toBe("2026-10-09T15:00:00Z");
    const { trial_end: _dropped, ...older } = rpcEntry(3, "paid").referred;
    void _dropped;
    const without = ReferralRpcListSchema.parse({ ...RPC, referrals: [rpcEntry(3, "paid", { referred: older })] });
    expect(toAdminReferralList(without).referrals[0].referred.trialEnd).toBeNull();
  });

  it("refuses an unknown status, a bad code or a missing count", () => {
    expect(ReferralRpcListSchema.safeParse({ ...RPC, referrals: [rpcEntry(1, "paying")] }).success).toBe(false);
    expect(ReferralRpcListSchema.safeParse({ ...RPC, referrals: [rpcEntry(1, "paid", { code: "lower" })] }).success).toBe(false);
    expect(ReferralRpcListSchema.safeParse({ ...RPC, counts: { paid: 1 } }).success).toBe(false);
  });
});

describe("the same person twice", () => {
  it("reads an address as a mailbox: case, +tags, and Gmail's dots", () => {
    expect(mailboxOf(" Jo.Smith+kids@Gmail.com ")).toBe("josmith@gmail.com");
    expect(mailboxOf("jo.smith@googlemail.com")).toBe("josmith@gmail.com");
    expect(mailboxOf("jo.smith+x@example.com")).toBe("jo.smith@example.com");
    expect(mailboxOf("nope")).toBeNull();
    expect(mailboxOf(null)).toBeNull();
  });

  it("flags a friend whose account or payer address is the referrer's", () => {
    const base = list().referrals[2];
    expect(looksLikeSamePerson(base)).toBe(false);
    expect(looksLikeSamePerson({ ...base, referred: { ...base.referred, email: "parent+2@example.com" } })).toBe(true);
    expect(looksLikeSamePerson({ ...base, referred: { ...base.referred, payerEmail: "Parent@Example.com" } })).toBe(true);
    expect(looksLikeSamePerson({ ...base, referrer: { ...base.referrer, payerEmail: "p.a.r.e.n.t@gmail.com" }, referred: { ...base.referred, email: "parent@gmail.com" } })).toBe(true);
  });
});

describe("what may be done", () => {
  it("rewards only a paid referral, and voids anything not yet final", () => {
    expect(canMark("paid", "rewarded")).toBe(true);
    for (const s of ["signed_up", "trialing", "rewarded", "void"] as const) expect(canMark(s, "rewarded")).toBe(false);
    for (const s of ["signed_up", "trialing", "paid"] as const) expect(canMark(s, "void")).toBe(true);
    for (const s of ["rewarded", "void"] as const) expect(canMark(s, "void")).toBe(false);
  });

  it("waits REFERRAL_SETTLE_DAYS (3) after the later of paid_at and the trial end", () => {
    expect(REFERRAL_SETTLE_DAYS).toBe(3);
    const paid = list().referrals[2];
    expect(rewardFrom(paid)).toBe("2026-10-12T16:00:00.000Z");
    expect(rewardFrom({ ...paid, referred: { ...paid.referred, trialEnd: "2026-10-10T00:00:00Z" } })).toBe("2026-10-13T00:00:00.000Z");
    expect(rewardFrom({ ...paid, referred: { ...paid.referred, trialEnd: "2026-10-01T00:00:00Z" } })).toBe("2026-10-12T16:00:00.000Z");
    expect(rewardFrom({ ...paid, paidAt: null, referred: { ...paid.referred, trialEnd: "2026-10-01T00:00:00Z" } })).toBe("2026-10-04T00:00:00.000Z");
    expect(rewardFrom({ ...paid, paidAt: null })).toBeNull();
  });

  describe("rewardGate: the guard on Mark rewarded", () => {
    const paid = list().referrals[2];
    const settled = Date.parse("2026-10-12T16:00:00Z");

    it("allows a paid referral whose friend's plan is active 3 days after it was paid", () => {
      expect(rewardGate(paid, settled)).toEqual({ ok: true });
      expect(rewardGate(paid, settled + 86_400_000)).toEqual({ ok: true });
    });

    it("waits while the first charge may still fail, and says until when", () => {
      expect(rewardGate(paid, NOW)).toEqual({ ok: false, why: "settling", from: "2026-10-12T16:00:00.000Z" });
      expect(rewardGate(paid, settled - 1)).toMatchObject({ ok: false, why: "settling" });
      // the trial ended after it was marked paid: the later one counts
      const lateTrial = { ...paid, referred: { ...paid.referred, trialEnd: "2026-10-11T00:00:00Z" } };
      expect(rewardGate(lateTrial, settled)).toEqual({ ok: false, why: "settling", from: "2026-10-14T00:00:00.000Z" });
      // no date to count from: never yet
      expect(rewardGate({ ...paid, paidAt: null }, settled)).toEqual({ ok: false, why: "settling", from: null });
    });

    it("refuses while the friend's plan is not active, however long ago it was paid", () => {
      for (const planStatus of ["past_due", "unpaid", "canceled", "incomplete_expired", "paused", "trialing", "incomplete", null]) {
        expect(rewardGate({ ...paid, referred: { ...paid.referred, planStatus } }, settled + 30 * 86_400_000)).toEqual({ ok: false, why: "plan" });
      }
    });

    it("refuses any referral that is not paid", () => {
      for (const r of list().referrals.filter((x) => x.status !== "paid")) {
        expect(rewardGate({ ...r, referred: { ...r.referred, planStatus: "active" } }, settled)).toEqual({ ok: false, why: "status" });
      }
    });
  });

  it("opens on the rewards due when there are some", () => {
    expect(defaultReferralFilter({ signed_up: 3, trialing: 0, paid: 1, rewarded: 0, void: 0 })).toBe("due");
    expect(defaultReferralFilter({ signed_up: 3, trialing: 2, paid: 0, rewarded: 4, void: 1 })).toBe("all");
  });
});

describe("buildReferralsView", () => {
  it("has the tiles: due (urgent), trialing, rewarded, signed up less voided", () => {
    const view = buildReferralsView(list(), "all", clock);
    expect(view.tiles.map((t) => [t.key, t.value, t.urgent])).toEqual([
      ["due", "1", true],
      ["trialing", "1", false],
      ["rewarded", "1", false],
      ["signed_up", "4", false],
    ]);
  });

  it("counts each filter and keeps only its rows, newest first", () => {
    const view = buildReferralsView(list(), "due", clock);
    expect(view.filters.map((f) => [f.key, f.count])).toEqual([
      ["due", "1"],
      ["trial", "2"],
      ["rewarded", "1"],
      ["void", "1"],
      ["all", "5"],
    ]);
    expect(view.rows.map((r) => r.id)).toEqual([3]);
    expect(buildReferralsView(list(), "trial", clock).rows.map((r) => r.id)).toEqual([2, 1]);
    expect(buildReferralsView(list(), "all", clock).rows.map((r) => r.id)).toEqual([5, 4, 3, 2, 1]);
  });

  it("is empty with no referrals, and says when the list was cut", () => {
    expect(buildReferralsView({ ...list(), referrals: [], counts: countsOf([]) }, "all", clock).empty).toBe(true);
    expect(buildReferralsView({ ...list(), truncated: true }, "all", clock).truncatedNote).toBe(REFERRAL_ADMIN_COPY.truncated(5));
  });

  it("follows a change made on the page in its counts (the list is whole)", () => {
    const l = list();
    const marked = { ...l, referrals: l.referrals.map((r) => (r.id === 3 ? applyReferralMark(r, "rewarded", "2026-10-09T18:00:00Z", "me@agathon.app") : r)) };
    const view = buildReferralsView(marked, "due", clock);
    expect(view.tiles[0]).toMatchObject({ value: "0", urgent: false });
    expect(view.rows).toEqual([]);
  });
});

describe("referralRow", () => {
  it("shows a settled paid referral as due, with the referrer's Stripe customer, the friend's plan and both buttons", () => {
    const row = referralRow(list().referrals[2], { ...clock, now: Date.parse("2026-10-12T17:00:00Z") });
    expect(row).toMatchObject({
      statusLabel: REFERRAL_ADMIN_COPY.statuses.paid,
      statusTone: "warn",
      referrer: { email: "parent@example.com", payer: null, customerId: "cus_A" },
      friend: { email: "friend3@example.com", payer: null },
      friendPlan: REFERRAL_ADMIN_COPY.friendPlan(REFERRAL_ADMIN_COPY.planWords.active),
      friendPlanAlarm: false,
      paid: "Oct 9",
      rewarded: null,
      samePerson: false,
      canReward: true,
      rewardWait: null,
      canVoid: true,
    });
  });

  it("holds back Mark rewarded on a paid referral that has not settled, and says until when", () => {
    const row = referralRow(list().referrals[2], clock);
    expect(row).toMatchObject({ joined: "Today", paid: "Today", canReward: false, canVoid: true, rewardWait: REFERRAL_ADMIN_COPY.rewardFrom("Oct 12") });
    expect(row.rewardWaitTitle).toContain("Oct 12");
  });

  it("holds it back while the friend's plan is failing, and marks the plan", () => {
    const paid = list().referrals[2];
    const row = referralRow({ ...paid, referred: { ...paid.referred, planStatus: "past_due" } }, { ...clock, now: Date.parse("2026-10-20T00:00:00Z") });
    expect(row).toMatchObject({
      canReward: false,
      rewardWait: REFERRAL_ADMIN_COPY.rewardPlanNotActive,
      friendPlan: REFERRAL_ADMIN_COPY.friendPlan(REFERRAL_ADMIN_COPY.planWords.past_due),
      friendPlanAlarm: true,
    });
  });

  it("says when the friend has no plan, or one in a status it does not know, and no wait off a paid row", () => {
    const trial = list().referrals[3];
    expect(referralRow(trial, clock)).toMatchObject({ friendPlan: REFERRAL_ADMIN_COPY.noPlan, friendPlanAlarm: false, rewardWait: null, canReward: false });
    expect(referralRow({ ...trial, referred: { ...trial.referred, planStatus: "weird" } }, clock).friendPlan).toBe(REFERRAL_ADMIN_COPY.friendPlan("weird"));
  });

  it("names a checkout's other address, and who rewarded it and when", () => {
    const rewarded = list().referrals[1];
    const row = referralRow({ ...rewarded, referred: { ...rewarded.referred, payerEmail: "billing@example.com" } }, clock);
    expect(row.friend.payer).toBe(REFERRAL_ADMIN_COPY.payer("billing@example.com"));
    expect(row.rewarded).toBe(REFERRAL_ADMIN_COPY.rewardedBy("owner@agathon.app", "today"));
    expect(row.canReward || row.canVoid).toBe(false);
  });

  it("says when an account is gone", () => {
    const r = list().referrals[0];
    expect(referralRow({ ...r, referred: { ...r.referred, email: null } }, clock).friend.email).toBe(REFERRAL_ADMIN_COPY.noEmail);
  });
});

describe("applyReferralMark", () => {
  const paid: AdminReferral = list().referrals[2];

  it("rewards a paid referral at once, by the admin", () => {
    expect(applyReferralMark(paid, "rewarded", "2026-10-09T18:00:00Z", "me@agathon.app")).toMatchObject({ status: "rewarded", rewardedAt: "2026-10-09T18:00:00Z", rewardedByEmail: "me@agathon.app" });
  });

  it("voids, and changes nothing the status does not allow", () => {
    expect(applyReferralMark(paid, "void", "2026-10-09T18:00:00Z", null).status).toBe("void");
    const rewarded = list().referrals[1];
    expect(applyReferralMark(rewarded, "void", "2026-10-09T18:00:00Z", null)).toBe(rewarded);
  });
});
