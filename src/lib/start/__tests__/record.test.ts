/**
 * The browser's half of the steps before the account (src/lib/start/record.ts): the one request a
 * step makes, the journey it keeps beside the flow's own answers, which steps go once a page load,
 * that nothing ever throws, and linking the journey to the new account at most once per account per
 * device. Fetch, storage and the Supabase client are fakes; no network.
 */
import { describe, expect, it, vi } from "vitest";
import { START_EVENTS, START_STEP_API, START_STORAGE_KEY, StartStepRequestSchema, type StartEvent } from "../contracts";
import { cleanStartStepMeta, createStartRecorder, isStartEvent, LINK_START_JOURNEY, randomUuid, REPEAT_SAFE, START_LINKED_KEY, type StartRecorderDeps, type StartRpcClient } from "../record";

const J1 = "11111111-1111-4111-8111-111111111111";
const J2 = "22222222-2222-4222-8222-222222222222";

/** A localStorage over a Map; `broken` makes every call throw (blocked site data). */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const world = { broken: false };
  const storage = {
    getItem: vi.fn((key: string) => {
      if (world.broken) throw new Error("SecurityError");
      return map.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (world.broken) throw new Error("QuotaExceededError");
      map.set(key, value);
    }),
  };
  return { map, world, storage };
}

function setup(over: Partial<StartRecorderDeps> = {}, initial: Record<string, string> = {}) {
  const { map, world, storage } = memoryStorage(initial);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
  const rpc = vi.fn<StartRpcClient["rpc"]>(async () => ({ data: true, error: null }));
  const client: StartRpcClient = { rpc };
  let n = 0;
  const ids = [J1, J2];
  const recorder = createStartRecorder({ fetch, storage: () => storage, client: async () => client, uuid: () => ids[n++ % ids.length], ...over });
  const bodies = () => fetch.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
  const state = () => JSON.parse(map.get(START_STORAGE_KEY) ?? "null");
  return { map, world, storage, fetch, rpc, recorder, bodies, state };
}

