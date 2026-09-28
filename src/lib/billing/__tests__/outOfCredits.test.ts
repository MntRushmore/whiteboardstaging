import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { classifyLiveFailure } from "@/components/live/errorView";
import { chatErrorFor } from "@/components/chat/chatView";
import { OUT_OF_CREDITS_COPY, creditsResetLabel, nextCreditReset, upgradeLeadFor, upgradeOptionsFor } from "../outOfCredits";
import { PEN_REST_MS, creditsDialogWanted, penIsResting } from "../creditsDialog";
import { parsePlans, type CreditSummary } from "../viewModel";

const NOW = new Date("2026-09-28T12:00:00Z");

const plans = parsePlans([
  { id: "free", name: "Free", monthly_credits: 300, price_cents: 0, sort: 0, active: true },
  { id: "plus", name: "Plus", monthly_credits: 3000, price_cents: 900, sort: 1, active: true },
  { id: "pro", name: "Pro", monthly_credits: 12000, price_cents: 2900, sort: 2, active: true },
]);

const free: CreditSummary = {
  plan_id: "free",
  plan_name: "Free",
  monthly_credits: 300,
  used: 300,
  granted: 0,
  remaining: 0,
  period_start: "2026-09-01T00:00:00Z",
  period_end: "2026-10-01T00:00:00Z",
  billing_status: null,
  current_period_end: null,
};

const links = {
  plus: "https://buy.stripe.com/plus?client_reference_id=u",
  pro: "https://buy.stripe.com/pro?client_reference_id=u",
  portal: "https://billing.stripe.com/p/login/x",
};

describe("when credits come back", () => {
  it("is the 1st of next month in UTC, even late on the last day in the Americas", () => {
    expect(nextCreditReset(NOW).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(nextCreditReset(new Date("2026-12-31T23:30:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(nextCreditReset(new Date("2026-09-30T23:59:59-07:00")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
  it("reads period_end when the summary is there, and falls back to the 1st otherwise", () => {
    expect(creditsResetLabel(free, NOW)).toBe("Oct 1");
    expect(creditsResetLabel(null, NOW)).toBe("Oct 1");
    expect(creditsResetLabel(null, new Date("2026-12-15T00:00:00Z"))).toBe("Jan 1, 2027");
  });
  it("puts the date in the dialog's words", () => {
    expect(OUT_OF_CREDITS_COPY.body("Oct 1")).toContain("reset on Oct 1");
  });
});

describe("upgradeOptionsFor", () => {
  it("offers every bigger paid plan's Payment Link to a free user", () => {
    const options = upgradeOptionsFor(plans, free, links);
    expect(options.map((o) => [o.planId, o.label, o.href])).toEqual([
      ["plus", "Upgrade to Plus", links.plus],
      ["pro", "Upgrade to Pro", links.pro],
    ]);
    expect(options[1].detail).toBe("12,000 credits a month · $29/month");
    expect(upgradeLeadFor(options, free)).toBe(OUT_OF_CREDITS_COPY.upgradeLead);
  });
  it("sends a subscriber to the portal to switch (never a second Payment Link)", () => {
    const plus = { ...free, plan_id: "plus", plan_name: "Plus", monthly_credits: 3000, billing_status: "active" };
    const options = upgradeOptionsFor(plans, plus, links);
    expect(options).toEqual([expect.objectContaining({ planId: "pro", label: "Switch to Pro", href: links.portal })]);
    expect(upgradeLeadFor(options, plus)).toBe(OUT_OF_CREDITS_COPY.switchLead);
  });
  it("offers nothing on the biggest plan or without links", () => {
    const pro = { ...free, plan_id: "pro", plan_name: "Pro", monthly_credits: 12000, billing_status: "active" };
    expect(upgradeOptionsFor(plans, pro, links)).toEqual([]);
    expect(upgradeLeadFor([], pro)).toBe(OUT_OF_CREDITS_COPY.noUpgrade);
    expect(upgradeOptionsFor(plans, free, {})).toEqual([]);
    expect(upgradeLeadFor([], free)).toBeNull();
  });
  it("still offers upgrades before the summary has loaded", () => {
    expect(upgradeOptionsFor(plans, null, links).map((o) => o.planId)).toEqual(["plus", "pro"]);
  });
});

describe("the 402 -> dialog mapping", () => {
  it("a Live 402 becomes a 'credits' error, which asks for the dialog once", () => {
    const fields = classifyLiveFailure(new ApiError("You have used this month's credits.", 402, "credits_exhausted"), { kind: "recognize", online: true });
    expect(fields?.code).toBe("credits");
    expect(creditsDialogWanted(fields, false)).toBe(true);
    expect(creditsDialogWanted(fields, true)).toBe(false);
  });
  it("other Live failures never open it", () => {
    for (const err of [new ApiError("slow down", 429, "rate_limited"), new ApiError("x", 502, "upstream_error"), new ApiError("x", 401, "unauthorized")]) {
      expect(creditsDialogWanted(classifyLiveFailure(err, { kind: "check", online: true }), false)).toBe(false);
    }
    expect(creditsDialogWanted(null, false)).toBe(false);
  });
  it("the Ask panel's 402 uses the dialog's words", () => {
    expect(chatErrorFor(new ApiError("x", 402, "credits_exhausted"))).toEqual({ kind: "credits", message: OUT_OF_CREDITS_COPY.title, retry: false });
  });
});

describe("penIsResting (never mid-stroke)", () => {
  it("waits while a pointer is down, and for a quiet moment after the last stroke", () => {
    expect(penIsResting({ pointerDown: true, lastPenAt: 0, now: 60_000 })).toBe(false);
    expect(penIsResting({ pointerDown: false, lastPenAt: 10_000, now: 10_000 + PEN_REST_MS - 1 })).toBe(false);
    expect(penIsResting({ pointerDown: false, lastPenAt: 10_000, now: 10_000 + PEN_REST_MS })).toBe(true);
  });
});
