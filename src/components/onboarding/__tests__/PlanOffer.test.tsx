import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanOffer } from "../PlanOffer";
import { PLAN_COPY } from "@/lib/onboarding/plan";

/** the markup with its entities read back (apostrophes are escaped) */
const render = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const DATE = "Saturday, October 10";

describe("the plan screen's card", () => {
  it("offers the free week: the price crossed out, the grown-up, the button, and the renewal said right under it", () => {
    const html = render(<PlanOffer view="offer" chargeDate={DATE} onStart={vi.fn()} onLater={vi.fn()} />);
    expect(html).toContain('data-view="offer"');
    expect(html).toMatch(/<h1[^>]*id="plan-title"[^>]*>Agathon Unlimited<\/h1>/);
    expect(html).toContain("<s>$25/month</s>");
    // a screen reader hears that the crossed-out price is the usual one
    expect(text(html)).toContain("Usually $25/month");
    expect(html).toContain(PLAN_COPY.free);
    expect(html).toContain(PLAN_COPY.then);
    for (const p of PLAN_COPY.perks) expect(html).toContain(p.text);
    expect(html).toContain(PLAN_COPY.grownUp);
    const start = html.indexOf(PLAN_COPY.start);
    const disclosure = html.indexOf(PLAN_COPY.disclosure(DATE));
    const later = html.indexOf(PLAN_COPY.later);
    expect(start).toBeGreaterThan(-1);
    // in reading order: the button, what it costs and when, then the way out
    expect(disclosure).toBeGreaterThan(start);
    expect(later).toBeGreaterThan(disclosure);
    expect(html).toMatch(/aria-describedby="plan-disclosure"/);
    expect(html).toMatch(/id="plan-disclosure"/);
  });

  it("says what is happening while checkout opens", () => {
    const html = render(<PlanOffer view="offer" chargeDate={DATE} starting onStart={vi.fn()} onLater={vi.fn()} />);
    expect(html).toContain(PLAN_COPY.opening);
    expect(html).toContain('aria-busy="true"');
  });

  it("without a checkout: Coming soon (disabled), no charge line, and Continue goes on", () => {
    const html = render(<PlanOffer view="soon" chargeDate={DATE} onStart={vi.fn()} onLater={vi.fn()} />);
    expect(html).toContain('data-view="soon"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Coming soon/);
    expect(html).not.toContain(PLAN_COPY.start);
    expect(html).not.toContain("charged $25");
    expect(html).toContain(PLAN_COPY.soonNote);
    // nobody is asked to fetch a grown-up for something they cannot start yet
    expect(html).toContain(PLAN_COPY.soonTitle);
    expect(html).not.toContain(PLAN_COPY.grownUp);
    expect(html).toContain(PLAN_COPY.continue);
    expect(html).not.toContain(PLAN_COPY.later);
  });
});
