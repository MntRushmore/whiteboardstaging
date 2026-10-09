import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TOPIC_IDS } from "@/lib/learning/topics";

/**
 * Today's practice takes the home's one lock (`claimTopicOpen`), as the topic cards do: Start and
 * Practise more make a board before the page moves, so a quick tap on Today's practice and one on a
 * skill-path stop or Up next must still open one board, never two.
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
vi.mock("@/lib/daily/inputs", () => ({ loadDailyPlanInput: async () => ({}) }));
vi.mock("@/lib/daily/plan", () => ({
  planDailySet: () => ({ day: "2026-10-08", goal: 1, problems: [{ skill: "add_subtract", lines: ["3 + 4"], why: "next" }] }),
  planSkills: () => [],
}));
vi.mock("@/lib/daily/store", () => ({
  loadDailyRows: async () => ({ rows: [], ok: true }),
  saveDailyPractice: async () => null,
}));
vi.mock("@/lib/onboarding/storage", () => ({
  asOnboardingClient: (c: unknown) => c,
  // a board is "being made" until the test settles it
  createFirstBoard: (_client: unknown, _userId: string, title: string) =>
    new Promise<Created>((resolve) => {
      mocks.created.push({ title, resolve });
    }),
}));

const { resetTopicOpeningForTests, topicOpening, useTopicActions } = await import("@/components/topics/useTopicStart");
const { useToday } = await import("../useToday");
type Today = ReturnType<typeof useToday>["actions"];
type Topics = ReturnType<typeof useTopicActions>;

function TodayCard({ take }: { take: (actions: Today) => void }) {
  take(useToday("u1").actions);
  return null;
}
function TopicCard({ take }: { take: (actions: Topics) => void }) {
  take(useTopicActions("u1"));
  return null;
}

/** The home as it is: Today's practice and a topic card side by side. */
function home(): { today: Today; topics: Topics } {
  const got: Partial<{ today: Today; topics: Topics }> = {};
  renderToStaticMarkup(
    <>
      <TodayCard take={(a) => (got.today = a)} />
      <TopicCard take={(a) => (got.topics = a)} />
    </>,
  );
  return got as { today: Today; topics: Topics };
}

/** let the dynamic imports and the board's promise move on */
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(async () => {
  for (const c of mocks.created.splice(0)) c.resolve({ ok: false, error: "test over" });
  await settle();
  mocks.push.mockReset();
  resetTopicOpeningForTests();
});

describe("Today's practice and the topic cards: one board at a time", () => {
  it("Today's Start, then a skill-path stop before the page moves: one board", async () => {
    const { today, topics } = home();
    today.start();
    expect(topicOpening()).toBe("daily");
    topics.startTopic(TOPIC_IDS[0]);
    topics.ask("help me with my homework about volcanoes");
    today.practiseMore();
    await settle();
    await settle();
    expect(mocks.created).toHaveLength(1);
    expect(mocks.created[0].title).toMatch(/Today's practice/);
  });

  it("a topic opening first: Today's Start and Practise more wait for it", async () => {
    const { today, topics } = home();
    topics.startTopic(TOPIC_IDS[0]);
    today.start();
    today.practiseMore();
    await settle();
    await settle();
    expect(mocks.created).toHaveLength(1);
    expect(topicOpening()).toBe(TOPIC_IDS[0]);
  });

  it("Today's board could not be made: the lock is given back, and a topic can open", async () => {
    const { today, topics } = home();
    today.start();
    await settle();
    await settle();
    expect(mocks.created).toHaveLength(1);
    mocks.created[0].resolve({ ok: false, error: "offline" });
    await settle();
    expect(topicOpening()).toBeNull();
    topics.startTopic(TOPIC_IDS[0]);
    await settle();
    expect(mocks.created).toHaveLength(2);
  });

  it("Today's board was made: the lock stays held while the page leaves", async () => {
    const { today, topics } = home();
    today.start();
    await settle();
    await settle();
    mocks.created[0].resolve({ ok: true, value: "b1000000-0000-4000-8000-000000000001" });
    await settle();
    await settle();
    expect(mocks.push).toHaveBeenCalledWith("/board/b1000000-0000-4000-8000-000000000001");
    topics.startTopic(TOPIC_IDS[0]);
    await settle();
    expect(mocks.created).toHaveLength(1);
    expect(topicOpening()).toBe("daily");
  });
});
