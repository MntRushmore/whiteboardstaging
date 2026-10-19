/**
 * The learning tracker's golden results: every parity scenario (`scenarios.ts`) through the web's
 * `AttemptTracker` (`src/lib/learning/tracker.ts`) with the real skill classifier and the real
 * mistake classifier on the real engine, one JSON line per scenario, written next to the Swift
 * package. Its tests (`LearningParityTests.swift`) run the same steps through the iPad's tracker
 * (`ios/Packages/AgathonLive/Sources/AgathonLive/Learning`, the brain's `classify` and
 * `classifyMistake` in JavaScriptCore) and compare every record it published and saved, what it
 * keeps pending and what it keeps for the board's next visit.
 *
 *   LEARNING_GOLDEN_WRITE=1 npx vitest run src/__eval__/learning
 *       rewrites ios/Packages/AgathonLive/Tests/AgathonLiveTests/Fixtures/learning-golden.ndjson
 *
 * Without LEARNING_GOLDEN_WRITE this test fails when the committed file is no longer what the
 * tracker produces: the tracker (or a classifier) changed, so the Swift tracker must follow — write
 * the file again, run the Swift parity tests, and commit both.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getEngine } from "@/lib/live/engine";
import type { LiveEngine } from "@/lib/live/contracts";
import type { AttemptRecord, LearningSignal } from "@/lib/learning/contracts";
import { AttemptTracker, type SavedAttempt } from "@/lib/learning/tracker";
import { attemptId, BOARD, scenarios, type Scenario } from "./scenarios";

const GOLDEN = resolve(__dirname, "../../../ios/Packages/AgathonLive/Tests/AgathonLiveTests/Fixtures/learning-golden.ndjson");
const WRITE = process.env.LEARNING_GOLDEN_WRITE === "1";

/** What the tracker did, in order. */
type Event =
  | { t: "publish"; record: AttemptRecord }
  | { t: "save"; records: AttemptRecord[] }
  | { t: "flush"; error: string | null }
  | { t: "snapshot"; attempts: SavedAttempt[] };

/** Lets the local mistake classifier's promise (`engine().then`) land before the next step. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

async function run(scenario: Scenario, engine: LiveEngine): Promise<Record<string, unknown>> {
  const events: Event[] = [];
  let now = 0;
  let ids = 0;
  let saveResult: string = "ok";
  const make = () =>
    new AttemptTracker({
      now: () => now,
      newId: () => attemptId(++ids),
      course: scenario.course,
      save: async (records) => {
        events.push({ t: "save", records: JSON.parse(JSON.stringify(records)) as AttemptRecord[] });
        if (saveResult !== "ok") throw Object.assign(new Error(`save failed: ${saveResult}`), { code: saveResult });
      },
      publish: (record) => events.push({ t: "publish", record: JSON.parse(JSON.stringify(record)) as AttemptRecord }),
      engine: async () => engine,
    });
  let tracker = make();
  const keys = new Set<string>();
  for (const step of scenario.steps) {
    switch (step.kind) {
      case "signal": {
        const s: LearningSignal = step.signal;
        now = s.at;
        if ("problemKey" in s) keys.add(s.problemKey);
        tracker.handle(s);
        break;
      }
      case "tick":
        now = step.at;
        tracker.tick(step.at);
        break;
      case "flush":
        saveResult = step.result;
        try {
          await tracker.flush();
          events.push({ t: "flush", error: null });
        } catch (err) {
          events.push({ t: "flush", error: String((err as { code?: unknown }).code ?? "unknown") });
        }
        break;
      case "reopen": {
        const saved = JSON.parse(JSON.stringify(tracker.snapshot(BOARD))) as SavedAttempt[];
        events.push({ t: "snapshot", attempts: saved });
        tracker = make();
        tracker.restore(saved);
        break;
      }
    }
    await settle();
  }
  const attemptIds: Record<string, string | null> = {};
  for (const k of [...keys].sort()) attemptIds[k] = tracker.attemptIdFor(k) ?? null;
  return {
    name: scenario.name,
    course: scenario.course,
    steps: scenario.steps,
    events,
    final: {
      records: tracker.records(),
      pending: tracker.pending(),
      snapshot: tracker.snapshot(BOARD),
      attemptIds,
    },
  };
}

export async function goldenLines(): Promise<string[]> {
  // loaded before the first scenario: a classification never waits for the engine past its step
  const engine = await getEngine();
  const out: string[] = [];
  for (const s of scenarios()) out.push(JSON.stringify(await run(s, engine)));
  return out;
}

describe("learning tracker golden", () => {
  it("every scenario runs, with a unique name, and the file is current", { timeout: 120_000 }, async () => {
    const lines = await goldenLines();
    const names = lines.map((l) => (JSON.parse(l) as { name: string }).name);
    expect(new Set(names).size).toBe(names.length);
    // the scenarios exercise what they say: local mistakes, published records, saves
    const all = lines.map((l) => JSON.parse(l) as { events: Event[] });
    const published = all.flatMap((s) => s.events.filter((e): e is Extract<Event, { t: "publish" }> => e.t === "publish").map((e) => e.record));
    expect(published.some((r) => Object.keys(r.mistakes).length > 0)).toBe(true);
    expect(new Set(published.map((r) => r.outcome))).toEqual(new Set(["in_progress", "first_try", "self_corrected", "with_help", "tutor_solved", "unfinished"]));
    const text = `${lines.join("\n")}\n`;
    if (WRITE) {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, text);
      return;
    }
    expect(existsSync(GOLDEN), "no golden file: run `LEARNING_GOLDEN_WRITE=1 npx vitest run src/__eval__/learning`").toBe(true);
    const committed = readFileSync(GOLDEN, "utf8").split("\n");
    const fresh = text.split("\n");
    const stale = fresh.filter((l, i) => committed[i] !== l).map((l) => (l ? (JSON.parse(l) as { name: string }).name : "(end)"));
    expect(stale.slice(0, 10), "the learning golden results are stale: run `LEARNING_GOLDEN_WRITE=1 npx vitest run src/__eval__/learning`").toEqual([]);
    expect(committed.length).toBe(fresh.length);
  });
});
