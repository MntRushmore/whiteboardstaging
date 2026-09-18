import { describe, expect, it } from "vitest";
import {
  BILLING_COPY,
  bannerMessageFor,
  canonicalRouteKey,
  creditsBannerStateFor,
  formatCredits,
  formatPrice,
  parseBillingLinks,
  parseCreditSummary,
  parsePlans,
  periodEndLabel,
  planCardsFor,
  remainingTone,
  routeLabel,
  usageRowsFor,
  usedPercent,
  type CreditSummary,
  type Plan,
} from "../viewModel";

const NOW = new Date("2026-09-17T12:00:00Z");

const summary: CreditSummary = {
  plan_id: "free",
  plan_name: "Free",
  monthly_credits: 300,
  used: 40,
  granted: 0,
  remaining: 260,
  period_start: "2026-09-01T00:00:00+00:00",
  period_end: "2026-10-01T00:00:00+00:00",
};

const plans: Plan[] = [
  { id: "pro", name: "Pro", monthly_credits: 12000, price_cents: 2900, sort: 3, active: true },
  { id: "free", name: "Free", monthly_credits: 300, price_cents: 0, sort: 1, active: true },
  { id: "plus", name: "Plus", monthly_credits: 3000, price_cents: 900, sort: 2, active: true },
  { id: "legacy", name: "Legacy", monthly_credits: 1, price_cents: 0, sort: 0, active: false },
];

describe("parseCreditSummary", () => {
  it("accepts a single object or a one-row array and coerces numeric strings", () => {
    expect(parseCreditSummary(summary)).toEqual(summary);
    expect(parseCreditSummary([{ ...summary, used: "40", remaining: "260" }])).toEqual(summary);
  });
  it("returns null for empty or malformed payloads", () => {
    expect(parseCreditSummary(null)).toBeNull();
    expect(parseCreditSummary([])).toBeNull();
    expect(parseCreditSummary({ plan_id: "free" })).toBeNull();
    expect(parseCreditSummary({ ...summary, remaining: "lots" })).toBeNull();
  });
});

describe("parsePlans", () => {
  it("keeps well-formed rows, defaults optional columns, drops junk", () => {
    expect(parsePlans([{ id: "free", name: "Free", monthly_credits: "300" }, { nope: true }, 3])).toEqual([
      { id: "free", name: "Free", monthly_credits: 300, price_cents: 0, sort: 0 },
    ]);
    expect(parsePlans(undefined)).toEqual([]);
  });
  it("keeps string features from the jsonb column and drops the rest", () => {
    const [plan] = parsePlans([{ id: "plus", name: "Plus", monthly_credits: 3000, features: ["Worksheets", 7, null] }]);
    expect(plan.features).toEqual(["Worksheets"]);
    expect(planCardsFor([plan], null)[0].features).toEqual(["Worksheets"]);
  });
  it("hides a feature bullet that only restates the card's credits line", () => {
    const [plan] = parsePlans([
      { id: "plus", name: "Plus", monthly_credits: 3000, features: ["3,000 credits / month", "3000 credits per month", "All AI tutor modes"] },
    ]);
    expect(planCardsFor([plan], null)[0].features).toEqual(["All AI tutor modes"]);
  });
});

describe("parseBillingLinks", () => {
  it("returns {} for absent, blank, invalid JSON, arrays and scalars", () => {
    expect(parseBillingLinks(undefined)).toEqual({});
    expect(parseBillingLinks("")).toEqual({});
    expect(parseBillingLinks("   ")).toEqual({});
    expect(parseBillingLinks("{not json")).toEqual({});
    expect(parseBillingLinks('["https://a.b"]')).toEqual({});
    expect(parseBillingLinks('"https://a.b"')).toEqual({});
  });
  it("keeps only absolute http(s) string values", () => {
    expect(
      parseBillingLinks(
        JSON.stringify({
          plus: "https://buy.stripe.com/plus",
          pro: "http://localhost:3000/pro",
          portal: "javascript:alert(1)",
          nope: 42,
          "bad key!": "https://x.y",
          relative: "/upgrade",
        }),
      ),
    ).toEqual({ plus: "https://buy.stripe.com/plus", pro: "http://localhost:3000/pro" });
  });
});

describe("formatCredits / formatPrice", () => {
  it("formats whole credits with separators and never NaN", () => {
    expect(formatCredits(0)).toBe("0");
    expect(formatCredits(12000)).toBe("12,000");
    expect(formatCredits(2.6)).toBe("3");
    expect(formatCredits(Number.NaN)).toBe("0");
    expect(formatCredits(undefined)).toBe("0");
  });
  it("prices: Free for zero, dollars per month otherwise", () => {
    expect(formatPrice(0)).toBe("Free");
    expect(formatPrice(900)).toBe("$9/month");
    expect(formatPrice(2950)).toBe("$29.50/month");
  });
});