describe("recordStartStep: the request", () => {
  it("POSTs the step to the route, keepalive, same-origin, with the journey and its cleaned details", () => {
    const { recorder, fetch, bodies } = setup();
    recorder.recordStartStep("start_who", { role: "parent", nested: { no: 1 } as never, why: "x".repeat(60) });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(START_STEP_API);
    expect(init).toEqual({ method: "POST", headers: { "Content-Type": "application/json" }, body: expect.any(String), keepalive: true, credentials: "same-origin" });
    expect(bodies()).toEqual([{ journeyId: J1, event: "start_who", meta: { role: "parent", why: "x".repeat(40) } }]);
    // what the route checks it with
    expect(StartStepRequestSchema.safeParse(bodies()[0]).success).toBe(true);
  });

  it("sends no meta when there are no details, or none survive cleaning", () => {
    const { recorder, bodies } = setup();
    recorder.recordStartStep("start_name");
    recorder.recordStartStep("start_name", {});
    recorder.recordStartStep("start_name", { Bad: "key" });
    expect(bodies()).toEqual(Array(3).fill({ journeyId: J1, event: "start_name" }));
  });

  it("sends nothing for an unknown event, for start_account (linking records it), or without fetch (the server)", () => {
    const { recorder, fetch } = setup();
    recorder.recordStartStep("start_teleported" as StartEvent);
    recorder.recordStartStep("start_account");
    expect(fetch).not.toHaveBeenCalled();
    const server = setup({ fetch: undefined });
    expect(() => server.recorder.recordStartStep("start_shown")).not.toThrow();
  });

  it("never throws: not when fetch throws, nor when it rejects", async () => {
    const throws = setup({
      fetch: vi.fn(() => {
        throw new TypeError("keepalive body too large");
      }) as unknown as typeof fetch,
    });
    expect(() => throws.recorder.recordStartStep("start_grade", { grade: 3 })).not.toThrow();
    const rejects = setup({ fetch: vi.fn(async () => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch });
    expect(() => rejects.recorder.recordStartStep("start_grade", { grade: 3 })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("recordStartStep: once a page load, or every time", () => {
  it("sends a screen showing once per journey per page load", () => {
    const { recorder, bodies } = setup();
    for (const event of REPEAT_SAFE) {
      recorder.recordStartStep(event);
      recorder.recordStartStep(event);
    }
    expect(bodies().map((b) => b.event)).toEqual(["start_shown", "start_try_shown", "start_plan", "start_account_shown", "start_handoff_opened"]);
  });

  it("sends every answer every time (the server counts them)", () => {
    const { recorder, bodies } = setup();
    const answers = START_EVENTS.filter((e) => !REPEAT_SAFE.has(e) && e !== "start_account");
    for (const event of answers) {
      recorder.recordStartStep(event);
      recorder.recordStartStep(event);
    }
    expect(bodies()).toHaveLength(answers.length * 2);
  });

  it("a new journey (the flow started over) shows its screens again", () => {
    const { recorder, map, bodies } = setup();
    recorder.recordStartStep("start_shown");
    map.set(START_STORAGE_KEY, JSON.stringify({ journeyId: J2 }));
    recorder.recordStartStep("start_shown");
    expect(bodies().map((b) => b.journeyId)).toEqual([J1, J2]);
  });
});

describe("the journey", () => {
  it("is made once and kept under the flow's key, beside the flow's own fields", () => {
    const flow = { step: "grade", answers: { role: "kid", name: "Sam" } };
    const { recorder, state, bodies } = setup({}, { [START_STORAGE_KEY]: JSON.stringify(flow) });
    recorder.recordStartStep("start_shown");
    recorder.recordStartStep("start_who", { role: "kid" });
    expect(state()).toEqual({ ...flow, journeyId: J1 });
    expect(bodies().map((b) => b.journeyId)).toEqual([J1, J1]);
  });

  it("uses the one the device already keeps, and keeps it across page loads", () => {
    const first = setup({}, { [START_STORAGE_KEY]: JSON.stringify({ journeyId: J2, step: "plan" }) });
    first.recorder.recordStartStep("start_plan");
    expect(first.bodies()[0].journeyId).toBe(J2);
    expect(first.storage.setItem).not.toHaveBeenCalled();
    const again = createStartRecorder({ fetch: first.fetch, storage: () => first.storage, client: async () => null, uuid: () => J1 });
    expect(again.journeyId()).toBe(J2);
  });

  it("replaces a stored id that is not a uuid, and storage that is not JSON", () => {
    const bad = setup({}, { [START_STORAGE_KEY]: JSON.stringify({ journeyId: "sam", step: "who" }) });
    expect(bad.recorder.journeyId()).toBe(J1);
    expect(bad.state()).toEqual({ journeyId: J1, step: "who" });
    const garbage = setup({}, { [START_STORAGE_KEY]: "{not json" });
    expect(garbage.recorder.journeyId()).toBe(J1);
    expect(garbage.state()).toEqual({ journeyId: J1 });
  });

  it("keeps the page load's journey when the flow writes its object without it", () => {
    const { recorder, map } = setup();
    expect(recorder.journeyId()).toBe(J1);
    map.set(START_STORAGE_KEY, JSON.stringify({ step: "focus" }));
    expect(recorder.journeyId()).toBe(J1);
    expect(JSON.parse(map.get(START_STORAGE_KEY)!)).toEqual({ step: "focus", journeyId: J1 });
  });

  it("lives for the page load when storage throws", () => {
    const { recorder, world, bodies } = setup();
    world.broken = true;
    recorder.recordStartStep("start_shown");
    recorder.recordStartStep("start_who", { role: "parent" });
    expect(bodies().map((b) => b.journeyId)).toEqual([J1, J1]);
    const none = setup({ storage: () => null });
    expect(none.recorder.journeyId()).toBe(J1);
  });
});

describe("linkStartJourney", () => {
  it("calls link_start_journey with the device's journey, as the signed-in account", async () => {
    const { recorder, rpc, map } = setup({}, { [START_STORAGE_KEY]: JSON.stringify({ journeyId: J2 }) });
    await recorder.linkStartJourney("user-a");
    expect(rpc).toHaveBeenCalledWith(LINK_START_JOURNEY, { p_journey: J2 });
    expect(JSON.parse(map.get(START_LINKED_KEY)!)).toEqual(["user-a"]);
  });

  it("links at most once per account per device: again on this page, or on the next", async () => {
    const { recorder, rpc, storage, fetch } = setup({}, { [START_STORAGE_KEY]: JSON.stringify({ journeyId: J2 }) });
    await Promise.all([recorder.linkStartJourney("user-a"), recorder.linkStartJourney("user-a")]);
    await recorder.linkStartJourney("user-a");
    const nextLoad = createStartRecorder({ fetch, storage: () => storage, client: async () => ({ rpc }), uuid: () => J1 });
    await nextLoad.linkStartJourney("user-a");
    expect(rpc).toHaveBeenCalledTimes(1);
    // another account on the same device asks for itself (the database decides whose it is)
    await nextLoad.linkStartJourney("user-b");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("is remembered even when the journey was not this account's to take (false)", async () => {
    const rpc = vi.fn<StartRpcClient["rpc"]>(async () => ({ data: false, error: null }));
    const { recorder, map } = setup({ client: async () => ({ rpc }) }, { [START_STORAGE_KEY]: JSON.stringify({ journeyId: J2 }) });
    await recorder.linkStartJourney("user-a");
    await recorder.linkStartJourney("user-a");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(JSON.parse(map.get(START_LINKED_KEY)!)).toEqual(["user-a"]);
  });

  it("tries again on the next call after an error, or with no client yet", async () => {
    const rpc = vi.fn<StartRpcClient["rpc"]>().mockResolvedValueOnce({ data: null, error: { message: "offline" } }).mockResolvedValue({ data: true, error: null });
    const { recorder, map } = setup({ client: async () => ({ rpc }) }, { [START_STORAGE_KEY]: JSON.stringify({ journeyId: J2 }) });
    await recorder.linkStartJourney("user-a");
    expect(map.get(START_LINKED_KEY)).toBeUndefined();
    await recorder.linkStartJourney("user-a");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(JSON.parse(map.get(START_LINKED_KEY)!)).toEqual(["user-a"]);

    let client: StartRpcClient | null = null;
    const later = setup({ client: async () => client }, { [START_STORAGE_KEY]: JSON.stringify({ journeyId: J2 }) });
    await later.recorder.linkStartJourney("user-a");
    client = { rpc: later.rpc };
    await later.recorder.linkStartJourney("user-a");
    expect(later.rpc).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a journey on the device, or without a user, and makes no journey", async () => {
    const { recorder, rpc, storage } = setup();
    await recorder.linkStartJourney("user-a");
    await recorder.linkStartJourney("");
    expect(rpc).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    // once this page load has a journey, it links that one
    recorder.recordStartStep("start_shown");
    await recorder.linkStartJourney("user-a");
    expect(rpc).toHaveBeenCalledWith(LINK_START_JOURNEY, { p_journey: J1 });
  });

  it("never rejects: not when the client throws, nor when storage does", async () => {
    const rpc = vi.fn<StartRpcClient["rpc"]>(async () => {
      throw new Error("network");
    });
    const { recorder, world } = setup({ client: async () => ({ rpc }) }, { [START_STORAGE_KEY]: JSON.stringify({ journeyId: J2 }) });
    await expect(recorder.linkStartJourney("user-a")).resolves.toBeUndefined();
    world.broken = true;
    await expect(recorder.linkStartJourney("user-a")).resolves.toBeUndefined();
    const loadFails = setup({ client: async () => Promise.reject(new Error("chunk failed")) }, { [START_STORAGE_KEY]: JSON.stringify({ journeyId: J2 }) });
    await expect(loadFails.recorder.linkStartJourney("user-a")).resolves.toBeUndefined();
  });

  it("keeps at most 20 accounts on a shared device", async () => {
    const many = Array.from({ length: 20 }, (_, i) => `user-${i}`);
    const { recorder, map } = setup({}, { [START_STORAGE_KEY]: JSON.stringify({ journeyId: J2 }), [START_LINKED_KEY]: JSON.stringify(many) });
    await recorder.linkStartJourney("user-new");
    const kept = JSON.parse(map.get(START_LINKED_KEY)!);
    expect(kept).toHaveLength(20);
    expect(kept.at(-1)).toBe("user-new");
    expect(kept[0]).toBe("user-1");
  });
});

describe("helpers", () => {
  it("cleanStartStepMeta keeps flat values the route takes, at most 8 keys", () => {
    expect(cleanStartStepMeta({ grade: 3, course: "algebra1", solved: true, none: null, nan: Number.NaN, list: [1] as never, fn: (() => 1) as never })).toEqual({ grade: 3, course: "algebra1", solved: true, none: null });
    expect(Object.keys(cleanStartStepMeta(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i])))!)).toHaveLength(8);
    expect(cleanStartStepMeta(null)).toBeNull();
    expect(cleanStartStepMeta({})).toBeNull();
  });

  it("isStartEvent knows the contract's events and nothing else", () => {
    for (const e of START_EVENTS) expect(isStartEvent(e)).toBe(true);
    for (const x of ["", "start", "plan_shown", null, 3]) expect(isStartEvent(x)).toBe(false);
  });

  it("randomUuid makes a v4 uuid the route takes, with or without crypto.randomUUID", () => {
    expect(StartStepRequestSchema.shape.journeyId.safeParse(randomUuid()).success).toBe(true);
    const real = globalThis.crypto.randomUUID;
    try {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
      const id = randomUuid();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(randomUuid()).not.toBe(id);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: real, configurable: true });
    }
  });
});
