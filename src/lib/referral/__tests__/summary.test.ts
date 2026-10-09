/**
 * The grown-up's card as data (src/lib/referral/summary.ts) and its one read
 * (src/lib/referral/client.ts): the RPC's answer checked, the link built for this deployment, and
 * the lines the card shows, with and without the friend's free month on sale.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { REFERRAL_COPY } from "../contracts";
import { readReferralSummary } from "../client";
import { REFERRAL_CARD_COPY } from "../copy";
import { ReferralSummaryRpcSchema, referralCardView, referralUrl, shownLink, siteBase, summaryLine, toReferralSummary } from "../summary";

const RPC = { code: "BCDF2345", signed_up: 2, paid: 1, months_earned: 1, months_pending: 0 };

describe("siteBase", () => {
  it("uses NEXT_PUBLIC_SITE_URL first, without a trailing slash", () => {
    expect(siteBase("https://agathon.app/", "https://www.agathon.app")).toBe("https://agathon.app");
    expect(siteBase("https://example.com/app/", null)).toBe("https://example.com/app");
  });

  it("falls back to the page's origin when the env is unset or not an http(s) address", () => {
    expect(siteBase(undefined, "https://preview-123.vercel.app")).toBe("https://preview-123.vercel.app");
    expect(siteBase("  ", "https://agathon.app")).toBe("https://agathon.app");
    expect(siteBase("not a url", "https://agathon.app")).toBe("https://agathon.app");
    expect(siteBase("ftp://agathon.app", "https://agathon.app")).toBe("https://agathon.app");
  });

  it("skips a template's placeholder site for the page's own origin (the share card's footer too)", () => {
    expect(siteBase("https://your-app.up.railway.app", "https://agathon.app")).toBe("https://agathon.app");
    expect(siteBase("https://your-app.up.railway.app", null)).toBeNull();
    // a real site is still honored first
    expect(siteBase("https://agathon.app", "https://agathon-git-main.vercel.app")).toBe("https://agathon.app");
  });

  it("hands out the dev server's own address on localhost", () => {
    expect(siteBase("https://agathon.app", "http://localhost:3216")).toBe("http://localhost:3216");
    expect(siteBase("https://agathon.app", "http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });

  it("is null when nothing is usable", () => {
    expect(siteBase(null, null)).toBeNull();
    expect(siteBase("nope", "also nope")).toBeNull();
  });
});

describe("the link", () => {
  it("is the home with the code", () => {
    expect(referralUrl("BCDF2345", "https://agathon.app")).toBe("https://agathon.app/?ref=BCDF2345");
  });

  it("is shown without the scheme or www", () => {
    expect(shownLink("https://www.agathon.app/?ref=BCDF2345")).toBe("agathon.app/?ref=BCDF2345");
    expect(shownLink("http://localhost:3216/?ref=BCDF2345")).toBe("localhost:3216/?ref=BCDF2345");
  });
});

describe("the RPC's answer", () => {
  it("is checked: a code and whole counts", () => {
    expect(ReferralSummaryRpcSchema.safeParse(RPC).success).toBe(true);
    expect(ReferralSummaryRpcSchema.safeParse({ ...RPC, code: "abc" }).success).toBe(false);
    expect(ReferralSummaryRpcSchema.safeParse({ ...RPC, paid: -1 }).success).toBe(false);
    expect(ReferralSummaryRpcSchema.safeParse({ ...RPC, months_earned: undefined }).success).toBe(false);
  });

  it("becomes the contract's ReferralSummary", () => {
    expect(toReferralSummary(RPC, "https://agathon.app")).toEqual({
      code: "BCDF2345",
      link: "https://agathon.app/?ref=BCDF2345",
      signedUp: 2,
      paid: 1,
      monthsEarned: 1,
      monthsPending: 0,
    });
  });
});

describe("summaryLine", () => {
  it("says nobody has joined yet, before anyone has", () => {
    expect(summaryLine({ signedUp: 0, monthsEarned: 0, monthsPending: 0 })).toBe(REFERRAL_CARD_COPY.nobodyYet);
  });

  it("says who joined, and never '0 free months'", () => {
    expect(summaryLine({ signedUp: 1, monthsEarned: 0, monthsPending: 0 })).toBe("1 friend joined");
  });

  it("reads like the brief: 2 friends joined · 1 free month earned", () => {
    expect(summaryLine({ signedUp: 2, monthsEarned: 1, monthsPending: 0 })).toBe("2 friends joined · 1 free month earned");
  });

  it("adds the months on their way", () => {
    expect(summaryLine({ signedUp: 3, monthsEarned: 1, monthsPending: 1 })).toBe("3 friends joined · 1 free month earned · 1 free month on its way");
    expect(summaryLine({ signedUp: 3, monthsEarned: 0, monthsPending: 2 })).toBe("3 friends joined · 2 free months on their way");
    expect(summaryLine({ signedUp: 4, monthsEarned: 2, monthsPending: 0 })).toBe("4 friends joined · 2 free months earned");
  });
});

describe("referralCardView", () => {
  const summary = toReferralSummary(RPC, "https://agathon.app");

  it("promises the friend a free month only when that link is on sale", () => {
    const offered = referralCardView(summary, true);
    expect(offered.title).toBe(REFERRAL_COPY.title);
    expect(offered.pitch).toBe(REFERRAL_COPY.pitch);
    expect(offered.shareText).toContain("first month is free");
    const plain = referralCardView(summary, false);
    expect(plain.pitch).toBe(REFERRAL_CARD_COPY.pitchNoFriendOffer);
    expect(plain.pitch).not.toMatch(/they get/i);
    expect(plain.shareText).not.toMatch(/free/i);
  });

  it("carries the link, its shown form, the line and the two numbers", () => {
    expect(referralCardView(summary, true)).toMatchObject({
      link: "https://agathon.app/?ref=BCDF2345",
      shown: "agathon.app/?ref=BCDF2345",
      line: "2 friends joined · 1 free month earned",
      friends: 2,
      months: 1,
    });
  });
});

describe("readReferralSummary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers the summary with a link to the page's site", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const rpc = vi.fn(async () => ({ data: RPC, error: null }));
    const out = await readReferralSummary({ rpc } as never, "https://agathon.app");
    expect(rpc).toHaveBeenCalledWith("referral_summary");
    expect(out).toEqual({ kind: "ok", summary: toReferralSummary(RPC, "https://agathon.app") });
  });

  it("says 'kid' for a kid profile, and an error for anything else, never throwing", async () => {
    const kid = vi.fn(async () => ({ data: null, error: { code: "42501", hint: "family_kid", message: "Referrals are for grown-ups." } }));
    expect(await readReferralSummary({ rpc: kid } as never, "https://agathon.app")).toEqual({ kind: "kid" });
    const missing = vi.fn(async () => ({ data: null, error: { code: "PGRST202", hint: null, message: "no function" } }));
    expect((await readReferralSummary({ rpc: missing } as never, "https://agathon.app")).kind).toBe("error");
    const odd = vi.fn(async () => ({ data: { code: "x" }, error: null }));
    expect((await readReferralSummary({ rpc: odd } as never, "https://agathon.app")).kind).toBe("error");
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await readReferralSummary({ rpc: offline } as never, "https://agathon.app")).toEqual({ kind: "error", message: "Failed to fetch" });
  });
});
