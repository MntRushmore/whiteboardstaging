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
const { SIGN_UP_HREF } = await import("@/lib/landing/links");
const { JOIN_ID } = await import("../bands");
const { TRY_PATH } = await import("@/lib/try/contracts");

const html = renderToStaticMarkup(<ParentsPage />);
/** the page's text, entities read back (apostrophes are escaped) */
const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const text = plain(html);

/** Every link on the page: its href and its words. */
const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
  href: m[1].match(/href="([^"]*)"/)?.[1] ?? "",
  words: plain(m[2]).trim(),
}));

/** The markup from the element with `id` to the end of its section (the next `</section>` at its depth). */
function sectionById(id: string): string {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return "";
  const open = html.lastIndexOf("<section", start);
  let depth = 0;
  const tag = /<(\/?)section\b/g;
  tag.lastIndex = open;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index);
  }
  return html.slice(open);
}

describe("/parents", () => {
  it("takes the price, the trial and the plan's name from UNLIMITED_PLAN", () => {
    expect(text).toContain("$31");
    expect(text).toContain(`Free for 10 days, then $31 a month for up to ${MAX_KIDS} kids.`);
    expect(text).toContain("Agathon Test Plan");
    expect(text).toContain("Free for the first 10 days.");
    // one name for the main button everywhere; the trial's length is said beside it
    expect(text).toContain("Join Agathon");
    expect(text).not.toMatch(/Start free trial|Start your free/);
    // "Try it free" names the free board anyone can write on (/try), never the trial: only its links say it
    const tryWords = text.match(/Try it free(?! for)/g) ?? [];
    expect(tryWords.length).toBeGreaterThan(0);
    expect(links.filter((l) => l.href === TRY_PATH && l.words === "Try it free")).toHaveLength(tryWords.length);
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
    // a count is a number with a "+" after it and then a space or the end ("10,000+ families"); the
    // maths on the page ("3+2=5", "3x+5=20") is not a count
    expect(words).not.toMatch(/\d+\s?%|\b\d[\d,]*\+(?=\s|$|[".,;:!?)])|testimonial|rated|review|trusted by|thousands|millions|#1|best|guarantee|proven|raise[sd]? (their )?grades/i);
    expect(text).not.toMatch(/★|⭐|4\.\d\/5/);
    // the tightened count still catches a count
    expect("Loved by 10,000+ families").toMatch(/\b\d[\d,]*\+(?=\s|$|[".,;:!?)])/);
    expect('"1000+"').toMatch(/\b\d[\d,]*\+(?=\s|$|[".,;:!?)])/);
  });

  it("has exactly one h1, the hero's, and headings in order", () => {
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    expect(plain(h1).trim()).toBe(LANDING_COPY.hero.title);
  });

  it("writes the hero's title from its parts, so the ink marks the words the title says", () => {
    expect(LANDING_COPY.hero.titleParts.join(" ")).toBe(LANDING_COPY.hero.title);
    expect(LANDING_COPY.hero.titleParts[2]).toBe("actually");
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
    // every labelled picture (the iPad, How it works' boards, and whatever the other parts add)
    // says what is in it, and the hero's iPad is one of them
    const pictures = [...html.matchAll(/role="img"[^>]*?aria-label="([^"]*)"|aria-label="([^"]*)"[^>]*?role="img"/g)].map((m) => m[1] ?? m[2]);
    expect(pictures.length).toBeGreaterThanOrEqual(3);
    for (const label of pictures) expect(label.length, label).toBeGreaterThan(40);
    expect(pictures).toContain(LANDING_COPY.replay.label);
  });

  it("sends Join to the sign-up form and Sign in to the sign-in form", () => {
    expect(html).toContain('href="/login?mode=signup"');
    expect(html).toContain('href="/login"');
  });

  it("calls every way in Join Agathon: the bar, the hero, the pricing card, the Join band and the phone's bottom bar", () => {
    const joins = links.filter((l) => l.href === SIGN_UP_HREF);
    expect(joins.length).toBeGreaterThanOrEqual(5);
    for (const link of joins) expect(link.words).toBe("Join Agathon");
    const copy = LANDING_COPY;
    expect(new Set([copy.nav.cta, copy.hero.start, copy.pricing.start, copy.join.start, copy.sticky.start])).toEqual(new Set(["Join Agathon"]));
    // the Join band has the button, Sign in and the terms
    const join = sectionById(JOIN_ID);
    expect(join).toContain(`href="${SIGN_UP_HREF}"`);
    expect(plain(join)).toContain("Join Agathon");
    expect(plain(join)).toContain(copy.join.aside);
    expect(join).toContain('href="/login"');
    expect(plain(join)).toContain(copy.join.terms);
    // the bottom bar says the trial beside its button
    expect(text).toContain(`${copy.sticky.note} Join Agathon`);
  });

  it("points the bar's links at parts that are on the page", () => {
    const nav = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
    for (const link of LANDING_COPY.nav.links) {
      expect(nav, link.label).toContain(`href="#${link.id}"`);
      expect(html.match(new RegExp(`\\bid="${link.id}"`, "g")), link.id).toHaveLength(1);
    }
    // and "See how it works" too
    expect(html).toContain(`href="#${LANDING_COPY.nav.links[0].id}"`);
  });

  it("says agathon.app itself is the page's address (the root rewrite serves it there)", () => {
    expect(metadata.alternates?.canonical).toBe("/");
    expect(metadata.openGraph?.url).toBe("/");
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

  it("answers whether it is only for math", () => {
    const item = LANDING_COPY.faq.items.find((i) => i.q === "Is it only for math?");
    expect(item?.a).toContain("The board is for math.");
    expect(text).toContain("Is it only for math?");
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
    expect(text).toContain(LANDING_COPY.sticky.note);
    for (const words of Object.values(invited)) expect(text).not.toContain(words);
  });

  it("offers the first month free, at the plan's price, for the referral link's trial length", () => {
    expect(invited.terms).toBe(`${PLAN_REFERRAL_COPY.friendLead} with a friend's invite, then $31 a month for up to ${MAX_KIDS} kids. Cancel anytime.`);
    expect(invited.trial).toContain(PLAN_REFERRAL_COPY.friendFree);
    expect(invited.fine).toContain(`Nothing is charged for ${REFERRAL_TRIAL_DAYS} days.`);
    expect(invited.start).toMatch(/free month/);
    expect(invited.sticky).toBe(PLAN_REFERRAL_COPY.friendFree);
    const card = LANDING_COPY.faq.items.find((i) => "invited" in i);
    expect(card && "invited" in card ? card.invited.a : "").toContain(`nothing is charged for ${REFERRAL_TRIAL_DAYS} days`);
    // nothing in the friend's words is the usual trial
    expect(JSON.stringify(invited)).not.toMatch(/10 days|free 10/);
  });
});
