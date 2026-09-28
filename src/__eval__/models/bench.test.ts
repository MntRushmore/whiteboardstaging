import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import { handInk, VARIANTS } from "../handwriting";
import { assignmentsIn, checkAnswer } from "./answers";
import { buildBody, callModel, SpendLedger, type CallSpec, type ModelInfo } from "./client";
import { FALLBACK_CANDIDATES, parseSolveReply, scoreFallbackReply, selectFallbackProblems } from "./fallback";
import { buildReadItems, inkSvg, scoreRepairReply, SYNTHETIC, CONTROL_COUNT } from "./misreads";
import { percentile, renderModelsMarkdown } from "./report";
import { referenceSolves, scoreWordReply, WORD_PROBLEMS } from "./wordProblems";

/**
 * The model bench's scorers, without a single model call: the references score right, obvious
 * wrong answers score wrong, and the client caps spend and caches. The bench itself only runs
 * with RUN_MODEL_BENCH=1 (models.test.ts).
 */
let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("job 1: word problems", () => {
  it("has 25 problems and the engine solves every reference setup to the known answer", () => {
    expect(WORD_PROBLEMS).toHaveLength(25);
    const failing = WORD_PROBLEMS.filter((p) => !referenceSolves(engine, p)).map((p) => p.id);
    expect(failing).toEqual([]);
  });

  it("scores a reply by what the engine makes of the setup", () => {
    const p = WORD_PROBLEMS.find((x) => x.id === "wp-02")!;
    // single backslashes inside the JSON string, as models write them
    expect(scoreWordReply(engine, p, '{"unknown": "v", "lines": ["v = \\frac{150}{2.5}"]}').outcome).toBe("correct");
    expect(scoreWordReply(engine, p, '```json\n{"unknown": "v", "lines": ["v = \\\\frac{150}{2.5}"]}\n```').outcome).toBe("correct");
    expect(scoreWordReply(engine, p, '{"unknown": "v", "lines": ["v = \\frac{150}{3}"]}').outcome).toBe("wrong-answer");
    expect(scoreWordReply(engine, p, "The speed is 60 km/h.").outcome).toBe("bad-json");
    // the engine answers both unknowns of a system; the one asked for is the one judged
    const system = WORD_PROBLEMS.find((x) => x.id === "wp-19")!;
    expect(scoreWordReply(engine, system, '{"unknown": "d", "lines": ["n + d = 25", "5n + 10d = 185"]}').correct).toBe(true);
    expect(scoreWordReply(engine, system, '{"unknown": "n", "lines": ["n + d = 25", "5n + 10d = 185"]}').correct).toBe(false);
    expect(scoreWordReply(engine, p, '{"unknown": "v", "lines": ["v = 60"]}').outcome).not.toBe("correct");
  });
});

describe("job 2: solve fallback", () => {
  it("keeps only problems the engine cannot do (at least 20 of the candidates today)", () => {
    const chosen = selectFallbackProblems(engine);
    expect(chosen.length, "the engine has learned most of the bench: add harder candidates to FALLBACK_CANDIDATES").toBeGreaterThanOrEqual(20);
  });

  it("accepts every candidate's own answer and rejects a wrong one", () => {
    const wrong = FALLBACK_CANDIDATES.filter((p) => !checkAnswer(p.expect, [`\\boxed{${p.answer}}`]).correct).map((p) => p.id);
    expect(wrong).toEqual([]);
    const accepted = FALLBACK_CANDIDATES.filter((p) => checkAnswer(p.expect, ["\\boxed{x = 7}"]).correct).map((p) => p.id);
    expect(accepted).toEqual([]);
  });

  it("reads assignments in the shapes models write them", () => {
    expect(assignmentsIn("\\boxed{(x, y) = (-1, 1), (3, 9)}")).toEqual({ x: [-1, 3], y: [1, 9] });
    expect(assignmentsIn("x = 2 \\text{ or } x = 3")).toEqual({ x: [2, 3] });
    expect(assignmentsIn("c = \\pm 10")).toEqual({ c: [10, -10] });
    expect(assignmentsIn("x = 20, \\ y = 5")).toEqual({ x: [20], y: [5] });
    expect(assignmentsIn("\\boxed{x = 0, \\frac{2\\pi}{3}}").x).toEqual([0, (2 * Math.PI) / 3]);
    expect(assignmentsIn("x\\in\\left\\{0,\\frac{2\\pi}{3}\\right\\}").x).toEqual([0, (2 * Math.PI) / 3]);
    expect(assignmentsIn("c = -\\frac{1}{2} \\lor c = 1").c).toEqual([-0.5, 1]);
    expect(assignmentsIn("\\boxed{(3,9),\\ (-1,1)}", ["x", "y"])).toEqual({ x: [3, -1], y: [9, 1] });
  });

  it("takes the same answer in the other shapes it is written in", () => {
    const system = FALLBACK_CANDIDATES.find((p) => p.id === "fb-18")!.expect;
    // one root per step, then the points
    expect(checkAnswer(system, ["x = 3 \\text{ or } x = -1", "y = 3^{2} = 9", "y = (-1)^{2} = 1"]).correct).toBe(true);
    // a root dropped: the last step decides
    expect(checkAnswer({ kind: "values", values: { y: [5] } }, ["y = \\pm 5", "y = 5"]).correct).toBe(true);
    const ineq = FALLBACK_CANDIDATES.find((p) => p.id === "fb-24")!.expect;
    expect(checkAnswer(ineq, ["\\boxed{x \\in (-\\infty, -2) \\cup (1, \\infty)}"]).correct).toBe(true);
    expect(checkAnswer(ineq, ["\\boxed{(-\\infty, -1) \\cup (2, \\infty)}"]).correct).toBe(false);
    expect(checkAnswer(ineq, ["x < -2 \\text{ or } x > 1"]).correct).toBe(true);
    const partial = FALLBACK_CANDIDATES.find((p) => p.id === "fb-06")!.expect;
    expect(checkAnswer(partial, ["\\boxed{\\frac12\\ln\\left|\\frac{x-1}{x+1}\\right|+C}"]).correct).toBe(true);
  });

  it("parses a JSON Lines reply like the route and runs every step through the guard", async () => {
    const p = FALLBACK_CANDIDATES.find((x) => x.id === "fb-09")!;
    const reply = [
      '{"index": 1, "latex": "= \\lim_{x \\to 0} \\frac{e^{x}}{1}", "explanation": "Use L\'Hopital.", "final": false}',
      "not json",
      '{"index": 2, "latex": "\\text{so the limit is one}", "explanation": "", "final": false}',
      '{"index": 3, "latex": "= 1", "explanation": "Substitute.", "final": false}',
    ].join("\n");
    const parsed = await parseSolveReply(reply);
    expect(parsed.invalid).toBe(1);
    expect(parsed.steps.map((s) => s.final)).toEqual([false, false, true]);
    expect(parsed.steps[2].latex).toBe("\\boxed{= 1}");
    const s = await scoreFallbackReply(engine, p, reply);
    expect(s.answerCorrect).toBe(true);
    expect(s.words).toBe(true);
    expect(s.usable).toBe(false);
    expect(s.steps[1]).toMatchObject({ ok: false, reason: "unparseable" });
  });
});