describe("periodEndLabel", () => {
  it("renders the reset date in UTC, adding the year only when it differs", () => {
    expect(periodEndLabel("2026-10-01T00:00:00+00:00", NOW)).toBe("Oct 1");
    expect(periodEndLabel("2027-01-01T00:00:00Z", NOW)).toBe("Jan 1, 2027");
    expect(periodEndLabel("2026-10-01", NOW)).toBe("Oct 1");
  });
  it("is empty for missing or unparsable input", () => {
    expect(periodEndLabel(null, NOW)).toBe("");
    expect(periodEndLabel("someday", NOW)).toBe("");
  });
});

describe("remainingTone / usedPercent", () => {
  it("is ok above 10 %, low at or under 10 %, empty at zero", () => {
    expect(remainingTone(null)).toBe("ok");
    expect(remainingTone(summary)).toBe("ok");
    expect(remainingTone({ ...summary, remaining: 31, used: 269 })).toBe("ok");
    expect(remainingTone({ ...summary, remaining: 30, used: 270 })).toBe("low");
    expect(remainingTone({ ...summary, remaining: 0, used: 300 })).toBe("empty");
    expect(remainingTone({ ...summary, remaining: -5, used: 305 })).toBe("empty");
  });
  it("counts grants toward the month's total", () => {
    // 300 + 200 = 500 total; 50 left is exactly 10 %
    expect(remainingTone({ ...summary, granted: 200, remaining: 50, used: 450 })).toBe("low");
    expect(remainingTone({ ...summary, granted: 200, remaining: 51, used: 449 })).toBe("ok");
  });
  it("percent used is clamped and rounded", () => {
    expect(usedPercent(null)).toBe(0);
    expect(usedPercent(summary)).toBe(13);
    expect(usedPercent({ ...summary, used: 900 })).toBe(100);
    expect(usedPercent({ ...summary, monthly_credits: 0, used: 0, remaining: 0 })).toBe(0);
    expect(usedPercent({ ...summary, monthly_credits: 0, used: 3, remaining: -3 })).toBe(100);
  });
});

describe("planCardsFor", () => {
  it("sorts active plans, marks the current one, and disables paid plans without links", () => {
    const cards = planCardsFor(plans, summary, {});
    expect(cards.map((c) => c.id)).toEqual(["free", "plus", "pro"]);
    expect(cards[0]).toEqual({
      id: "free",
      name: "Free",
      price: "Free",
      credits: "300",
      current: true,
      action: "current",
      features: [],
    });
    expect(cards[1]).toMatchObject({ price: "$9/month", credits: "3,000", current: false, action: "coming-soon" });
    expect(cards[2]).toMatchObject({ price: "$29/month", credits: "12,000", action: "coming-soon" });
    expect(cards.some((c) => "href" in c)).toBe(false);
  });

  it("turns upgrades into links and the current / cheaper plans into portal links", () => {
    const links = { plus: "https://buy.example/plus", pro: "https://buy.example/pro", portal: "https://portal.example/" };
    const onFree = planCardsFor(plans, summary, links);
    expect(onFree[0]).toMatchObject({ action: "current", href: "https://portal.example/" });
    expect(onFree[1]).toMatchObject({ action: "upgrade", href: "https://buy.example/plus" });
    expect(onFree[2]).toMatchObject({ action: "upgrade", href: "https://buy.example/pro" });

    const onPlus = planCardsFor(plans, { ...summary, plan_id: "plus", plan_name: "Plus" }, links);
    expect(onPlus[0]).toMatchObject({ id: "free", action: "downgrade", href: "https://portal.example/" });
    expect(onPlus[1]).toMatchObject({ id: "plus", action: "current" });
    expect(onPlus[2]).toMatchObject({ id: "pro", action: "upgrade" });

    // a checkout link for one plan but no portal: the cheaper plan stays coming-soon
    const onPro = planCardsFor(plans, { ...summary, plan_id: "pro" }, { plus: "https://buy.example/plus" });
    expect(onPro[0]).toMatchObject({ id: "free", action: "coming-soon" });
    expect(onPro[2]).toMatchObject({ id: "pro", action: "current" });
    expect("href" in onPro[2]).toBe(false);
  });

  it("marks nothing current without a summary or when the plan id is unknown", () => {
    expect(planCardsFor(plans, null).every((c) => !c.current)).toBe(true);
    expect(planCardsFor(plans, null).map((c) => c.action)).toEqual(["coming-soon", "coming-soon", "coming-soon"]);
    expect(planCardsFor(plans, { ...summary, plan_id: "ghost" }).every((c) => !c.current)).toBe(true);
  });
});

