/**
 * Who may do what in a family, driven through the service over an in-memory store (fakeStore.ts):
 * the PIN, adding, editing and removing kids, and reading the family. The switch rules have their
 * own route-level tests (routes.family.test.ts).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_KIDS } from "@/lib/family/contracts";
import { addKid, editKid, readFamily, removeAllKids, removeKid, setFamilyPin } from "../service";
import { verifyPin } from "../pin";
import { IDS, makeFakeStore, type FakeStore } from "./fakeStore";

const user = (id: string, email: string | null = `${id}@example.com`) => ({ id, email });
const kidUser = (id: string) => user(id, `kid-${id}@kids.agathon.app`);
const NEW_KID = { displayName: "Cleo", grade: 2, avatar: "panda" as const };

let store: FakeStore;
beforeEach(async () => {
  store = await makeFakeStore();
});

describe("the PIN", () => {
  it("is set by a solo grown-up, which starts their family", async () => {
    const out = await setFamilyPin(store, user(IDS.solo), "2468");
    expect(out).toEqual({ ok: true, value: { hasPin: true } });
    expect(await verifyPin("2468", store.families.get(IDS.solo)?.pinHash)).toBe(true);
  });

  it("is changed by the grown-up's own session", async () => {
    await setFamilyPin(store, user(IDS.parent), "9999");
    expect(await verifyPin("9999", store.families.get(IDS.parent)?.pinHash)).toBe(true);
  });

  it("is never set by a kid", async () => {
    const out = await setFamilyPin(store, kidUser(IDS.kidA), "0000");
    expect(out).toMatchObject({ ok: false, status: 403, reason: "kid" });
    // nor by a kid whose address somehow is not a kid address (the family row says so)
    expect(await setFamilyPin(store, user(IDS.kidA, "someone@example.com"), "0000")).toMatchObject({ ok: false, status: 403 });
    expect(await verifyPin("0000", store.families.get(IDS.parent)?.pinHash)).toBe(false);
  });
});

describe("adding a kid", () => {
  it("needs the PIN first", async () => {
    const out = await addKid(store, user(IDS.solo), NEW_KID);
    expect(out).toMatchObject({ ok: false, status: 409, reason: "pin_required" });
    expect(store.created).toEqual([]);
  });

  it("makes the kid under the grown-up, with the grown-up's terms version", async () => {
    const out = await addKid(store, user(IDS.parent), NEW_KID);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toMatchObject({ displayName: "Cleo", grade: 2, avatar: "panda", isParent: false });
    expect(store.created).toEqual([{ parentId: IDS.parent, termsVersion: "2026-10-04" }]);
    expect(store.families.get(IDS.parent)?.kids).toContain(out.value.userId);
  });

  it("stops at MAX_KIDS", async () => {
    store.families.get(IDS.parent)!.kids = Array.from({ length: MAX_KIDS }, (_, i) => `99999999-9999-4999-8999-${String(i).padStart(12, "0")}`);
    expect(await addKid(store, user(IDS.parent), NEW_KID)).toMatchObject({ ok: false, status: 409, reason: "too_many" });
  });

  it("is refused for a kid", async () => {
    expect(await addKid(store, kidUser(IDS.kidA), NEW_KID)).toMatchObject({ ok: false, status: 403 });
    expect(store.created).toEqual([]);
  });
});

describe("editing and removing a kid", () => {
  it("works for the grown-up's own kid", async () => {
    expect(await editKid(store, user(IDS.parent), IDS.kidA, { displayName: "Ava B", grade: 4 })).toEqual({ ok: true, value: { updated: true } });
    expect(store.profileRows.get(IDS.kidA)).toMatchObject({ displayName: "Ava B", grade: 4, avatar: "fox" });
    expect(await removeKid(store, user(IDS.parent), IDS.kidB)).toMatchObject({ ok: true });
    expect(store.deleted).toEqual([IDS.kidB]);
  });

  it("is 404 for another family's kid, a made-up id, and the grown-up themself", async () => {
    for (const id of [IDS.otherKid, IDS.nobody, IDS.parent]) {
      expect(await editKid(store, user(IDS.parent), id, { grade: 1 })).toMatchObject({ ok: false, status: 404 });
      expect(await removeKid(store, user(IDS.parent), id)).toMatchObject({ ok: false, status: 404 });
    }
    expect(store.deleted).toEqual([]);
  });

  it("is refused for a kid, even about a sibling", async () => {
    expect(await editKid(store, kidUser(IDS.kidA), IDS.kidB, { grade: 1 })).toMatchObject({ ok: false, status: 403 });
    expect(await removeKid(store, kidUser(IDS.kidA), IDS.kidB)).toMatchObject({ ok: false, status: 403 });
    expect(await removeAllKids(store, kidUser(IDS.kidA))).toMatchObject({ ok: false, status: 403 });
    expect(store.deleted).toEqual([]);
  });

  it("removes every kid before the grown-up's account goes, and nobody else's", async () => {
    expect(await removeAllKids(store, user(IDS.parent))).toEqual({ ok: true, value: { removed: 2 } });
    expect(store.deleted).toEqual([IDS.kidA, IDS.kidB]);
    expect(await removeAllKids(store, user(IDS.solo))).toEqual({ ok: true, value: { removed: 0 } });
  });
});

describe("reading the family", () => {
  it("gives the grown-up their kids with numbers", async () => {
    const state = await readFamily(store, user(IDS.parent), { now: Date.now(), tzOffsetMinutes: 0 });
    expect(state).toMatchObject({ role: "parent", hasPin: true });
    expect(state.members.map((m) => m.displayName)).toEqual(["Grown-up", "Ava", "Ben"]);
    expect(state.members[1].stats).toEqual({ streak: 1, problemsThisWeek: 10, mastered: 0 });
  });

  it("gives a kid the family without numbers, and nothing of another family", async () => {
    const state = await readFamily(store, kidUser(IDS.kidB), { now: Date.now(), tzOffsetMinutes: 0 });
    expect(state.role).toBe("kid");
    expect(state.members.map((m) => m.userId)).toEqual([IDS.parent, IDS.kidA, IDS.kidB]);
    expect(state.members.every((m) => m.stats === null)).toBe(true);
    expect(JSON.stringify(state)).not.toContain(IDS.otherKid);
  });

  it("is solo for an account with no family", async () => {
    const state = await readFamily(store, user(IDS.solo), { now: Date.now(), tzOffsetMinutes: 0 });
    expect(state).toMatchObject({ role: "solo", hasPin: false });
    expect(state.members).toHaveLength(1);
  });
});
