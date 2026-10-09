import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * /parents as a visitor a friend invited sees it once the island has run: every line about the trial
 * says the friend's free first month, and none says the usual trial (the invite link they were sent
 * promised a month; checkout gives them one). The island itself is tested in trialWords.test.tsx.
 */

// the island, with the friend's offer on: it shows the invited words
vi.mock("../TrialWords", () => ({
  TrialWords: ({ invited }: { usual: string; invited: string }) => invited,
}));

const { default: ParentsPage } = await import("@/app/(platform)/parents/page");
const { LANDING_COPY } = await import("../copy");
const { UNLIMITED_PLAN } = await import("@/lib/billing/unlimited");
const { planWords } = await import("@/lib/landing/plan");

const text = renderToStaticMarkup(<ParentsPage />)
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

describe("/parents, for a visitor a friend invited", () => {
  it("says the first month is free in the hero, the pricing card, the card question and the closing", () => {
    const invited = LANDING_COPY.invited;
    for (const words of [invited.start, invited.terms, invited.trial, invited.fine, invited.closing]) expect(text, words).toContain(words);
    expect(text).toContain("Do I need a card for the free month?");
  });

  it("never also says the usual trial (UNLIMITED_PLAN.trialDays) to them", () => {
    const usual = planWords(UNLIMITED_PLAN);
    expect(text).not.toContain(`${UNLIMITED_PLAN.trialDays} days`);
    expect(text).not.toContain(usual.start);
    expect(text).not.toContain(`free ${usual.trial}`);
  });

  it("keeps the price and the kid limit", () => {
    expect(text).toContain(planWords(UNLIMITED_PLAN).then);
  });
});
