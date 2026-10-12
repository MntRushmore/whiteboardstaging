/**
 * The onboarding records its funnel steps (src/lib/funnel/record.ts, mocked here): the plan screen
 * records `plan_shown` (with `kid` for a kid profile) and `checkout_opened` before it opens Stripe's
 * checkout, which it opens even when the record never answers (CHECKOUT_RECORD_WAIT_MS); the
 * welcome records `welcome_shown` and its Skip `welcome_skipped`.
 *
 * The markup is the server render, with React's effects run in place (`useEffect` below) so the
 * screens' effects record what they would in the browser; the plan card is a fake that hands back
 * its Start button's handler. The session, the plan, the referral read and the router are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NO_UNLIMITED, type UnlimitedState } from "@/lib/billing/unlimited";

const world = vi.hoisted(() => ({
  email: "parent@example.com",
  state: null as unknown as import("@/lib/billing/unlimited").UnlimitedState,
  referral: { referred: false, known: true },
  offer: null as null | { view: string; kid?: boolean; onStart: () => void },
}));
const record = vi.hoisted(() => vi.fn<(step: string, meta?: Record<string, unknown>) => Promise<void>>());
const save = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, value: { course: null, grade: null, onboarded_at: "2026-10-12T00:00:00Z" } })));

// effects run during the server render, as they would after the browser's first paint
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => void) => {
    effect();
  },
}));
vi.mock("@/lib/funnel/record", () => ({ recordFunnelStep: record }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }) }));
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-parent", email: world.email }, session: null, loading: false, authError: null, retryAuth: () => undefined }),
  AuthErrorBanner: () => null,
}));
vi.mock("@/components/app/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/lib/billing/useUnlimited", () => ({ useUnlimited: () => ({ state: world.state, loading: false, known: true, refresh: () => undefined }) }));
vi.mock("@/lib/billing/useReferred", () => ({ useReferred: () => world.referral }));
vi.mock("../PlanOffer", () => ({
  PlanOffer: (props: { view: string; kid?: boolean; onStart: () => void }) => {
    world.offer = props;
    return null;
  },
}));
// the welcome's reads and writes
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/email/client", () => ({ sendWelcomeEmail: async () => undefined }));
vi.mock("@/lib/onboarding/storage", () => ({
  asOnboardingClient: (client: unknown) => client,
  fetchOnboardingProfile: async () => ({ ok: true, value: { course: null, grade: null, onboarded_at: null } }),
  saveOnboarding: save,
}));
vi.mock("@/lib/onboarding/state", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/onboarding/state")>();
  return { ...real, welcomeDecision: vi.fn(real.welcomeDecision) };
});

const { PlanScreen } = await import("../PlanScreen");
const { useWelcome } = await import("../useWelcome");
const { welcomeDecision } = await import("@/lib/onboarding/state");

const REF = "0f8fad5b-d9cb-469f-a165-70867728950e";
const MONTHLY = "https://buy.stripe.com/test_monthly";
const REFERRAL = "https://buy.stripe.com/test_referral";

function planScreen(state: Partial<UnlimitedState> = {}) {
  world.state = { ...NO_UNLIMITED, checkoutRef: REF, ...state };
  world.offer = null;
  renderToStaticMarkup(<PlanScreen />);
  if (!world.offer) throw new Error("the plan card did not show");
  return world.offer;
}

/** Start the free trial, with `window.location.assign` watched. */
function start(offer: { onStart: () => void }) {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { assign } });
  offer.onStart();
  return assign;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T16:00:00Z"));
  vi.stubEnv("NEXT_PUBLIC_UNLIMITED_LINK", MONTHLY);
  vi.stubEnv("NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK", REFERRAL);
  record.mockReset();
  record.mockResolvedValue(undefined);
  save.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  world.email = "parent@example.com";
  world.referral = { referred: false, known: true };
});

describe("the plan screen's steps", () => {
  it("records plan_shown with the view the offer shows", () => {
    planScreen();
    expect(record).toHaveBeenCalledWith("plan_shown", { view: "offer" });
    record.mockClear();
    planScreen({ status: "canceled" });
    expect(record).toHaveBeenCalledWith("plan_shown", { view: "restart" });
  });

  it("says when it was a kid profile that saw it", () => {
    world.email = "kid-0f8fad5b@kids.agathon.app";
    planScreen();
    expect(record).toHaveBeenCalledWith("plan_shown", { view: "offer", kid: true });
  });

  it("records nothing while the plan is still being read", () => {
    world.referral = { referred: false, known: false };
    world.state = { ...NO_UNLIMITED, checkoutRef: REF };
    renderToStaticMarkup(<PlanScreen />);
    expect(record).not.toHaveBeenCalled();
  });

  it("Start the free trial records checkout_opened, then opens the checkout once it is recorded", async () => {
    const offer = planScreen();
    record.mockClear();
    const assign = start(offer);
    expect(record).toHaveBeenCalledWith("checkout_opened", { view: "offer", referred: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(assign).toHaveBeenCalledTimes(1);
    const url = new URL(String(assign.mock.calls[0]?.[0]));
    expect(`${url.origin}${url.pathname}`).toBe(MONTHLY);
    expect(url.searchParams.get("client_reference_id")).toBe(REF);
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(assign.mock.invocationCallOrder[0]);
  });

  it("opens the checkout anyway when the record never answers, after at most 400 ms", async () => {
    const offer = planScreen();
    record.mockImplementation(() => new Promise<void>(() => {}));
    const assign = start(offer);
    await vi.advanceTimersByTimeAsync(399);
    expect(assign).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(String(assign.mock.calls[0]?.[0])).toContain(MONTHLY);
  });

  it("a family a friend invited: referred, and the referral link", async () => {
    world.referral = { referred: true, known: true };
    const assign = start(planScreen());
    expect(record).toHaveBeenCalledWith("checkout_opened", { view: "offer", referred: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(String(assign.mock.calls[0]?.[0])).toContain(REFERRAL);
  });
});

describe("the welcome's steps", () => {
  type Welcome = ReturnType<typeof useWelcome>;
  /** the home's hook on a student with no boards, handed back after the render */
  function Probe({ got }: { got: (welcome: Welcome) => void }) {
    got(useWelcome("u-1", 0));
    return null;
  }
  function welcomeHook(): Welcome {
    let welcome: Welcome | null = null;
    renderToStaticMarkup(<Probe got={(w) => (welcome = w)} />);
    if (!welcome) throw new Error("the hook did not run");
    return welcome;
  }

  it("records welcome_shown when the welcome shows, and nothing while it is still deciding", () => {
    expect(welcomeHook().decision).toBe("checking");
    expect(record).not.toHaveBeenCalledWith("welcome_shown");
    vi.mocked(welcomeDecision).mockReturnValueOnce("show");
    expect(welcomeHook().decision).toBe("show");
    expect(record).toHaveBeenCalledWith("welcome_shown");
  });

  it("Skip records welcome_skipped with the step it was on, and still saves", () => {
    const welcome = welcomeHook();
    welcome.skip(null, 1);
    expect(record).toHaveBeenCalledWith("welcome_skipped", { step: 1 });
    welcome.skip("algebra1", 2, { heardFrom: "friend" });
    expect(record).toHaveBeenCalledWith("welcome_skipped", { step: 2 });
    expect(save).toHaveBeenCalledTimes(2);
  });
});