describe("job 3: misread repair", () => {
  const items = buildReadItems();

  it("builds misreads from the handwriting scoreboard, synthetic ones and controls", () => {
    expect(items.filter((i) => i.kind === "misread").length).toBeGreaterThanOrEqual(15);
    expect(items.filter((i) => i.kind === "synthetic")).toHaveLength(SYNTHETIC.length);
    expect(items.filter((i) => i.kind === "control")).toHaveLength(CONTROL_COUNT);
  });

  it("can draw every item's ink", () => {
    for (const it of items) {
      const ink = handInk(it.truth, VARIANTS.find((v) => v.name === it.variant)!);
      expect(ink.unsupported, it.truth).toEqual([]);
      expect(inkSvg(ink.strokes)).toMatch(/^<svg [^>]*width="\d+" height="\d+"/);
    }
  });

  it("scores the truth right, the misread wrong, and a kept control right", () => {
    const mis = items.find((i) => i.kind === "misread")!;
    expect(scoreRepairReply(mis, JSON.stringify({ latex: mis.truth, changed: true })).correct).toBe(true);
    expect(scoreRepairReply(mis, JSON.stringify({ latex: mis.read, changed: false }))).toMatchObject({ correct: false, changed: false });
    const ctl = items.find((i) => i.kind === "control")!;
    expect(scoreRepairReply(ctl, JSON.stringify({ latex: ctl.read, changed: false })).correct).toBe(true);
    expect(scoreRepairReply(ctl, "no").badJson).toBe(true);
  });
});

describe("client", () => {
  const info: ModelInfo = { id: "t/m", promptPrice: 1e-6, completionPrice: 1e-5, imagePrice: 0, temperature: false, responseFormat: true, reasoning: true, images: false };
  const spec: CallSpec = { model: "t/m", messages: [{ role: "user", content: "hi" }], maxTokens: 100, json: true, reasoning: "low", timeoutMs: 5_000 };
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "model-bench-"));
    process.env.OPENROUTER_API_KEY ??= "test-key";
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("leaves out parameters the model does not take", () => {
    const body = buildBody(spec, info);
    expect(body.temperature).toBeUndefined();
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.reasoning).toEqual({ effort: "low" });
  });

  it("caches, settles the real cost, and refuses a call that could pass the cap", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0002 } }), { status: 200 });
    }) as typeof fetch;
    const ledger = new SpendLedger(0.01, join(dir, "spend.json"));
    const catalog = new Map([["t/m", info]]);
    const first = await callModel(spec, { catalog, ledger, cacheDir: dir, fetchImpl });
    expect(first).toMatchObject({ ok: true, cached: false, costUsd: 0.0002, costSource: "usage" });
    const again = await callModel(spec, { catalog, ledger, cacheDir: dir, fetchImpl });
    expect(again.cached).toBe(true);
    expect(calls).toBe(1);
    expect(ledger.totalUsd).toBeCloseTo(0.0002);
    // worst case of a 2000-token reply at $10/M is $0.02 > the $0.01 cap
    const big = await callModel({ ...spec, maxTokens: 2000, messages: [{ role: "user", content: "other" }] }, { catalog, ledger, cacheDir: dir, fetchImpl });
    expect(big).toMatchObject({ ok: false, failure: "budget" });
    expect(calls).toBe(1);
  });
});

describe("report", () => {
  it("takes nearest-rank percentiles and keeps the written recommendation", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    const md = renderModelsMarkdown({
      run: { results: [], plans: [], missing: [], jobs: { word: [], fallback: [], repair: [] }, imageBytes: { min: 0, max: 0, mean: 0 } },
      spend: { totalUsd: 0, calls: 0, byModel: {} },
      spentThisRun: 0,
      catalogFetchedAt: "2026-01-01",
      misreadRate: 0.03,
      date: "2026-01-01",
      previous: "x\n<!-- recommendation:start -->\nUse model A.\n<!-- recommendation:end -->\ny",
    });
    expect(md).toContain("<!-- recommendation:start -->\nUse model A.\n<!-- recommendation:end -->");
  });
});
