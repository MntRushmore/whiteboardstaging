/**
 * Who may do what in a family, driven through the service over an in-memory store (fakeStore.ts):
 * the PIN, adding, editing and removing kids, and reading the family. The switch rules have their
 * own route-level tests (routes.family.test.ts).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_KIDS } from "@/lib/family/contracts";
import { FAMILY_ERRORS, addKid, editKid, readFamily, removeKid, removeKidsImages, setFamilyPin, switchProfile } from "../service";
import { PIN_ATTEMPTS, PIN_DAILY_LIMIT, verifyPin } from "../pin";
import { KID_ADDS } from "../store";
import { IDS, PIN, makeFakeStore, type FakeStore } from "./fakeStore";

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

  it("needs the grown-up's Unlimited (409 plan_required): no plan, no kid, and no add counted", async () => {
    store.noPlan.add(IDS.parent);
    const out = await addKid(store, user(IDS.parent), NEW_KID);
    expect(out).toMatchObject({ ok: false, status: 409, code: "invalid_request", reason: "plan_required", message: FAMILY_ERRORS.planRequired });
    expect(out.ok === false && out.extra).toEqual({ reason: "plan_required" });
    expect(FAMILY_ERRORS.planRequired).toBe("Start your free trial to add kids.");
    expect(store.created).toEqual([]);
    expect(store.kidAdds.size).toBe(0);
    // a solo account with no plan hears about the plan before the PIN
    store.noPlan.add(IDS.solo);
    expect(await addKid(store, user(IDS.solo), NEW_KID)).toMatchObject({ ok: false, reason: "plan_required" });
  });

  it(`allows ${KID_ADDS.limit} adds a day per family, however many are removed in between (429 kid_add_limit)`, async () => {
    store.families.get(IDS.parent)!.kids = [];
    for (let i = 0; i < KID_ADDS.limit; i++) {
      const out = await addKid(store, user(IDS.parent), { ...NEW_KID, displayName: `Kid ${i}` });
      expect(out.ok, `add ${i}`).toBe(true);
      // removed again at once: the family is never full, so only the day's budget can stop it
      if (out.ok) await removeKid(store, user(IDS.parent), out.value.userId);
    }
    const refused = await addKid(store, user(IDS.parent), NEW_KID);
    expect(refused).toMatchObject({ ok: false, status: 429, code: "rate_limited", reason: "kid_add_limit", message: FAMILY_ERRORS.kidAddLimit });
    expect(refused.ok === false && refused.retryAfterMs).toBeGreaterThan(0);
    expect(store.created).toHaveLength(KID_ADDS.limit);
    // another family's budget is its own
    expect((await addKid(store, user(IDS.otherParent), NEW_KID)).ok).toBe(true);
  });

  it("counts an add only once every other check passed", async () => {
    store.families.get(IDS.parent)!.kids = Array.from({ length: MAX_KIDS }, (_, i) => `99999999-9999-4999-8999-${String(i).padStart(12, "0")}`);
    await addKid(store, user(IDS.parent), NEW_KID); // full
    await addKid(store, user(IDS.solo), NEW_KID); // no PIN
    expect(store.kidAdds.size).toBe(0);
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
    expect(await removeKidsImages(store, kidUser(IDS.kidA))).toMatchObject({ ok: false, status: 403 });
    expect(store.deleted).toEqual([]);
    expect(store.imagesCleared).toEqual([]);
  });

  it("before the grown-up's account goes, removes every kid's images but no kid's account (the RPC deletes them with the grown-up)", async () => {
    expect(await removeKidsImages(store, user(IDS.parent))).toEqual({ ok: true, value: { removed: 2 } });
    expect(store.imagesCleared).toEqual([IDS.kidA, IDS.kidB]);
    // the accounts are all still there: a refused or failed delete_own_account() loses no kid
    expect(store.deleted).toEqual([]);
    expect(store.families.get(IDS.parent)?.kids).toEqual([IDS.kidA, IDS.kidB]);
    expect(await removeKidsImages(store, user(IDS.solo))).toEqual({ ok: true, value: { removed: 0 } });
  });
});

describe("the PIN's budgets", () => {
  const wrong = (n: number) => String(n).padStart(4, "0");
  const toParent = (pin: string, from: string = IDS.kidA) => switchProfile(store, kidUser(from), `token-${from}`, { to: IDS.parent, pin });

  it(`locks switching to the grown-up at the day's ${PIN_DAILY_LIMIT}th wrong PIN, and says so once (an app event)`, async () => {
    let tries = 0;
    for (; tries < PIN_DAILY_LIMIT - 1; tries++) {
      // a fresh 15-minute window every few tries: only the day's budget is left to stop the guessing
      if (tries % PIN_ATTEMPTS.limit === 0) store.pinHits.clear();
      const out = await toParent(wrong(tries));
      expect(out).toMatchObject({ ok: false, status: 403, reason: "wrong_pin" });
      expect(out.ok === false && out.event).toBeUndefined();
    }
    store.pinHits.clear();
    const last = await toParent(wrong(tries));
    expect(last).toMatchObject({ ok: false, status: 403, reason: "wrong_pin", extra: { triesLeft: 0, locked: true } });
    expect(last.ok === false && last.event).toMatchObject({ code: "pin_locked", meta: { parentId: IDS.parent, by: IDS.kidA } });

    // from now on even the right PIN is refused, for every kid, and nothing is counted or minted
    const locked = await toParent(PIN, IDS.kidB);
    expect(locked).toMatchObject({ ok: false, status: 429, code: "rate_limited", reason: "pin_locked", message: FAMILY_ERRORS.pinLocked });
    expect(locked.ok === false && locked.event).toBeUndefined();
    expect(store.minted).toEqual([]);
    // switching between kids needs no PIN, so it still works
    expect((await switchProfile(store, kidUser(IDS.kidA), "t", { to: IDS.kidB })).ok).toBe(true);
  }, 30_000); // ten scrypt checks

  it("a right PIN on the day's last try is no lock: that try is given back", async () => {
    store.pinDayHits.set(IDS.parent, PIN_DAILY_LIMIT - 1);
    expect((await toParent(PIN)).ok).toBe(true);
    expect(store.pinLocked.has(IDS.parent)).toBe(false);
    expect(store.pinDayHits.get(IDS.parent)).toBe(PIN_DAILY_LIMIT - 1);
  });

  it("the grown-up setting a new PIN lifts the lock", async () => {
    store.pinLocked.add(IDS.parent);
    expect(await toParent(PIN)).toMatchObject({ status: 429, reason: "pin_locked" });
    await setFamilyPin(store, user(IDS.parent), "2468");
    expect((await toParent("2468")).ok).toBe(true);
  });

  it("fails CLOSED when the database's counter cannot be asked: no PIN is checked, not even the right one", async () => {
    store.pinUnavailable = true;
    for (const pin of [PIN, "0000"]) {
      expect(await toParent(pin)).toMatchObject({ ok: false, status: 503, code: "feature_unavailable", reason: "pin_unavailable", message: FAMILY_ERRORS.pinUnavailable });
    }
    expect(store.minted).toEqual([]);
  });

  it("the 15-minute budget still answers 429 with no reason (a wait, not the lock)", async () => {
    for (let i = 0; i < PIN_ATTEMPTS.limit; i++) await toParent(wrong(i));
    const out = await toParent(PIN);
    expect(out).toMatchObject({ ok: false, status: 429, message: FAMILY_ERRORS.tooManyTries });
    expect(out.ok === false && out.reason).toBeUndefined();
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
