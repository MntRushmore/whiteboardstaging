import { describe, expect, it, vi } from "vitest";
import { PROBE_FIGURE } from "@/lib/live/chat/figure";
import { LectureRequestSchema } from "@/lib/live/lecture/contracts";
import { LECTURE_SYSTEM_PROMPT } from "@/lib/server/prompts/lecture";
import { directLecture, droppedNotes, FIGURE_NOT_DRAWN, LECTURE_ATTEMPT_MS, LECTURE_MAX_TOKENS, lectureMinuteId, lectureReasoning, SKETCH_NOT_DRAWN, type LectureModelCall, type ParsedLectureRequest } from "./lectureDirector";

const MODELS = { lecture: "openai/gpt-5.4-mini", lectureFallback: "deepseek/deepseek-v4.1-flash" };
const REQUEST: ParsedLectureRequest = LectureRequestSchema.parse({
  boardId: "board-1",
  session: "sess-0001",
  context: "Last week: supply and demand.",
  fresh: "GDP grew 2.3 percent in 2019, fell 3.4 percent in 2020 and grew 5.9 percent in 2021.",
  screen: { empty: false, topic: "Economic Growth", drawn: ["heading: Economic Growth"], room: 0.7 },
  recent: ["concept map: Factors of production"],
});
const BAR = { type: "chart", chart: { kind: "bar", title: "GDP growth", labels: ["2019", "2020", "2021"], series: [{ values: [2.3, -3.4, 5.9] }], unit: "%" } };

/** A model that answers `actions` (as the route's `chatJsonWithFallback` would, already read leniently). */
function model(actions: unknown[], answered = MODELS.lecture) {
  return vi.fn<LectureModelCall>(async () => ({ data: { actions }, model: answered }));
}

