import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// A different plan than the real one: everything on the page must follow it.
vi.mock("@/lib/billing/unlimited", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/billing/unlimited")>();
  return { ...real, UNLIMITED_PLAN: { ...real.UNLIMITED_PLAN, name: "Agathon Test Plan", monthlyUsd: 31, trialDays: 10 } };
});

const { default: ParentsPage, metadata } = await import("@/app/(platform)/parents/page");
const { default: PrivacyPage } = await import("@/app/(platform)/privacy/page");
const { landingCopy, LANDING_COPY } = await import("../copy");
const { MAX_KIDS } = await import("@/lib/family/contracts");
const { PLAN_REFERRAL_COPY, REFERRAL_TRIAL_DAYS } = await import("@/lib/billing/planChoice");

const html = renderToStaticMarkup(<ParentsPage />);
/** the page's text, entities read back (apostrophes are escaped) */
const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const text = plain(html);

describe("/parents", () => {
  it("takes the price, the trial and the plan's name from UNLIMITED_PLAN", () => {
    expect(text).toContain("$31");
    expect(text).toContain(`Free for 10 days, then $31 a month for up to ${MAX_KIDS} kids.`);
    expect(text).toContain("Agathon Test Plan");
    // one name for the main button everywhere; the trial's length is said beside it
    expect(text).toContain("Start free trial");
    expect(text).not.toMatch(/Try it free(?! for)|Start your free/);
    expect(text).not.toMatch(/\$25|7-day|7 days|free week/);
    expect(String(metadata.description)).toContain("Free for 10 days");
  });

  it("never writes a price, a trial length or the yearly plan itself", () => {
    const files = [
      ...fs.readdirSync(path.join(__dirname, "..")).filter((f) => /\.(tsx?|css)$/.test(f)).map((f) => path.join(__dirname, "..", f)),
      path.join(__dirname, "../../../app/(platform)/parents/page.tsx"),
      path.join(__dirname, "../../../app/(platform)/parents/opengraph-image.tsx"),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\$\s?25\b|\b25 a month|7-day|\b7 days|\$199|a year|annual/i);
    }
  });

  it("says nothing it cannot back: no testimonials, ratings, user counts or results", () => {
    const words = JSON.stringify(landingCopy({ name: "Agathon Unlimited", monthlyUsd: 25, trialDays: 7 }));
    expect(words).not.toMatch(/\d+\s?%|\b\d[\d,]*\+|testimonial|rated|review|trusted by|thousands|millions|#1|best|guarantee|proven|raise[sd]? (their )?grades/i);
    expect(text).not.toMatch(/★|⭐|4\.\d\/5/);
  });

  it("has one h1 and headings in order", () => {
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });

  it("describes every picture", () => {
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThanOrEqual(3);
    for (const img of imgs) {
      const alt = img.match(/alt="([^"]*)"/)?.[1];
      // the iPad's screen is the one blank alt: the figure around it describes the whole picture
      if (img.includes("board-ipad")) expect(alt).toBe("");
      else expect(alt && alt.length > 20, img).toBe(true);
    }
    expect(html).toMatch(/role="img" aria-label="An Agathon board on an iPad/);
    // How it works' two boards are vector ink: each one is a labelled picture
    const boards = [...html.matchAll(/<figure[^>]*role="img"[^>]*aria-label="([^"]*)"/g)].map((m) => m[1]);
    expect(boards).toHaveLength(3);
    for (const label of boards) expect(label.length).toBeGreaterThan(40);
  });

  it("sends Start to the sign-up form and Sign in to the sign-in form", () => {
    expect(html).toContain('href="/login?mode=signup"');
    expect(html).toContain('href="/login"');
  });

  it("lets a parent pick any grade without a script", () => {
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)];
    expect(radios).toHaveLength(10);
    expect(radios.filter((r) => r[0].includes("checked")).map((r) => r[0].match(/value="(\w+)"/)?.[1])).toEqual(["3"]);
    expect(text).toContain("Times tables");
    expect(text).toContain("Adding to 10");
    expect(text).toContain("Pythagorean theorem");
  });

  it("is in US English, for US parents: practice, math, a check mark", () => {
    expect(text).not.toMatch(/practis|\bmaths\b|\bticks?\b|\bticked\b|\brings?\b|\bringed\b|ring round|colour|centre|\bbrackets?\b|the way round|favourite/i);
    expect(String(metadata.description)).not.toMatch(/\bticks?\b|\brings?\b/);
  });

  it("links the privacy answer to the Privacy Policy", () => {
    expect(html).toContain('href="/privacy"');
  });

  it("says the plan is for up to MAX_KIDS kids, never every kid in the family (a 7th profile is refused)", () => {
    expect(text).not.toMatch(/every kid|whole family|unlimited kids/i);
    expect(LANDING_COPY.pricing.title).toBe(`One plan.\nUp to ${MAX_KIDS} kids.`);
    // the headline says the number; the first line under the price says what each kid gets, not the number again
    expect(LANDING_COPY.pricing.includes[0]).not.toContain(`Up to ${MAX_KIDS} kids`);
    // the FAQ and the profiles feature say the same number
    expect(text).toContain(`One plan covers up to ${MAX_KIDS} kids`);
    expect(text).toContain(`Up to ${MAX_KIDS} kids, each with their own name`);
  });

  it("answers the data question with the Privacy Policy's promises, no fewer caveats", () => {
    const policy = plain(renderToStaticMarkup(<PrivacyPage />));
    const answer = LANDING_COPY.faq.items.find((i) => i.q === "What happens to my child's data?")?.a ?? "";
    // why staff look: the policy says to fix problems AND to make the tutor better
    expect(policy).toContain("We look to fix problems and to make the tutor better");
    expect(answer).toMatch(/to fix a problem or to make the tutor better/);
    expect(policy).toContain("Each look is logged");
    expect(answer).toContain("every look is logged");
    expect(policy).toContain("it is never shared");
    expect(answer).toContain("never shared");
    // deleting: from the Account page, and an active plan is cancelled first
    expect(policy).toMatch(/delete the account at any time from the Account page \(Delete account; if .+ is on, cancel it first\)/);
    expect(answer).toMatch(/delete the account, and everything in it, from your Account page at any time \(if the plan is on, cancel it first\)/);
    expect(policy).toContain("need a parent’s consent");
    expect(answer).toContain("Children under 13 need a parent's consent");
    expect(policy).toContain("We do not use your boards to train AI models");
    expect(answer).toContain("aren't used to train AI models");
  });
});