describe("route labels", () => {
  it("canonicalizes the route spelling", () => {
    expect(canonicalRouteKey("/api/live/recognize")).toBe("live-recognize");
    expect(canonicalRouteKey("live_recognize")).toBe("live-recognize");
    expect(canonicalRouteKey("Live/Check/")).toBe("live-check");
  });
  it("maps every metered route to a human label and falls back to the key", () => {
    expect(routeLabel("/api/live/recognize")).toBe("Handwriting recognition");
    expect(routeLabel("live/check")).toBe("Hint check");
    expect(routeLabel("live/solve")).toBe("Worked solution");
    expect(routeLabel("generate-solution")).toBe("Drawn help");
    expect(routeLabel("/api/generate-worksheet")).toBe("Worksheet");
    expect(routeLabel("voice/analyze-workspace")).toBe("Voice analysis");
    expect(routeLabel("ocr")).toBe("Text recognition");
    expect(routeLabel("check-help-needed")).toBe("Help check");
    expect(routeLabel("/api/something/new")).toBe("something-new");
    expect(routeLabel("")).toBe("Other");
  });
});

describe("usageRowsFor", () => {
  it("builds rows with labels, formatted times and numeric credits (from `units`, or `credits` as an alias)", () => {
    const rows = usageRowsFor(
      [
        { id: "a", route: "/api/live/solve", units: 10, created_at: "2026-09-17T15:04:00Z" },
        { id: 7, route: "generate-worksheet", credits: "20", created_at: "2026-09-16T09:30:00Z" },
      ],
      { timeZone: "UTC" },
    );
    expect(rows).toEqual([
      { id: "a", when: "Sep 17, 3:04 PM", whenIso: "2026-09-17T15:04:00.000Z", what: "Worked solution", credits: 10 },
      { id: "7", when: "Sep 16, 9:30 AM", whenIso: "2026-09-16T09:30:00.000Z", what: "Worksheet", credits: 20 },
    ]);
  });
  it("falls back to the cost table when a row has no credits, and survives missing fields", () => {
    const rows = usageRowsFor([{ route: "live/check" }, { route: "/api/live/check", units: null, created_at: "bad" }], {
      costs: { "/api/live/check": 3 },
      timeZone: "UTC",
    });
    expect(rows[0]).toEqual({ id: "row-0", when: "", whenIso: "", what: "Hint check", credits: 3 });
    expect(rows[1].credits).toBe(3);
    // a real migration row: units wins over the alias
    expect(usageRowsFor([{ route: "ocr", units: 2, credits: 99 }])[0].credits).toBe(2);
    expect(usageRowsFor([])).toEqual([]);
  });
});

describe("banner copy", () => {
  it("shows nothing while ok, the count when low, the reset date when empty", () => {
    expect(bannerMessageFor(null, NOW)).toBeNull();
    expect(bannerMessageFor(summary, NOW)).toBeNull();
    expect(bannerMessageFor({ ...summary, remaining: 12, used: 288 }, NOW)).toBe("You have 12 credits left this month");
    expect(bannerMessageFor({ ...summary, remaining: 1, used: 299 }, NOW)).toBe("You have 1 credit left this month");
    expect(bannerMessageFor({ ...summary, remaining: 0, used: 300 }, NOW)).toBe(
      "You've used this month's credits — upgrade or wait until Oct 1",
    );
    expect(bannerMessageFor({ ...summary, remaining: 0, used: 300, period_end: "" }, NOW)).toBe(
      "You've used this month's credits — upgrade or wait for next month",
    );
  });
  it("banner state names hidden-on-error and hides while ok", () => {
    expect(creditsBannerStateFor(null, true)).toBe("hidden-error");
    expect(creditsBannerStateFor(null, false)).toBe("loading");
    expect(creditsBannerStateFor(summary, false)).toBe("hidden");
    expect(creditsBannerStateFor({ ...summary, remaining: 0 }, false)).toBe("visible");
  });
  it("keeps the copy calm: no exclamation marks, never 'wrong', never an operator's name", () => {
    const strings = [
      BILLING_COPY.low(3),
      BILLING_COPY.empty("Oct 1"),
      BILLING_COPY.empty(""),
      BILLING_COPY.exhausted,
      BILLING_COPY.comingSoonNote,
    ];
    for (const s of strings) {
      expect(s).not.toMatch(/!/);
      expect(s).not.toMatch(/\bwrong\b/i);
      expect(s).not.toMatch(/rushil/i);
    }
  });
});
