import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TOPIC_IDS } from "@/lib/learning/topics";

/**
 * The home has two `useTopicActions` (the skill path's stops, and Up next / Ask / Pick a topic). Each
 * tap makes a board before the page moves, so the page holds one lock: two quick taps anywhere on
 * it open one board, never two.
 */

type Created = { ok: true; value: string } | { ok: false; error: string };
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  created: [] as { title: string; resolve: (r: Created) => void }[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/logger", () => ({ clientMetric: vi.fn() }));
vi.mock("@/lib/reportAppError", () => ({ reportUserError: vi.fn() }));
vi.mock("@/lib/learning/practiceMarker", () => ({ writePracticeMarker: () => true }));
vi.mock("@/lib/boards/askKickoff", () => ({ writeAskKickoff: () => true }));
vi.mock("@/lib/learning/practiceSet", () => ({ topicSet: () => ({ problems: [{ latex: "1+1" }], examples: [] }) }));
vi.mock("@/lib/onboarding/storage", () => ({
  asOnboardingClient: (c: unknown) => c,
  // a board is "being made" until the test settles it
  createFirstBoard: (_client: unknown, _userId: string, title: string) =>
    new Promise<Created>((resolve) => {
      mocks.created.push({ title, resolve });
    }),
}));

const { claimTopicOpen, releaseTopicOpen, resetTopicOpeningForTests, topicOpening, useTopicActions } = await import("../useTopicStart");
type Actions = ReturnType<typeof useTopicActions>;

/** A card on the home: its own `useTopicActions`, handed to the test. */
function Card({ grade, take }: { grade?: 3; take: (actions: Actions) => void }) {
  take(useTopicActions("u1", grade));
  return null;
}

/** Two hooks on one page, as the home has them: the path card's and TopicStart's. */
function homeWithTwoCards(): { path: Actions; start: Actions } {
  const got: Partial<{ path: Actions; start: Actions }> = {};
  renderToStaticMarkup(
    <>
      <Card take={(a) => (got.path = a)} />
      <Card grade={3} take={(a) => (got.start = a)} />
    </>,
  );
  return got as { path: Actions; start: Actions };
}

/** let the dynamic import and the board's promise move on */
const settle = () => new Promise((r) => setTimeout(r, 0));

const [first, second] = TOPIC_IDS;

afterEach(async () => {
  // fail whatever is still being made, so the lock is free for the next test
  for (const c of mocks.created.splice(0)) c.resolve({ ok: false, error: "test over" });
  await settle();
  mocks.push.mockReset();
  expect(topicOpening()).toBeNull();
});

describe("one board at a time, for the whole home", () => {
  it("a path stop, then Up next, then Ask before the page moves: one board", async () => {
    const { path, start } = homeWithTwoCards();
    path.startTopic(first);
    start.startTopic(second);
    start.ask("I want help with my homework about volcanoes");
    path.startTopic(first);
    await settle();
    expect(mocks.created).toHaveLength(1);
    expect(topicOpening()).toBe(first);
  });

  it("Ask first, then a path stop: still one board", async () => {
    const { path, start } = homeWithTwoCards();
    start.ask("help me with my homework about volcanoes");
    path.startTopic(first);
    await settle();
    expect(mocks.created).toHaveLength(1);
    expect(topicOpening()).toBe("ask");
  });

  it("the board opens: the lock stays held while the page leaves", async () => {
    const { path, start } = homeWithTwoCards();
    path.startTopic(first);
    await settle();
    mocks.created[0].resolve({ ok: true, value: "board-1" });
    await settle();
    expect(mocks.push).toHaveBeenCalledWith("/board/board-1");
    expect(mocks.push).toHaveBeenCalledTimes(1);
    start.startTopic(second);
    start.ask("help me with my homework about volcanoes");
    await settle();
    expect(mocks.created).toHaveLength(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(topicOpening()).toBe(first);
    // the home unmounting gives it back through its holder (no effects in a server render)
    mocks.created.splice(0);
    resetTopicOpeningForTests();
  });

  it("the board could not be made: the lock is given back, and the other card can try", async () => {
    const { path, start } = homeWithTwoCards();
    path.startTopic(first);
    await settle();
    mocks.created[0].resolve({ ok: false, error: "offline" });
    await settle();
    expect(topicOpening()).toBeNull();
    start.startTopic(second);
    await settle();
    expect(mocks.created).toHaveLength(2);
    expect(topicOpening()).toBe(second);
  });
});

describe("the page's lock", () => {
  it("only its holder gives it back", () => {
    const a = {};
    const b = {};
    expect(claimTopicOpen(a, first)).toBe(true);
    expect(claimTopicOpen(b, second)).toBe(false);
    expect(claimTopicOpen(a, second)).toBe(false);
    releaseTopicOpen(b);
    expect(topicOpening()).toBe(first);
    releaseTopicOpen(a);
    expect(topicOpening()).toBeNull();
    expect(claimTopicOpen(b, second)).toBe(true);
    releaseTopicOpen(b);
  });
});
