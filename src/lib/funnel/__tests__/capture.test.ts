/**
 * Sign-up attribution on the device (src/lib/funnel/capture.ts) and its one save
 * (src/lib/funnel/save.ts): what is kept from the first page, that nothing personal is, that the
 * first visit is never overwritten, and when it is sent.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTION_FIELD_MAX,
  ATTRIBUTION_STORAGE_KEY,
  SIGNUP_SLACK_MS,
  attributionDecision,
  attributionFromPage,
  captureAttribution,
  markAttributionSent,
  readStoredAttribution,
  type AttributionStorage,
} from "../capture";
import { saveAttribution } from "../save";

const NOW = new Date("2026-10-09T14:00:00.000Z");

function memoryStorage(initial: Record<string, string> = {}): AttributionStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe("attributionFromPage", () => {
  it("keeps the utm values, ?ref=, the path without its query, and the referrer's origin only", () => {
    const a = attributionFromPage(
      {
        href: "https://agathon.app/signup?utm_source=tiktok&utm_medium=video&utm_campaign=fall&utm_content=clip3&ref=MAYA7&q=private",
        referrer: "https://www.tiktok.com/@agathon/video/123?lang=en",
      },
      NOW,
    );
    expect(a).toEqual({
      utmSource: "tiktok",
      utmMedium: "video",
      utmCampaign: "fall",
      utmContent: "clip3",
      ref: "MAYA7",
      landingPath: "/signup",
      referrer: "https://www.tiktok.com",
      firstSeenAt: NOW.toISOString(),
    });
  });

  it("keeps nothing personal: no email-looking value, no internal referrer, values cut to the cap", () => {
    const long = "x".repeat(500);
    const a = attributionFromPage({ href: `https://agathon.app/?utm_source=${long}&utm_content=mom%40example.com&ref=%20%20`, referrer: "https://agathon.app/login" }, NOW);
    expect(a.utmSource).toHaveLength(ATTRIBUTION_FIELD_MAX);
    expect(a.utmContent).toBeUndefined();
    expect(a.ref).toBeUndefined();
    expect(a.referrer).toBeUndefined();
    expect(a.landingPath).toBe("/");
  });

  it("degrades on garbage: a bad address or referrer just means fewer fields", () => {
    expect(attributionFromPage({ href: "not a url", referrer: "also not" }, NOW)).toEqual({ firstSeenAt: NOW.toISOString() });
    expect(attributionFromPage({ href: "https://agathon.app/", referrer: "javascript:alert(1)" }, NOW)).toEqual({ landingPath: "/", firstSeenAt: NOW.toISOString() });
  });
});

describe("captureAttribution", () => {
  it("stores the first visit and never overwrites it", () => {
    const storage = memoryStorage();
    const first = captureAttribution(storage, { href: "https://agathon.app/?utm_source=newsletter", referrer: "" }, NOW);
    expect(first?.attribution.utmSource).toBe("newsletter");
    const later = captureAttribution(storage, { href: "https://agathon.app/?utm_source=tiktok", referrer: "https://google.com/" }, new Date(NOW.getTime() + 86_400_000));
    expect(later?.attribution).toEqual(first?.attribution);
    expect(JSON.parse(storage.data[ATTRIBUTION_STORAGE_KEY]).attribution.utmSource).toBe("newsletter");
  });

  it("replaces a stored value it cannot read, and survives a storage that throws", () => {
    const broken = memoryStorage({ [ATTRIBUTION_STORAGE_KEY]: "{not json" });
    expect(captureAttribution(broken, { href: "https://agathon.app/x", referrer: "" }, NOW)?.attribution.landingPath).toBe("/x");
    const throwing: AttributionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(captureAttribution(throwing, { href: "https://agathon.app/", referrer: "" }, NOW)?.attribution.landingPath).toBe("/");
    expect(captureAttribution(null, { href: "https://agathon.app/", referrer: "" }, NOW)).toBeNull();
  });

  it("reads back only the known fields, cleaned", () => {
    const storage = memoryStorage({
      [ATTRIBUTION_STORAGE_KEY]: JSON.stringify({ attribution: { firstSeenAt: NOW.toISOString(), utmSource: "  ads ", email: "a@b.c", utmMedium: "x@y.z" } }),
    });
    expect(readStoredAttribution(storage)).toEqual({ attribution: { firstSeenAt: NOW.toISOString(), utmSource: "ads" } });
    expect(readStoredAttribution(memoryStorage({ [ATTRIBUTION_STORAGE_KEY]: JSON.stringify({ attribution: { firstSeenAt: "yesterday" } }) }))).toBeNull();
  });
});

describe("attributionDecision / markAttributionSent", () => {
  const stored = { attribution: { firstSeenAt: NOW.toISOString(), utmSource: "tiktok" } };

  it("sends once for an account made after (or with) the visit", () => {
    const user = { id: "u1", email: "parent@example.com", created_at: new Date(NOW.getTime() + 600_000).toISOString() };
    expect(attributionDecision(stored, user)).toEqual({ kind: "send", attribution: stored.attribution });
    // signed up a little before the capture ran on this page (the same visit)
    expect(attributionDecision(stored, { ...user, created_at: new Date(NOW.getTime() - SIGNUP_SLACK_MS + 1000).toISOString() }).kind).toBe("send");
    expect(attributionDecision({ ...stored, sentAt: NOW.toISOString() }, user)).toEqual({ kind: "none" });
  });

  it("skips an older account on a new device, and never sends for a kid profile or nobody", () => {
    expect(attributionDecision(stored, { id: "u1", created_at: "2026-09-01T00:00:00Z" })).toEqual({ kind: "skip" });
    expect(attributionDecision(stored, { id: "k1", email: "kid-1@kids.agathon.app", created_at: NOW.toISOString() })).toEqual({ kind: "none" });
    expect(attributionDecision(stored, null)).toEqual({ kind: "none" });
    expect(attributionDecision(null, { id: "u1" })).toEqual({ kind: "none" });
    // no created_at: the server keeps the first one it gets anyway
    expect(attributionDecision(stored, { id: "u1" }).kind).toBe("send");
  });

  it("marks it sent, keeping the attribution", () => {
    const storage = memoryStorage({ [ATTRIBUTION_STORAGE_KEY]: JSON.stringify(stored) });
    markAttributionSent(storage, NOW);
    expect(readStoredAttribution(storage)).toEqual({ ...stored, sentAt: NOW.toISOString() });
    markAttributionSent(storage, new Date(NOW.getTime() + 1000));
    expect(readStoredAttribution(storage)?.sentAt).toBe(NOW.toISOString());
  });
});

describe("saveAttribution", () => {
  const attribution = { firstSeenAt: NOW.toISOString(), referrer: "https://www.google.com" };

  it("calls save_attribution with the object, done when the server answers", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    expect(await saveAttribution({ rpc } as never, attribution)).toEqual({ done: true });
    expect(rpc).toHaveBeenCalledWith("save_attribution", { p: attribution });
  });

  it("is done for a value the server refuses, and retried for anything else", async () => {
    const bad = vi.fn(async () => ({ data: null, error: { code: "22023", message: "bad attribution" } }));
    expect(await saveAttribution({ rpc: bad } as never, attribution)).toEqual({ done: true });
    const down = vi.fn(async () => ({ data: null, error: { code: "PGRST000", message: "down" } }));
    expect(await saveAttribution({ rpc: down } as never, attribution)).toEqual({ done: false, error: "down" });
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await saveAttribution({ rpc: offline } as never, attribution)).toEqual({ done: false, error: "Failed to fetch" });
  });
});
