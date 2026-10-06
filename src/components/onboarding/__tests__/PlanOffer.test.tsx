import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanOffer } from "../PlanOffer";
import { PLAN_COPY } from "@/lib/onboarding/plan";

/** the markup with its entities read back (apostrophes are escaped) */
const render = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const DATE = "Saturday, October 10";

describe("the plan screen's card", () => {
  it("offers the free trial: the price crossed out, the grown-up, the button, and the renewal said right under it", () => {
    const html = render(<PlanOffer view="offer" chargeDate={DATE} onStart={vi.fn()} onContinue={vi.fn()} />);
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
    expect(start).toBeGreaterThan(-1);
    // in reading order: the button, then what it costs and when
    expect(disclosure).toBeGreaterThan(start);
    // no free plan: no way past it but the free trial (the header's menu has Account and Sign out)
    expect(text(html)).not.toMatch(/Maybe later|Continue/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/aria-describedby="plan-disclosure"/);
    expect(html).toMatch(/id="plan-disclosure"/);
  });

  it("says what is happening while checkout opens", () => {
    const html = render(<PlanOffer view="offer" chargeDate={DATE} starting onStart={vi.fn()} onContinue={vi.fn()} />);
    expect(html).toContain(PLAN_COPY.opening);
    expect(html).toContain('aria-busy="true"');
  });

  it("without a checkout: Coming soon (disabled), no charge line, and Continue goes on", () => {
    const html = render(<PlanOffer view="soon" chargeDate={DATE} onStart={vi.fn()} onContinue={vi.fn()} />);
    expect(html).toContain('data-view="soon"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Coming soon/);
    expect(html).not.toContain(PLAN_COPY.start);
    expect(html).not.toContain("charged $25");
    expect(html).toContain(PLAN_COPY.soonNote);
    // nobody is asked to fetch a grown-up for something they cannot start yet
    expect(html).toContain(PLAN_COPY.soonTitle);
    expect(html).not.toContain(PLAN_COPY.grownUp);
    expect(html).toContain(PLAN_COPY.continue);
  });

  it("a plan that ended is offered again: welcome back, no crossed-out price, and when the first charge is", () => {
    const html = render(<PlanOffer view="restart" chargeDate={DATE} onStart={vi.fn()} onContinue={vi.fn()} />);
    expect(html).toContain('data-view="restart"');
    expect(html).toContain(PLAN_COPY.welcomeBack);
    expect(html).not.toContain("<s>");
    expect(html).not.toContain(PLAN_COPY.free);
    expect(html).toContain(PLAN_COPY.restart);
    expect(html).toContain(PLAN_COPY.disclosure(DATE));
    expect(html).toContain(PLAN_COPY.restartNote);
    expect(text(html)).not.toMatch(/Continue/);
  });
});
