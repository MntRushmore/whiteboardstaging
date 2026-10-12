/**
 * The browser's sender of the funnel steps (src/lib/funnel/record.ts): the one request it makes,
 * that it sends nothing without a session or for an unknown step, that it never rejects and never
 * waits for the answer, and which steps go once a page load (React effects) or every time (the
 * student's own actions). The session and fetch are fakes; no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFunnelRecorder, type FunnelRecorderDeps, type FunnelSession } from "../record";
import { FUNNEL_STEPS, type FunnelStep } from "../steps";

const URL_ = "https://abc.supabase.co";
const ANON = "anon-key";
const A: FunnelSession = { accessToken: "token-a", userId: "user-a" };
const B: FunnelSession = { accessToken: "token-b", userId: "user-b" };

const ACTIONS: FunnelStep[] = ["welcome_skipped", "welcome_started", "tour_skipped", "checkout_opened"];
const ONCE: FunnelStep[] = FUNNEL_STEPS.filter((s) => !ACTIONS.includes(s));

/** A recorder over a fake fetch that answers 204, and the session `session` (changeable). */
function setup(over: Partial<FunnelRecorderDeps> = {}) {
  const world = { session: A as FunnelSession | null };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
  const record = createFunnelRecorder({ url: URL_, anonKey: ANON, getSession: async () => world.session, fetch, ...over });
  const calls = () => fetch.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit, body: JSON.parse(String((init as RequestInit).body)) }));
  return { world, fetch, record, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the request", () => {
  it("POSTs record_funnel_step as the student, keepalive, with the step and its cleaned details", async () => {
    const { record, calls } = setup();
    await record("plan_shown", { view: "offer", kid: true, nested: { no: 1 }, gone: undefined, why: "x".repeat(100) });
    expect(calls()).toEqual([
      {
        url: `${URL_}/rest/v1/rpc/record_funnel_step`,
        init: {
          method: "POST",
          headers: { apikey: ANON, Authorization: "Bearer token-a", "Content-Type": "application/json" },
          body: expect.any(String),
          keepalive: true,
        },
        body: { p_step: "plan_shown", p_meta: { view: "offer", kid: true, why: "x".repeat(80) } },
      },
    ]);
  });

  it("sends p_meta null when there are no details, or none survive cleaning", async () => {
    const { record, calls } = setup();
    await record("checkout_opened");
    await record("checkout_opened", {});
    await record("checkout_opened", { nested: { a: 1 } });
    expect(calls().map((c) => c.body)).toEqual(Array(3).fill({ p_step: "checkout_opened", p_meta: null }));
  });

  it("takes the project URL with a trailing slash", async () => {
    const { record, calls } = setup({ url: `${URL_}/` });
    await record("welcome_shown");
    expect(calls()[0]?.url).toBe(`${URL_}/rest/v1/rpc/record_funnel_step`);
  });
});

describe("nothing to send", () => {
  it("signed out: no request", async () => {
    const { world, record, fetch } = setup();
    world.session = null;
    await record("checkout_opened", { view: "offer" });
    await record("plan_shown");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a session without a token: no request", async () => {
    const { world, record, fetch } = setup();
    world.session = { accessToken: "", userId: "user-a" };
    await record("plan_shown");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an unknown step: no request, and the session is not even read", async () => {
    const getSession = vi.fn(async () => A);
    const { record, fetch } = setup({ getSession });
    await record("plan_seen" as FunnelStep);
    await record("" as FunnelStep);
    expect(fetch).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("no Supabase URL or anon key: no request", async () => {
    for (const over of [{ url: undefined }, { url: "" }, { anonKey: undefined }]) {
      const { record, fetch } = setup(over);
      await record("plan_shown");
      expect(fetch, JSON.stringify(over)).not.toHaveBeenCalled();
    }
  });
});

describe("never in the student's way", () => {
  it("a fetch that rejects, or throws, never rejects the step", async () => {
    const rejecting = setup({ fetch: vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) });
    await expect(rejecting.record("checkout_opened", { view: "offer" })).resolves.toBeUndefined();
    const throwing = setup({
      fetch: vi.fn(() => {
        throw new Error("no fetch here");
      }),
    });
    await expect(throwing.record("checkout_opened")).resolves.toBeUndefined();
  });

  it("a session read that fails never rejects the step, and sends nothing", async () => {
    const { record, fetch } = setup({ getSession: () => Promise.reject(new Error("storage blocked")) });
    await expect(record("plan_shown")).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves once the request is handed to fetch, not when it is answered", async () => {
    let answer: (res: Response) => void = () => {};
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>((resolve) => (answer = resolve)));
    const { record } = setup({ fetch });
    let done = false;
    const sending = record("checkout_opened", { view: "offer" }).then(() => {
      done = true;
    });
    await sending;
    expect(done).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    answer(new Response(null, { status: 204 }));
  });
});

describe("once a page load, or every time", () => {
  it("a step from a React effect goes once per account per page load (StrictMode's second run, a re-render)", async () => {
    const { record, calls } = setup();
    for (const step of ONCE) {
      await Promise.all([record(step, { view: "offer" }), record(step, { view: "offer" })]);
      await record(step, { view: "restart" });
    }
    expect(calls().map((c) => c.body.p_step)).toEqual(ONCE);
  });

  it("the student's own actions go every time", async () => {
    const { record, calls } = setup();
    for (const step of ACTIONS) {
      await record(step);
      await record(step);
    }
    expect(calls().map((c) => c.body.p_step)).toEqual(ACTIONS.flatMap((s) => [s, s]));
  });

  it("the once is per account: another student signed in on the same page load still counts", async () => {
    const { world, record, calls } = setup();
    await record("welcome_shown");
    world.session = B;
    await record("welcome_shown");
    world.session = A;
    await record("welcome_shown");
    expect(calls().map((c) => c.init.headers)).toEqual([
      expect.objectContaining({ Authorization: "Bearer token-a" }),
      expect.objectContaining({ Authorization: "Bearer token-b" }),
    ]);
  });

  it("signed out the first time, a step from an effect still goes once there is a session", async () => {
    const { world, record, fetch } = setup();
    world.session = null;
    await record("plan_shown");
    world.session = A;
    await record("plan_shown");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("each recorder (a page load) starts afresh", async () => {
    const first = setup();
    await first.record("tour_done");
    const second = setup();
    await second.record("tour_done");
    expect(first.fetch).toHaveBeenCalledTimes(1);
    expect(second.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("the app's recorder", () => {
  it("reads the session from the app's Supabase client and sends with the public env", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "local-anon");
    const getSession = vi.fn(async () => ({ data: { session: { access_token: "jwt-1", user: { id: "u-1" } } } }));
    vi.doMock("@/lib/supabase", () => ({ supabase: { auth: { getSession } } }));
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    try {
      const { recordFunnelStep } = await import("../record");
      await recordFunnelStep("plan_shown", { view: "offer" });
      await recordFunnelStep("plan_shown", { view: "offer" });
      expect(getSession).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:54321/rest/v1/rpc/record_funnel_step");
      expect(init).toMatchObject({ method: "POST", keepalive: true, headers: { apikey: "local-anon", Authorization: "Bearer jwt-1" } });
      expect(JSON.parse(String(init.body))).toEqual({ p_step: "plan_shown", p_meta: { view: "offer" } });

      getSession.mockResolvedValueOnce({ data: { session: null } } as never);
      await recordFunnelStep("checkout_opened");
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("@/lib/supabase");
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
