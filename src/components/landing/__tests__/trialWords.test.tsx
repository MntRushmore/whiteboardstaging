import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ATTRIBUTION_STORAGE_KEY, type StoredAttribution } from "@/lib/funnel/capture";
import { friendOffer, friendOfferOnThisDevice, TrialWords } from "../TrialWords";

/**
 * The island that gives a visitor a friend invited the free first month their invite promised, and
 * everyone else (and the server's HTML) the usual trial.
 */

const LINK = "https://buy.stripe.com/test_friend_month";
const CODE = "BCDF2345";
const seen = (attribution: Partial<StoredAttribution["attribution"]> = {}, sentAt?: string): StoredAttribution => ({
  attribution: { firstSeenAt: "2026-10-09T12:00:00.000Z", landingPath: "/parents", ...attribution },
  ...(sentAt ? { sentAt } : {}),
});

describe("friendOffer", () => {
  it("applies with an invite on the device and the friend's Payment Link on the build", () => {
    expect(friendOffer(seen({ ref: CODE }), "https://agathon.app/parents", LINK)).toBe(true);
    // the address's own ?ref= (the capture has not run yet)
    expect(friendOffer(null, `https://agathon.app/parents?ref=${CODE}`, LINK)).toBe(true);
  });

  it("not without the link: checkout would give the usual trial, so the page says the usual trial", () => {
    expect(friendOffer(seen({ ref: CODE }), `https://agathon.app/parents?ref=${CODE}`, null)).toBe(false);
  });

  it("not without a well-formed invite, nor once the device's attribution went to an account", () => {
    expect(friendOffer(seen(), "https://agathon.app/parents", LINK)).toBe(false);
    expect(friendOffer(seen({ utmSource: "newsletter" }), "https://agathon.app/parents?utm_source=newsletter", LINK)).toBe(false);
    expect(friendOffer(null, "https://agathon.app/parents?ref=not-a-code!", LINK)).toBe(false);
    expect(friendOffer(seen({ ref: CODE }, "2026-10-09T13:00:00.000Z"), "https://agathon.app/parents", LINK)).toBe(false);
  });
});

describe("friendOfferOnThisDevice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function browser(href: string, stored: StoredAttribution | null) {
    const items = new Map<string, string>(stored ? [[ATTRIBUTION_STORAGE_KEY, JSON.stringify(stored)]] : []);
    vi.stubGlobal("window", {
      location: { href },
      localStorage: { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) },
    });
  }

  it("reads what the device kept from the invite link, and this build's link", () => {
    browser("https://agathon.app/parents", seen({ ref: CODE }));
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK", LINK);
    expect(friendOfferOnThisDevice()).toBe(true);
  });

  it("is off on a build without the friend's link, whatever the device holds", () => {
    browser(`https://agathon.app/parents?ref=${CODE}`, seen({ ref: CODE }));
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK", "");
    expect(friendOfferOnThisDevice()).toBe(false);
  });

  it("is off for a visitor who came any other way", () => {
    browser("https://agathon.app/parents?utm_source=post", seen({ utmSource: "post" }));
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK", LINK);
    expect(friendOfferOnThisDevice()).toBe(false);
  });
});

describe("TrialWords", () => {
  it("renders the usual words on the server (the page is static; the friend's month comes in the browser)", () => {
    expect(renderToStaticMarkup(<TrialWords usual="Start your free week" invited="Start your free month" />)).toBe("Start your free week");
  });
});
