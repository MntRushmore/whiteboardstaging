/**
 * The friend's side (src/lib/referral/invite.ts): which visitors see "A friend invited you", the
 * free month only when its link is on sale, an account's `referred` from its own attribution, and
 * the capture keeping a friend's `?ref=` seen after a first visit without one
 * (src/lib/funnel/capture.ts).
 */
import { describe, expect, it } from "vitest";
import { ATTRIBUTION_STORAGE_KEY, captureAttribution, readStoredAttribution, type AttributionStorage, type StoredAttribution } from "@/lib/funnel/capture";
import { REFERRAL_INVITE_COPY } from "../copy";
import { inviteCode, inviteView, normalizeReferralCode, referredFromAttribution } from "../invite";

const FIRST = "2026-10-09T12:00:00.000Z";
const stored = (ref?: string, sentAt?: string): StoredAttribution => ({ attribution: { firstSeenAt: FIRST, ...(ref ? { ref } : {}) }, ...(sentAt ? { sentAt } : {}) });

function memoryStorage(initial: Record<string, string> = {}): AttributionStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("normalizeReferralCode", () => {
  it("trims and upper-cases a code as typed in a link", () => {
    expect(normalizeReferralCode(" bcdf2345 ")).toBe("BCDF2345");
    expect(normalizeReferralCode("BCDF2345")).toBe("BCDF2345");
  });

  it("refuses anything that cannot be a code", () => {
    for (const bad of ["", "abc", "BCDF234O", "BCDF2341", "BCDF2345BCDF", "BCD F2345", null, undefined, 42]) {
      expect(normalizeReferralCode(bad)).toBeNull();
    }
  });
});

describe("inviteCode", () => {
  it("reads the device's kept ref first", () => {
    expect(inviteCode(stored("bcdf2345"), "https://agathon.app/login")).toBe("BCDF2345");
  });

  it("falls back to the page's own ?ref=", () => {
    expect(inviteCode(null, "https://agathon.app/login?ref=BCDF2345")).toBe("BCDF2345");
    expect(inviteCode(stored(), "https://agathon.app/login?ref=bcdf2345")).toBe("BCDF2345");
  });

  it("is null once the device's attribution went to an account (a sign-in, not a join)", () => {
    expect(inviteCode(stored("BCDF2345", "2026-10-09T12:05:00Z"), "https://agathon.app/login?ref=BCDF2345")).toBeNull();
  });

  it("is null without a code, or with something that is not one", () => {
    expect(inviteCode(null, "https://agathon.app/login")).toBeNull();
    expect(inviteCode(stored("not-a-code"), "https://agathon.app/login")).toBeNull();
    expect(inviteCode(null, "not a url")).toBeNull();
    expect(inviteCode(null, null)).toBeNull();
  });
});

describe("inviteView", () => {
  it("says a friend invited you, never whose code it is", () => {
    const view = inviteView("BCDF2345", false);
    expect(view).toEqual({ title: REFERRAL_INVITE_COPY.title, freeMonth: null });
    expect(JSON.stringify(view)).not.toContain("BCDF2345");
  });

  it("adds 'Your first month is free.' only when the friend's link is on sale", () => {
    expect(inviteView("BCDF2345", true)?.freeMonth).toBe(REFERRAL_INVITE_COPY.freeMonth);
  });

  it("is nothing for a visitor without an invite", () => {
    expect(inviteView(null, true)).toBeNull();
  });
});

describe("referredFromAttribution", () => {
  it("is true when the profile's attribution keeps a code (the database keeps only a recorded one)", () => {
    expect(referredFromAttribution({ firstSeenAt: FIRST, ref: "BCDF2345" })).toBe(true);
  });

  it("is false for no attribution, no ref, or a ref that is not a code", () => {
    for (const a of [null, undefined, "x", [], {}, { firstSeenAt: FIRST }, { ref: "bcdf2345" }, { ref: 7 }]) {
      expect(referredFromAttribution(a)).toBe(false);
    }
  });
});

describe("captureAttribution keeps a friend's invite seen later", () => {
  const later = new Date("2026-10-10T09:00:00Z");

  it("adds a ?ref= to a first visit that had none, before any account", () => {
    const storage = memoryStorage({ [ATTRIBUTION_STORAGE_KEY]: JSON.stringify({ attribution: { firstSeenAt: FIRST, utmSource: "tiktok", landingPath: "/" } }) });
    const out = captureAttribution(storage, { href: "https://agathon.app/?ref=BCDF2345", referrer: "" }, later);
    expect(out?.attribution).toEqual({ firstSeenAt: FIRST, utmSource: "tiktok", landingPath: "/", ref: "BCDF2345" });
    expect(readStoredAttribution(storage)?.attribution.ref).toBe("BCDF2345");
  });

  it("never replaces the first visit's own ref, nor writes after the attribution was saved", () => {
    const first = memoryStorage({ [ATTRIBUTION_STORAGE_KEY]: JSON.stringify({ attribution: { firstSeenAt: FIRST, ref: "BCDF2345" } }) });
    expect(captureAttribution(first, { href: "https://agathon.app/?ref=ZZZZ9999", referrer: "" }, later)?.attribution.ref).toBe("BCDF2345");
    const sent = memoryStorage({ [ATTRIBUTION_STORAGE_KEY]: JSON.stringify({ attribution: { firstSeenAt: FIRST }, sentAt: "2026-10-09T12:05:00Z" }) });
    expect(captureAttribution(sent, { href: "https://agathon.app/?ref=ZZZZ9999", referrer: "" }, later)?.attribution.ref).toBeUndefined();
    expect(readStoredAttribution(sent)?.attribution.ref).toBeUndefined();
  });

  it("leaves the first visit alone when the page has no ref (the rest of the first visit wins)", () => {
    const storage = memoryStorage({ [ATTRIBUTION_STORAGE_KEY]: JSON.stringify({ attribution: { firstSeenAt: FIRST, utmSource: "tiktok" } }) });
    const before = storage.data[ATTRIBUTION_STORAGE_KEY];
    captureAttribution(storage, { href: "https://agathon.app/?utm_source=x", referrer: "https://news.example" }, later);
    expect(storage.data[ATTRIBUTION_STORAGE_KEY]).toBe(before);
  });
});
