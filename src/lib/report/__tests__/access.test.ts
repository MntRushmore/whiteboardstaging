import { describe, expect, it } from "vitest";
import { mayWatch, reportScope } from "../access";
import { reportLinkSecrets, unsubscribePath, unsubscribeTag, unsubscribeUrl, verifyUnsubscribe } from "../unsubscribe";

const P = "10000000-0000-4000-8000-000000000001";
const A = "10000000-0000-4000-8000-000000000002";
const B = "10000000-0000-4000-8000-000000000003";
const X = "20000000-0000-4000-8000-000000000002";
const family = { parentId: P, kids: [A, B] };
const parent = { id: P, email: "parent@example.com" };
const kidA = { id: A, email: `kid-${A}@kids.agathon.app` };

describe("reportScope", () => {
  it("a grown-up reads their kids in order, and themselves only when active", () => {
    expect(reportScope(family, parent)).toEqual({
      role: "parent",
      ownerId: P,
      members: [
        { id: A, optional: false },
        { id: B, optional: false },
        { id: P, optional: true },
      ],
    });
  });

  it("a kid reads only themselves, whether their address or their family says so", () => {
    expect(reportScope(family, kidA)).toEqual({ role: "kid", ownerId: A, members: [{ id: A, optional: false }] });
    expect(reportScope(family, { id: A, email: null }).role).toBe("kid");
    // a kid address with no family row left is still a kid
    expect(reportScope(null, kidA).role).toBe("kid");
  });

  it("a solo account, or a grown-up with no kids yet, reads their own week", () => {
    expect(reportScope(null, parent)).toEqual({ role: "solo", ownerId: P, members: [{ id: P, optional: false }] });
    expect(reportScope({ parentId: P, kids: [] }, parent)).toEqual({ role: "parent", ownerId: P, members: [{ id: P, optional: false }] });
  });
});

describe("mayWatch", () => {
  it("lets the owner and the owner's grown-up watch, nobody else", () => {
    expect(mayWatch(family, parent, A)).toBe(true);
    expect(mayWatch(family, parent, P)).toBe(true);
    expect(mayWatch(family, kidA, A)).toBe(true);
    expect(mayWatch(family, kidA, B)).toBe(false);
    expect(mayWatch(family, kidA, P)).toBe(false);
    expect(mayWatch(family, parent, X)).toBe(false);
    expect(mayWatch(null, parent, A)).toBe(false);
    // a grown-up's id on a kid address is still a kid
    expect(mayWatch(family, { id: P, email: `kid-${P}@kids.agathon.app` }, A)).toBe(false);
  });
});

describe("the unsubscribe link", () => {
  it("signs a user id, and verifies only that id under that secret", () => {
    const t = unsubscribeTag(P, "s3cret");
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyUnsubscribe(P, t, "s3cret")).toBe(P);
    expect(verifyUnsubscribe(P.toUpperCase(), t, "s3cret")).toBe(P);
    expect(verifyUnsubscribe(A, t, "s3cret")).toBeNull();
    expect(verifyUnsubscribe(P, t, "other")).toBeNull();
    expect(verifyUnsubscribe(P, t, undefined)).toBeNull();
    expect(verifyUnsubscribe(P, `${t}x`, "s3cret")).toBeNull();
    expect(verifyUnsubscribe(P, null, "s3cret")).toBeNull();
    expect(() => unsubscribeTag(P, "")).toThrow();
  });

  it("builds the link on the site", () => {
    const url = new URL(unsubscribeUrl("https://agathon.app", P, "s3cret"));
    expect(url.origin + url.pathname).toBe("https://agathon.app/api/report/unsubscribe");
    expect(verifyUnsubscribe(url.searchParams.get("u"), url.searchParams.get("t"), "s3cret")).toBe(P);
    expect(unsubscribePath(P, "tag")).toBe(`/api/report/unsubscribe?u=${P}&t=tag`);
  });

  it("keeps an old link working after a rotation: any accepted secret verifies it, none other", () => {
    const old = unsubscribeTag(P, "old-secret");
    expect(verifyUnsubscribe(P, old, ["new-secret", "old-secret"])).toBe(P);
    expect(verifyUnsubscribe(P, unsubscribeTag(P, "new-secret"), ["new-secret", "old-secret"])).toBe(P);
    expect(verifyUnsubscribe(P, old, ["new-secret"])).toBeNull();
    expect(verifyUnsubscribe(A, old, ["new-secret", "old-secret"])).toBeNull();
    expect(verifyUnsubscribe(P, old, [])).toBeNull();
    expect(verifyUnsubscribe(P, old, ["", "old-secret"])).toBe(P);
  });

  it("signs with REPORT_LINK_SECRET, else CRON_SECRET, and also accepts REPORT_LINK_SECRET_PREVIOUS", () => {
    expect(reportLinkSecrets({ CRON_SECRET: " cron " })).toEqual({ sign: "cron", accept: ["cron"] });
    expect(reportLinkSecrets({ CRON_SECRET: "cron", REPORT_LINK_SECRET: "link" })).toEqual({ sign: "link", accept: ["link"] });
    expect(reportLinkSecrets({ CRON_SECRET: "cron", REPORT_LINK_SECRET: "link", REPORT_LINK_SECRET_PREVIOUS: " cron " })).toEqual({ sign: "link", accept: ["link", "cron"] });
    // the same value twice is one secret
    expect(reportLinkSecrets({ REPORT_LINK_SECRET: "link", REPORT_LINK_SECRET_PREVIOUS: "link" })).toEqual({ sign: "link", accept: ["link"] });
    // nothing to sign with: no link at all, even with an old value
    expect(reportLinkSecrets({ REPORT_LINK_SECRET_PREVIOUS: "old" })).toBeNull();
    expect(reportLinkSecrets({ CRON_SECRET: "  " })).toBeNull();
  });
});