describe("directLecture", () => {
  it("one call: the production pair, the prompt, the transcript, a short budget, low reasoning, latency first", async () => {
    const call = model([BAR]);
    const out = await directLecture(REQUEST, { models: MODELS, callModel: call, requestId: "req-1" });
    expect(out).toEqual({ actions: [BAR], notes: [], proposed: 1, dropped: [], model: MODELS.lecture });
    expect(call).toHaveBeenCalledTimes(1);
    const [primary, fallback, opts] = call.mock.calls[0];
    expect([primary, fallback]).toEqual([MODELS.lecture, MODELS.lectureFallback]);
    expect(opts).toMatchObject({ maxTokens: LECTURE_MAX_TOKENS, attemptTimeoutMs: LECTURE_ATTEMPT_MS, latencyFirst: true, requestId: "req-1" });
    expect(opts.messages[0].content).toBe(LECTURE_SYSTEM_PROMPT);
    const user = String(opts.messages[1].content);
    expect(user).toContain("TOPIC: Economic Growth");
    expect(user).toContain("- concept map: Factors of production");
    expect(user).toContain(REQUEST.fresh);
    expect(user).toContain("LIVE HERE: none");
    expect(opts.reasoningFor?.(MODELS.lecture)).toBe("minimal");
    expect(opts.reasoningFor?.(MODELS.lectureFallback)).toBe("low");
    // two attempts and the checks fit the route's 30 s
    expect(2 * LECTURE_ATTEMPT_MS).toBeLessThan(30_000);
  });

  it("reasoning: minimal for OpenAI's models, low for the others, none for Anthropic's (its thinking budget starts at 1024 tokens)", () => {
    expect(lectureReasoning("openai/gpt-5.4-mini")).toBe("minimal");
    expect(lectureReasoning("deepseek/deepseek-v4.1-flash")).toBe("low");
    expect(lectureReasoning("anthropic/claude-haiku-4.5")).toBeUndefined();
  });

  it("a deliberate nothing: no actions, nothing dropped, no notes", async () => {
    const out = await directLecture(REQUEST, { models: MODELS, callModel: model([]) });
    expect(out).toMatchObject({ actions: [], notes: [], proposed: 0, dropped: [] });
  });

  it("the fallback's answer says which model answered", async () => {
    const out = await directLecture(REQUEST, { models: MODELS, callModel: model([BAR], MODELS.lectureFallback) });
    expect(out.model).toBe(MODELS.lectureFallback);
  });

  it("drops the invalid, the topic again and what is already drawn (here or before); notes say what the student would miss", async () => {
    const out = await directLecture(
      { ...REQUEST, screen: { ...REQUEST.screen, drawn: ["heading: Economic Growth", "bar chart: GDP growth"] } },
      {
        models: MODELS,
        callModel: model([
          { type: "heading", text: "economic growth" },
          BAR,
          { type: "diagram", diagram: { kind: "hub", center: "Factors of production", spokes: ["Land", "Labour"] } },
          { type: "chart", chart: { kind: "bar", labels: ["A"], series: [{ values: [1] }] } },
        ]),
      },
    );
    expect(out.actions).toEqual([]);
    expect(out.proposed).toBe(4);
    expect(out.dropped.map((d) => d.why)).toEqual(["topic", "repeat", "repeat", "invalid"]);
    expect(out.notes).toEqual([SKETCH_NOT_DRAWN, "Already on the board: bar chart: GDP growth", "Already on the board: concept map: Factors of production"]);
  });

  it("free drawing: a comic asked for goes on whole; a second sketch in the reply is left out without a note; a comic already drawn is said to be there", async () => {
    const comic = {
      type: "sketch",
      title: "Officer Vega",
      cast: "Officer Vega: a tall officer in a visor helmet and a long coat; a neon city at night",
      panels: [
        { prompt: "Officer Vega is outnumbered by rogue drones in a dark alley", caption: "Outnumbered" },
        { prompt: "Officer Vega is scolded by the chief in a cluttered office", caption: "No backup" },
        { prompt: "Officer Vega trains a young recruit on a rooftop at dawn", caption: "A new partner" },
        { prompt: "Officer Vega looks out over a calm city at sunrise", caption: "The future" },
      ],
    };
    const req = LectureRequestSchema.parse({ ...REQUEST, screen: { empty: true, room: 1 }, recent: [], fresh: "I want four panels about a futuristic police officer." });
    const out = await directLecture(req, { models: MODELS, callModel: model([comic, { type: "sketch", panels: [{ prompt: "a police car" }] }]) });
    expect(out.actions).toEqual([comic]);
    expect(out.dropped.map((d) => d.why)).toEqual(["sketch"]);
    expect(out.notes).toEqual([]);
    const again = await directLecture({ ...req, recent: ["comic (4 panels): Officer Vega"] }, { models: MODELS, callModel: model([comic]) });
    expect(again.actions).toEqual([]);
    expect(again.notes).toEqual(["Already on the board: comic (4 panels): Officer Vega"]);
  });

  it("a figure the drawer rejects is dropped, with no repair call; a clean one goes on", async () => {
    const bad = model([{ type: "draw_figure", figure: PROBE_FIGURE }, BAR]);
    const out = await directLecture(REQUEST, { models: MODELS, callModel: bad, checkFigure: () => ["side BC is not drawn"] });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(out.actions).toEqual([BAR]);
    expect(out.dropped).toEqual([{ type: "draw_figure", why: "figure", reason: "side BC is not drawn" }]);
    expect(out.notes).toEqual([FIGURE_NOT_DRAWN]);
    // a check that throws is a problem, not a crash
    const thrown = await directLecture(REQUEST, {
      models: MODELS,
      callModel: model([{ type: "draw_figure", figure: PROBE_FIGURE }]),
      checkFigure: () => {
        throw new Error("boom");
      },
    });
    expect(thrown.actions).toEqual([]);
    expect(thrown.dropped[0]).toMatchObject({ why: "figure", reason: "boom" });
    // the real drawer's check passes the probe triangle
    const real = await directLecture(REQUEST, { models: MODELS, callModel: model([{ type: "draw_figure", figure: PROBE_FIGURE }]) });
    expect(real.actions).toEqual([{ type: "draw_figure", figure: PROBE_FIGURE }]);
  });

  it("the model call's failure is the caller's (the route turns it into a refunded 502)", async () => {
    const failing = vi.fn<LectureModelCall>(async () => {
      throw new Error("upstream down");
    });
    await expect(directLecture(REQUEST, { models: MODELS, callModel: failing })).rejects.toThrow("upstream down");
  });

  it("live: an update of the screen's live chart goes on; one of a visual not there, or not grown from it, does not", async () => {
    const SALES = { kind: "bar", title: "Sales", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ values: [12, null, null, null] }], unit: "million" } as const;
    const live = LectureRequestSchema.parse({ ...REQUEST, screen: { ...REQUEST.screen, active: [{ id: "c1", chart: SALES }], drawn: ["bar chart: Sales"] } });
    const grown = { ...SALES, series: [{ values: [12, 15, null, null] }] };
    const ok = await directLecture(live, { models: MODELS, callModel: model([{ type: "update_chart", target: "c1", chart: grown }]) });
    // the chart is in "drawn" (it is on the screen): an update of it is not a repeat
    expect(ok).toMatchObject({ actions: [{ type: "update_chart", target: "c1", chart: grown }], notes: [], dropped: [] });
    // the model saw the live chart with its id and its spec
    const seen = model([]);
    await directLecture(live, { models: MODELS, callModel: seen });
    expect(String(seen.mock.calls[0][2].messages[1].content)).toContain(`LIVE HERE (update one with its id; newest first):\n- "c1": ${JSON.stringify(SALES)}`);
    const bad = await directLecture(live, {
      models: MODELS,
      callModel: model([
        { type: "update_chart", target: "c9", chart: grown },
        { type: "update_chart", target: "c1", chart: { ...grown, labels: ["Q2", "Q3", "Q4", "Q5"] } },
      ]),
    });
    expect(bad.actions).toEqual([]);
    expect(bad.dropped.map((d) => d.why)).toEqual(["target", "target"]);
    expect(bad.notes).toEqual([SKETCH_NOT_DRAWN]);
    // the same chart again is nothing, and nothing to say
    const same = await directLecture(live, { models: MODELS, callModel: model([{ type: "update_chart", target: "c1", chart: SALES }]) });
    expect(same).toMatchObject({ actions: [], notes: [], dropped: [{ why: "unchanged" }] });
  });

  it("the minute a request is billed under: one per wall-clock minute of a session", () => {
    const t = Date.UTC(2026, 8, 28, 12, 0, 0);
    expect(lectureMinuteId("sess-0001", t)).toBe(`lec:sess-0001:${t / 60_000}`);
    expect(lectureMinuteId("sess-0001", t + 59_999)).toBe(lectureMinuteId("sess-0001", t));
    expect(lectureMinuteId("sess-0001", t + 60_000)).not.toBe(lectureMinuteId("sess-0001", t));
    expect(lectureMinuteId("sess-0002", t)).not.toBe(lectureMinuteId("sess-0001", t));
    // within usage_events.request_id's 100 characters for the longest session id
    expect(lectureMinuteId("x".repeat(40), t).length).toBeLessThanOrEqual(100);
  });

  it("notes: once each, at most eight, each within 200 characters", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ type: "chart", why: "repeat" as const, reason: "", what: `bar chart ${i}: ${"x".repeat(250)}` }));
    const notes = droppedNotes([{ type: "graph", why: "invalid", reason: "" }, { type: "graph", why: "invalid", reason: "" }, ...many]);
    expect(notes).toHaveLength(8);
    expect(notes[0]).toBe(SKETCH_NOT_DRAWN);
    expect(notes.every((n) => n.length <= 200)).toBe(true);
    expect(droppedNotes([{ type: "note", why: "note", reason: "" }, { type: "diagram", why: "limit", reason: "" }])).toEqual([]);
  });
});
