/**
 * `StartResume` (root layout): once someone is signed in on a page other than /start and the device
 * holds /start answers for them, the old welcome is marked done at once and the answers are saved
 * (`resumeStartHere`, a lazy chunk, faked here); a finished save opens the plan screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { doneKey } from "@/lib/onboarding/marker";
import { START_PENDING_KEY } from "@/lib/start/pending";

const world = vi.hoisted(() => ({ user: null as { id: string } | null, replace: vi.fn(), resume: vi.fn() }));

// effects run during the server render, as they would after the browser's first paint
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => void) => {
    effect();
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: world.replace, push: () => undefined }) }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => ({ user: world.user, loading: false, authError: null }) }));
vi.mock("@/lib/start/resume", () => ({ resumeStartHere: world.resume }));

const { StartResume } = await import("../StartResume");

const USER = "11111111-2222-4333-8444-555555555555";
const NOW = Date.now();
let storage: Map<string, string>;

function on(pathname: string) {
  vi.stubGlobal("window", {
    location: { pathname },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) },
  });
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const pending = (userId?: string) => JSON.stringify({ answers: { role: "parent", name: "Sam" }, ...(userId ? { userId } : {}), createdAt: NOW });

beforeEach(() => {
  storage = new Map();
  world.user = { id: USER };
  world.replace.mockReset();
  world.resume.mockReset().mockResolvedValue({ kind: "finished", next: "/welcome/plan", result: {} });
  on("/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StartResume", () => {
  it("renders nothing", () => {
    expect(renderToStaticMarkup(<StartResume />)).toBe("");
  });

  it("nothing waiting: nothing loaded, nothing written", async () => {
    renderToStaticMarkup(<StartResume />);
    await settle();
    expect(world.resume).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });

  it("signed out: waits for a sign-in", async () => {
    world.user = null;
    storage.set(START_PENDING_KEY, pending());
    renderToStaticMarkup(<StartResume />);
    await settle();
    expect(world.resume).not.toHaveBeenCalled();
  });

  it("signed in with answers waiting: the welcome is skipped at once, the answers saved, the plan screen next", async () => {
    storage.set(START_PENDING_KEY, pending());
    renderToStaticMarkup(<StartResume />);
    expect(storage.get(doneKey(USER))).toBe("1");
    await settle();
    expect(world.resume).toHaveBeenCalledWith(USER);
    expect(world.replace).toHaveBeenCalledWith("/welcome/plan");
  });

  it("an onboarded account (answers dropped): stays where it is", async () => {
    world.resume.mockResolvedValue({ kind: "dropped" });
    storage.set(START_PENDING_KEY, pending());
    renderToStaticMarkup(<StartResume />);
    await settle();
    expect(world.replace).not.toHaveBeenCalled();
  });

  it("answers kept for another account: left alone", async () => {
    storage.set(START_PENDING_KEY, pending("someone-else"));
    renderToStaticMarkup(<StartResume />);
    await settle();
    expect(world.resume).not.toHaveBeenCalled();
    expect(storage.has(doneKey(USER))).toBe(false);
  });

  it("on /start itself: the account screen finishes its own sign-up", async () => {
    on("/start");
    storage.set(START_PENDING_KEY, pending());
    renderToStaticMarkup(<StartResume />);
    await settle();
    expect(world.resume).not.toHaveBeenCalled();
  });

  it("a chunk that fails to load: the answers wait for the next page", async () => {
    world.resume.mockRejectedValue(new Error("chunk"));
    storage.set(START_PENDING_KEY, pending());
    renderToStaticMarkup(<StartResume />);
    await settle();
    expect(world.replace).not.toHaveBeenCalled();
    expect(storage.has(START_PENDING_KEY)).toBe(true);
  });
});
