import { describe, expect, it } from "vitest";
import { buildFamilyState, currentMember, decideSwitch, hasOthers, ownsKid, parseFamilyState, UNNAMED, type FamilyLinks, type MemberProfile } from "../members";

const P = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const X = "44444444-4444-4444-8444-444444444444";
const links: FamilyLinks = { parentId: P, kids: [A, B] };

describe("decideSwitch", () => {
  it("lets the grown-up become a kid without a PIN", () => {
    expect(decideSwitch(links, P, A)).toEqual({ ok: true, parentId: P, needsPin: false });
  });

  it("lets a kid become a sibling without a PIN", () => {
    expect(decideSwitch(links, A, B)).toEqual({ ok: true, parentId: P, needsPin: false });
  });

  it("asks for the PIN to become the grown-up", () => {
    expect(decideSwitch(links, A, P)).toEqual({ ok: true, parentId: P, needsPin: true });
    expect(decideSwitch(links, B, P)).toEqual({ ok: true, parentId: P, needsPin: true });
  });

  it("refuses a solo account", () => {
    expect(decideSwitch(null, X, P)).toEqual({ ok: false, reason: "solo" });
  });

  it("refuses anyone outside the family, the same way whether or not they exist", () => {
    expect(decideSwitch(links, A, X)).toEqual({ ok: false, reason: "not_in_family" });
    expect(decideSwitch(links, P, "99999999-9999-4999-8999-999999999999")).toEqual({ ok: false, reason: "not_in_family" });
  });

  it("refuses links that are not the caller's own", () => {
    expect(decideSwitch(links, X, A)).toEqual({ ok: false, reason: "not_in_family" });
  });

  it("refuses becoming yourself", () => {
    expect(decideSwitch(links, A, A)).toEqual({ ok: false, reason: "self" });
  });
});

describe("ownsKid", () => {
  it("is true only for the grown-up and their own kid", () => {
    expect(ownsKid(links, P, A)).toBe(true);
    expect(ownsKid(links, P, X)).toBe(false);
    expect(ownsKid(links, A, B)).toBe(false);
    expect(ownsKid(null, P, A)).toBe(false);
  });
});

describe("buildFamilyState", () => {
  const profiles = new Map<string, MemberProfile>([
    [P, { displayName: null, avatar: null, grade: null }],
    [A, { displayName: "Ava", avatar: "fox", grade: 3 }],
    [B, { displayName: "  Ben ", avatar: "dragon", grade: 12 }],
  ]);
  const stats = new Map([
    [A, { streak: 2, problemsThisWeek: 9, mastered: 1 }],
    [B, { streak: 0, problemsThisWeek: 0, mastered: 0 }],
  ]);

  it("gives the grown-up every member, grown-up first, with their kids' numbers", () => {
    const state = buildFamilyState({ me: P, links, hasPin: true, profiles, stats });
    expect(state.role).toBe("parent");
    expect(state.members.map((m) => m.userId)).toEqual([P, A, B]);
    expect(state.members[0]).toMatchObject({ displayName: UNNAMED.grownUp, isParent: true, stats: null });
    expect(state.members[1]).toMatchObject({ displayName: "Ava", avatar: "fox", grade: 3, stats: { streak: 2, problemsThisWeek: 9, mastered: 1 } });
    // an unknown picture and an out-of-range grade are dropped; the name is trimmed
    expect(state.members[2]).toMatchObject({ displayName: "Ben", avatar: null, grade: null });
  });

  it("gives a kid their siblings' names and pictures, never their numbers", () => {
    const state = buildFamilyState({ me: A, links, hasPin: true, profiles, stats });
    expect(state.role).toBe("kid");
    expect(state.parentId).toBe(P);
    expect(state.members.every((m) => m.stats === null)).toBe(true);
  });

  it("is just the caller for a solo account", () => {
    const state = buildFamilyState({ me: X, links: null, hasPin: false, profiles: new Map() });
    expect(state).toMatchObject({ role: "solo", me: X, parentId: X, hasPin: false });
    expect(state.members).toHaveLength(1);
    expect(hasOthers(state)).toBe(false);
  });
});

describe("parseFamilyState", () => {
  it("round-trips a state", () => {
    const state = buildFamilyState({ me: A, links, hasPin: true, profiles: new Map([[A, { displayName: "Ava", avatar: "fox", grade: 3 }]]) });
    const parsed = parseFamilyState(JSON.parse(JSON.stringify(state)));
    expect(parsed).toEqual(state);
    expect(currentMember(parsed)?.displayName).toBe("Ava");
    expect(hasOthers(parsed)).toBe(true);
  });

  it("answers null for anything malformed (never throws)", () => {
    for (const bad of [null, "x", 1, {}, { role: "boss", me: P, parentId: P, members: [] }, { role: "kid", me: P, parentId: P, members: [{ userId: "nope", displayName: "x" }] }, { role: "kid", me: P, parentId: P, members: [] }]) {
      expect(parseFamilyState(bad)).toBeNull();
    }
  });
});
