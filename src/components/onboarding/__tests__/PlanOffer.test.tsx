import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PLAN_COPY } from "@/lib/onboarding/plan";

// next/font only runs inside Next's compiler: here the faces are plain class names.
vi.mock("../planFonts", () => ({ planFace: { variable: "font-plan" }, planHand: { variable: "font-plan-hand" } }));

const { PlanOffer } = await import("../PlanOffer");

/** the markup with its entities read back (apostrophes are escaped) */
const render = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const DATE = "Monday, October 12";
const DAY = "Mon, Oct 12";
const props = { chargeDate: DATE, chargeDay: DAY, onStart: vi.fn(), onContinue: vi.fn() };

describe("the plan screen", () => {
  it("offers the free week: the offer, the bill, the one button, and the renewal said right under it", () => {
    const html = render(<PlanOffer view="offer" {...props} />);
    expect(html).toContain('data-view="offer"');
    expect(html).toMatch(/<h1[^>]*id="plan-title"[^>]*>Agathon Unlimited<\/h1>/);
    expect(html).toContain(PLAN_COPY.grownUp);
    expect(html).toContain(PLAN_COPY.offer);
    // the bill: today nothing, the first charge on its day, then every month
    expect(text(html)).toContain(`${PLAN_COPY.bill.today} ${PLAN_COPY.bill.starts} $0`);
    expect(text(html)).toContain(`${DAY} ${PLAN_COPY.bill.first} $25`);
    expect(text(html)).toContain(`${PLAN_COPY.bill.monthly} ${PLAN_COPY.bill.untilCancel} $25`);
    for (const p of PLAN_COPY.perks) expect(html).toContain(p.text);
    const start = html.indexOf(PLAN_COPY.start);
    const disclosure = html.indexOf(PLAN_COPY.disclosure(DATE));
    expect(start).toBeGreaterThan(-1);
    expect(disclosure).toBeGreaterThan(start);
    expect(html).toMatch(/aria-describedby="plan-disclosure"/);
    expect(html).toContain(`href="${PLAN_COPY.termsLink.href}"`);
    expect(html).toContain(`href="${PLAN_COPY.fairUseLink.href}"`);
    // no free plan: one button, and no way past it but the free week (the header's menu has Account and Sign out)
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(text(html)).not.toMatch(/Maybe later|Continue|Not now/);
    // the refused defaults stay refused
    expect(html).not.toContain("<s>");
  });

  it("shows the board as the student saw it: their working, the tutor's two ticks and its note", () => {
    const html = render(<PlanOffer view="offer" {...props} />);
    expect(html).toMatch(new RegExp(`<figure[^>]*aria-label="${PLAN_COPY.sheet.label}"`));
    expect(html).toContain(PLAN_COPY.sheet.problem);
    for (const step of PLAN_COPY.sheet.steps) expect(html).toContain(step);
    expect(html.match(/<svg/g)).toHaveLength(2);
    // the note is written a glyph at a time, but reads whole, with its spaces
    expect(html.replace(/<[^>]+>/g, "")).toContain(PLAN_COPY.sheet.note);
  });

  it("says what is happening while checkout opens", () => {
    const html = render(<PlanOffer view="offer" {...props} starting />);
    expect(html).toContain(PLAN_COPY.opening);
    expect(html).toContain('aria-busy="true"');
  });

  it("without a checkout: says so, no bill and no charge line, and Continue (the one button) goes on", () => {
    const html = render(<PlanOffer view="soon" {...props} />);
    expect(html).toContain('data-view="soon"');
    expect(html).toContain(PLAN_COPY.soonTitle);
    expect(html).toContain(PLAN_COPY.soonNote);
    expect(html).not.toContain(PLAN_COPY.start);
    expect(html).not.toContain("charged $25");
    expect(html).not.toContain("<dl");
    // nobody is asked to fetch a grown-up for something they cannot start yet
    expect(html).not.toContain(PLAN_COPY.grownUp);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect(html).toContain(PLAN_COPY.continue);
  });

  it("a plan that ended is offered again: welcome back, no free week, and the bill says help uses ink until the first charge", () => {
    const html = render(<PlanOffer view="restart" {...props} />);
    expect(html).toContain('data-view="restart"');
    expect(html).toContain(PLAN_COPY.welcomeBack);
    expect(html).toContain(PLAN_COPY.restartOffer(DAY));
    expect(html).not.toContain(PLAN_COPY.offer);
    expect(text(html)).toContain(`${PLAN_COPY.bill.today} ${PLAN_COPY.bill.restartStarts} $0`);
    expect(text(html)).toContain(`${DAY} ${PLAN_COPY.bill.restartFirst} $25`);
    expect(html).not.toContain(PLAN_COPY.bill.starts);
    expect(html).toContain(PLAN_COPY.restart);
    expect(html).toContain(PLAN_COPY.disclosure(DATE));
    expect(html).toContain(PLAN_COPY.restartNote);
    expect(text(html)).not.toMatch(/Continue/);
  });
});