describe("/parents for a visitor a friend invited", () => {
  const invited = LANDING_COPY.invited;

  it("the server's HTML says the usual trial: the page stays static, the friend's month is swapped in by the island", () => {
    expect(text).toContain(LANDING_COPY.hero.terms);
    for (const words of Object.values(invited)) expect(text).not.toContain(words);
  });

  it("offers the first month free, at the plan's price, for the referral link's trial length", () => {
    expect(invited.terms).toBe(`${PLAN_REFERRAL_COPY.friendLead} with a friend's invite, then $31 a month for up to ${MAX_KIDS} kids. Cancel anytime.`);
    expect(invited.trial).toContain(PLAN_REFERRAL_COPY.friendFree);
    expect(invited.fine).toContain(`Nothing is charged for ${REFERRAL_TRIAL_DAYS} days.`);
    expect(invited.start).toMatch(/free month/);
    expect(invited.closing).toMatch(/first month is free/);
    const card = LANDING_COPY.faq.items.find((i) => "invited" in i);
    expect(card && "invited" in card ? card.invited.a : "").toContain(`nothing is charged for ${REFERRAL_TRIAL_DAYS} days`);
    // nothing in the friend's words is the usual trial
    expect(JSON.stringify(invited)).not.toMatch(/10 days|free 10/);
  });
});
