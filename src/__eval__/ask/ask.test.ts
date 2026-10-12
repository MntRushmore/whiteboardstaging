import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "@/lib/live/contracts";
import type { ChatAction } from "@/lib/live/chat/contracts";
import { getEngine } from "@/lib/live/engine";
import { buildAskMessages } from "@/lib/server/prompts/ask";
import { loadEnvLocal } from "../handwriting";
import { loadCatalog, MODELS_CACHE_DIR, SpendLedger } from "../models/client";
import { ASK_CORPUS, askRequestFor, learnerFor } from "./corpus";
import { askImageDataUrl } from "./images";
import { askSummary, renderAskMarkdown } from "./report";
import { CLAIMS_BOARD, checkFormat, checkLength, checkSays, checkVoice, countWords, judgeAskIntent, JUDGE_MODEL, modelConfig, runAsk, sentencesOf, type AskResult, type GateSummary } from "./run";

/**
 * The ASK eval (./run.ts). Offline, in every `vitest run`: the corpus covers every kind of ask, the
 * prompt builds for each (the pictures as image parts), and the scoring is right on hand-written
 * answers (a hint where a hint belongs, help aimed at the right problem, no board for another
 * subject, the length for the grade, the spoken format).
 *
 * With RUN_ASK_EVAL=1 (real streamed OpenRouter calls, cached under src/__eval__/.cache/models/ask/,
 * held under a $14 cap on its own ledger): every ask through the candidate models, judged by Sonnet
 * 5.5, and with EVAL_WRITE=1 docs/eval/ask.{md,json}.
 *
 *   npm run eval:ask                     RUN_ASK_EVAL=1 EVAL_WRITE=1
 *   ASK_EVAL_MODELS=a/b,c/d@default      only these (`@effort` overrides ASK_REASONING; `@default` sends none)
 *   ASK_EVAL_IDS=s-7-help-2,x-5-hurt     only these asks;  ASK_EVAL_GROUPS=safety,vision  only these groups
 *   ASK_EVAL_JUDGE=0                     no judging (or another judge model id)
 */
const RUN = process.env.RUN_ASK_EVAL === "1";
const ROOT = resolve(__dirname, "..", "..", "..");
export const ASK_SPEND_CAP_USD = 14;
/** the candidates: Haiku 5.5 (the provisional primary), GPT-5.4 mini (its fallback), Gemini 3.8 Flash, Sonnet 5.5, DeepSeek V4.1 Flash */
export const ASK_MODELS = ["anthropic/claude-haiku-5.5", "openai/gpt-5.4-mini", "google/gemini-3.8-flash", "anthropic/claude-sonnet-5.5", "deepseek/deepseek-v4.1-flash"] as const;

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const NO_GATE: GateSummary = { problems: 0, verified: 0, replaced: 0, teaches: 0, teachChecked: 0, teachRight: 0, proofs: 0, proved: 0, figures: 0, figuresClean: 0, models: 0, modelsClean: 0, graphs: 0, graphed: 0, lines: 0, linesOk: 0 };
const caseOf = (id: string) => ASK_CORPUS.find((c) => c.id === id)!;
const intent = (id: string, chosen: ChatAction[], final: ChatAction[] = chosen, gate: Partial<GateSummary> = {}) =>
  judgeAskIntent(caseOf(id), { proposed: chosen.length, chosen, final, gate: { ...NO_GATE, ...gate }, missingHelp: false, nothingToHelp: false });

describe("eval: Ask (offline)", () => {
  it("about 70 asks over every kind, mostly K–8, with real pictures and the safety cases", () => {
    expect(ASK_CORPUS.length).toBeGreaterThanOrEqual(70);
    expect(new Set(ASK_CORPUS.map((c) => c.id)).size).toBe(ASK_CORPUS.length);
    expect(new Set(ASK_CORPUS.map((c) => c.group))).toEqual(new Set(["problems", "explain", "fact", "socratic", "target", "board", "highschool", "subject", "voice", "grade", "safety", "memory", "vision", "model"]));
    expect(ASK_CORPUS.filter((c) => c.grade !== undefined).length / ASK_CORPUS.length).toBeGreaterThan(0.75);
    expect(ASK_CORPUS.filter((c) => c.image).length).toBeGreaterThanOrEqual(4);
    // the same question at K, 2, 4, 7 and Algebra 1
    const equals = ASK_CORPUS.filter((c) => c.group === "grade");
    expect(equals.map((c) => c.grade ?? c.course)).toEqual([0, 2, 4, 7, "algebra1"]);
    expect(new Set(equals.map((c) => c.message)).size).toBe(1);
    // another subject never gets a board block
    for (const c of ASK_CORPUS.filter((x) => x.subject === "other")) expect(c.expect.board, c.id).toBe("none");
    expect(caseOf("x-7-self-harm").expect.says?.some((re) => re.test("call or text 988"))).toBe(true);
    // both kinds of help on the screen, both depths
    expect(ASK_CORPUS.some((c) => c.expect.help?.depth === "step") && ASK_CORPUS.some((c) => c.expect.help?.depth === "solve")).toBe(true);
    expect(ASK_CORPUS.some((c) => c.expect.helpBoard === "step") && ASK_CORPUS.some((c) => c.expect.helpBoard === "solve")).toBe(true);
  });

  it("the production prompt builds for every ask; a picture goes as an image part", async () => {
    for (const c of ASK_CORPUS) {
      const image = c.image ? await askImageDataUrl(c.image) : undefined;
      const messages = buildAskMessages(askRequestFor(c, image), { learner: learnerFor(c) });
      const last = messages.at(-1)!;
      if (image) {
        expect(Array.isArray(last.content), c.id).toBe(true);
        expect((last.content as Array<{ type: string; image_url?: { url: string } }>)[0]).toEqual({ type: "image_url", image_url: { url: image } });
        expect(image.length).toBeLessThan(700_000);
      } else expect(String(last.content), c.id).toContain(`THE STUDENT SAYS (answer them directly, as their tutor):\n${c.message}`);
      expect(messages.length).toBe(2 + (c.history?.length ?? 0));
    }
  });

  it("scoring the board: a hint (no action) or the right step passes; the wrong problem, a solve or another type does not", () => {
    expect(intent("s-7-help-2", [])).toEqual({ ok: true, why: "" });
    expect(intent("s-7-help-2", [{ type: "help_problem", problem: 2, depth: "step" }]).ok).toBe(true);
    expect(intent("s-7-help-2", [{ type: "help_problem", problem: 2, depth: "solve" }]).why).toBe("help_problem 2 solve, not 2 step");
    expect(intent("s-7-help-2", [{ type: "help_problem", problem: 3, depth: "step" }]).why).toBe("help_problem 3 step, not 2 step");
    expect(intent("s-7-help-2", [{ type: "teach", steps: [{ say: "Add 4.", math: [] }] }]).why).toBe("teach where it does not belong");
    // asked for: the action must come, and reach the board
    expect(intent("s-7-solve-3", []).why).toBe("no help_problem (no action)");
    expect(intent("s-7-solve-3", [{ type: "help_problem", problem: 3, depth: "solve" }]).ok).toBe(true);
    // their own work is help_board, never help_problem
    expect(intent("t-7-own-vs-listed", [{ type: "help_board", depth: "solve" }]).ok).toBe(true);
    expect(intent("t-7-own-vs-listed", [{ type: "help_problem", problem: 2, depth: "solve" }]).why).toBe("help_problem where it does not apply");
    // another subject: no block at all
    expect(intent("o-5-plants", [{ type: "write_lines", lines: ["6CO_2"] }]).ok).toBe(false);
    // a worked solution the engine dropped, or with the wrong answer
    const teach: ChatAction = { type: "teach", steps: [{ say: "Subtract 5.", math: ["2x + 5 = 17", "2x = 12"] }], answer: "x = 6" };
    expect(intent("b-7-teach", [teach], [teach], { teaches: 1, teachChecked: 1, teachRight: 1 }).ok).toBe(true);
    expect(intent("b-7-teach", [teach], [], { teaches: 1 }).ok).toBe(false);
    expect(intent("b-7-teach", [teach], [teach], { teaches: 1, teachChecked: 1, teachRight: 0 }).why).toBe("the worked solution's answer is not the right one");
    // problems: the count asked for, every one verified
    const five: ChatAction = { type: "write_problems", problems: [["1 + 1"], ["2 + 2"], ["3 + 3"], ["4 + 4"], ["5 + 5"]] };
    expect(intent("p-7-two-step", [five], [five], { problems: 5, verified: 5 }).ok).toBe(true);
    expect(intent("p-7-two-step", [five], [five], { problems: 5, verified: 4 }).why).toBe("1 of 5 problems not verified (left out)");
  });

  it("scoring a picture (draw_model): the kind asked for, beside its problem, its spec passing the board's check", () => {
    const area: ChatAction = { type: "draw_model", model: { kind: "area_model", a: 23, b: 14 }, near: 1 };
    expect(intent("m-4-area-near", [area], [area], { models: 1, modelsClean: 1 })).toEqual({ ok: true, why: "" });
    const array: ChatAction = { type: "draw_model", model: { kind: "array", rows: 4, cols: 6 }, near: 1 };
    expect(intent("m-4-area-near", [array], [array], { models: 1, modelsClean: 1 }).why).toBe("no area_model picture (drew array)");
    expect(intent("m-4-area-near", [{ ...area, near: undefined }], [{ ...area, near: undefined }], { models: 1, modelsClean: 1 }).why).toBe("draw_model with no near, not beside problem 1");
    expect(intent("m-4-area-near", [area], [], { models: 1, modelsClean: 0 }).why).toBe("no draw_model (chose draw_model; the board got nothing)");
    expect(intent("m-3-array", [{ type: "draw_model", model: { kind: "equal_groups", groups: 4, each: 6 } }], undefined, { models: 1, modelsClean: 1 }).ok).toBe(true);
    // every picture case wants a draw_model; one of a problem on the screen, beside it and never with a new screen
    for (const c of ASK_CORPUS.filter((x) => x.group === "model")) {
      expect(c.expect, c.id).toMatchObject({ board: "required", types: ["draw_model"] });
      expect(c.expect.model?.length, c.id).toBeGreaterThan(0);
      if (c.screen?.problems?.length) expect(c.expect, c.id).toMatchObject({ near: expect.any(Number), without: expect.arrayContaining(["new_screen"]) });
    }
    expect(ASK_CORPUS.filter((x) => x.group === "model").length).toBeGreaterThanOrEqual(8);
  });

  it("scoring a drawing of a problem on the screen: beside that problem (near), never with a new screen", () => {
    const graph: ChatAction = { type: "graph", relations: ["y = 2x + 1"], near: 3 };
    expect(intent("b-8-graph-near", [graph], [graph], { graphs: 1, graphed: 1 })).toEqual({ ok: true, why: "" });
    expect(intent("b-8-graph-near", [{ type: "new_screen" }, graph], [{ type: "new_screen" }, graph], { graphs: 1, graphed: 1 }).why).toBe("new_screen where it does not apply");
    const loose: ChatAction = { type: "graph", relations: ["y = 2x + 1"] };
    expect(intent("b-8-graph-near", [loose], [loose], { graphs: 1, graphed: 1 }).why).toBe("graph with no near, not beside problem 3");
    const elsewhere: ChatAction = { type: "graph", relations: ["2x \\le 8"], near: 1 };
    expect(intent("b-7-number-line-near", [elsewhere], [elsewhere], { graphs: 1, graphed: 1 }).why).toBe("graph near 1, not beside problem 2");
    const figure: ChatAction = { type: "draw_figure", figure: { points: { A: { x: 0, y: 0 }, B: { x: 4, y: 0 }, C: { x: 1, y: 2 } }, segments: [], angles: [], polygons: [{ vertices: ["A", "B", "C"] }], lines: [], circles: [] }, near: 2 };
    expect(intent("b-7-figure-near", [figure], [figure], { figures: 1, figuresClean: 1 }).ok).toBe(true);
    for (const id of ["b-7-number-line-near", "b-8-graph-near", "b-7-figure-near"]) expect(caseOf(id).expect).toMatchObject({ board: "required", without: ["new_screen"] });
  });

  it("scoring the words: what it must and must never say, the length for the grade, spoken, Markdown-lite", () => {
    expect(checkSays(caseOf("f-3-seven-eight"), "It's **56**!", []).ok).toBe(true);
    expect(checkSays(caseOf("f-3-seven-eight"), "Let's count by 8s!", []).ok).toBe(false);
    expect(checkSays(caseOf("s-7-help-2"), "So x = 4.", []).why).toMatch(/^says /);
    // the answer may be on the board
    expect(checkSays(caseOf("s-4-give-up"), "I worked it out on your board.", [{ type: "teach", steps: [{ say: "Multiply.", math: ["3 \\times 8 = 24"] }], answer: "24" }]).ok).toBe(true);
    expect(countWords("Add $\\frac{1}{2}$ and $\\frac{1}{4}$: you get **3/4**.")).toBe(7);
    expect(sentencesOf("Hi Maya! It's 8. Great job.\n- one\n- two")).toHaveLength(5);
    expect(checkLength("Yes! You landed on 8. Great hopping! 😊", "k2", false).ok).toBe(true);
    expect(checkLength("One. Two. Three. Four. Five.", "k2", false).why).toBe("5 sentences (≤ 4 for K–2)");
    expect(checkLength("word ".repeat(150), "g3_8", false).ok).toBe(false);
    expect(checkLength("word ".repeat(150), "g3_8", true).ok).toBe(true);
    expect(checkVoice("A fraction is part of a whole. One of 2 equal parts is one half.").ok).toBe(true);
    expect(checkVoice("A fraction:\n- top\n- bottom").why).toBe("a list");
    expect(checkVoice("It is $$\\frac{1}{2}$$").why).toBe("display maths");
    expect(checkFormat("## Fractions\nA part.").why).toBe("a heading");
    expect(checkFormat("Nice! 🎉🎉").why).toBe("2 emoji");
    expect(checkFormat("So $x < 3$ and **yes**.").ok).toBe(true);
    for (const claim of ["Here you go — 5 two-step equations on your board!", "I put 3 on your board.", "I wrote the next step under #2.", "I worked it out under your problem."]) expect(CLAIMS_BOARD.test(claim), claim).toBe(true);
    for (const plain of ["The board is for maths, so here it is in words.", "Try it on your paper!", "I can't draw on the board for science.", "Want to try one on your board?", "I can put a few problems on your board.", "There isn't a #7 on your board right now."]) expect(CLAIMS_BOARD.test(plain), plain).toBe(false);
    expect(checkFormat("The problem at the bottom is the student's own, so I'll use help_board.").why).toBe('talks about "the student\'s"');
  });

  it("the report renders the summary from results", () => {
    const r: AskResult = {
      id: "f-3-seven-eight",
      group: "fact",
      subject: "maths",
      band: "g3_8",
      voice: false,
      label: "m/x",
      model: "m/x",
      call: { model: "m/x", key: "k", ok: true, reply: "**56**!", board: null, overflow: false, firstTokenMs: 600, ttftMs: 700, totalMs: 900, promptTokens: 1000, cachedTokens: 900, cacheWriteTokens: 0, completionTokens: 10, reasoningTokens: 0, costUsd: 0.001, costSource: "usage", attempts: 1, at: "", cached: false },
      content: "**56**!",
      reply: "**56**!",
      words: 1,
      sentences: 1,
      hasBoard: false,
      blockOk: true,
      proposed: 0,
      chosen: [],
      final: [],
      dropped: [],
      notes: [],
      gate: NO_GATE,
      repairs: [],
      boardMs: 0,
      checks: { board: { ok: true, why: "" }, intent: { ok: true, why: "" }, says: { ok: true, why: "" }, length: { ok: true, why: "" }, voice: { ok: true, why: "" }, format: { ok: true, why: "" } },
      auto: true,
      judge: { correctness: 5, tutoring: 4, gradeFit: 5, warmth: 4, safety: 5, reason: "ok", call: { model: JUDGE_MODEL, key: "j", ok: true, latencyMs: 1, promptTokens: 1, completionTokens: 1, reasoningTokens: 0, costUsd: 0.002, costSource: "usage", attempts: 1, at: "", cached: false } },
    };
    const s = askSummary([r]);
    expect(s).toMatchObject({ asks: 1, auto: 1, judged: 1, allFour: 1, minSafety: 5, ttftP50: 700, cacheShare: 0.9 });
    expect(s.overall).toBeCloseTo(4.6, 9);
    const md = renderAskMarkdown({ corpus: ASK_CORPUS, results: [r], spend: { totalUsd: 0.003, calls: 2, byModel: {} }, spentThisRun: 0.003, capUsd: 14, date: "2026-10-11", catalogFetchedAt: "2026-10-11" });
    expect(md).toContain("| `m/x` | **1/1 (100%)** |");
    expect(md).toContain("**f-3-seven-eight**");
    expect(modelConfig("anthropic/claude-haiku-5.5")).toEqual({ model: "anthropic/claude-haiku-5.5", reasoning: "none", label: "anthropic/claude-haiku-5.5" });
    expect(modelConfig("anthropic/claude-haiku-5.5@default")).toEqual({ model: "anthropic/claude-haiku-5.5", reasoning: undefined, label: "anthropic/claude-haiku-5.5@default" });
  });
});

describe.skipIf(!RUN)("eval: Ask with real models (RUN_ASK_EVAL=1)", () => {
  it(
    "streams the corpus through the candidate models, judged, under the spend cap",
    async () => {
      const envFile = loadEnvLocal();
      expect(process.env.OPENROUTER_API_KEY, `no OPENROUTER_API_KEY (looked for .env.local up from the repo root: ${envFile ?? "none found"})`).toBeTruthy();
      mkdirSync(MODELS_CACHE_DIR, { recursive: true });
      const logFile = join(MODELS_CACHE_DIR, "ask-run.log");
      writeFileSync(logFile, "");
      const log = (line: string) => appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);

      const catalog = await loadCatalog();
      const ledger = new SpendLedger(ASK_SPEND_CAP_USD, join(MODELS_CACHE_DIR, "ask-spend.json"));
      const before = ledger.totalUsd;
      const list = (v: string | undefined) => v?.split(",").map((s) => s.trim()).filter(Boolean);
      const models = (list(process.env.ASK_EVAL_MODELS) ?? [...ASK_MODELS]).map(modelConfig);
      const missing = models.filter((m) => !catalog.models.has(m.model));
      log(`catalog ${catalog.live ? "fetched" : "from cache"}; spent so far $${before.toFixed(4)}; missing: ${missing.map((m) => m.model).join(", ") || "none"}`);
      const ids = list(process.env.ASK_EVAL_IDS);
      const groups = list(process.env.ASK_EVAL_GROUPS);
      const corpus = ASK_CORPUS.filter((c) => (!ids || ids.includes(c.id)) && (!groups || groups.includes(c.group)));
      const judge = process.env.ASK_EVAL_JUDGE === "0" ? null : (process.env.ASK_EVAL_JUDGE ?? JUDGE_MODEL);
      const results = await runAsk({
        corpus,
        models: models.filter((m) => catalog.models.has(m.model)),
        ctx: { catalog: catalog.models, ledger },
        engine,
        judge,
        concurrency: Number(process.env.ASK_EVAL_CONCURRENCY) || 4,
        log,
      });
      const spent = ledger.totalUsd - before;
      log(`done: ${results.length} results; spent this run $${spent.toFixed(4)}, total $${ledger.totalUsd.toFixed(4)}`);
      // the spend, where a run's output shows it
      process.stdout.write(`\nAsk eval: ${results.length} results; spent this run $${spent.toFixed(4)}; on the ledger $${ledger.totalUsd.toFixed(4)} of $${ASK_SPEND_CAP_USD}\n`);
      expect(ledger.totalUsd).toBeLessThanOrEqual(ASK_SPEND_CAP_USD);
      expect(results.length).toBeGreaterThan(0);

      const target = join(ROOT, "docs", "eval", "ask.md");
      const md = renderAskMarkdown({
        corpus,
        results,
        spend: ledger.snapshot,
        spentThisRun: spent,
        capUsd: ASK_SPEND_CAP_USD,
        date: new Date().toISOString().slice(0, 10),
        catalogFetchedAt: catalog.fetchedAt.slice(0, 10),
        exampleLabel: process.env.ASK_EVAL_EXAMPLES,
        previous: existsSync(target) ? readFileSync(target, "utf8") : undefined,
      });
      writeFileSync(join(MODELS_CACHE_DIR, "ask-last-run.md"), md);
      writeFileSync(join(MODELS_CACHE_DIR, "ask-last-run.json"), JSON.stringify(results.map((r) => ({ ...r, content: r.content.slice(0, 6000) })), null, 1) + "\n");
      if (process.env.EVAL_WRITE === "1") {
        writeFileSync(target, md);
        // one line per ask: what it chose, what failed, the times, the cost, the judge
        const scores = results.map((r) => ({
          id: r.id,
          model: r.label,
          auto: r.auto,
          failed: Object.fromEntries(Object.entries(r.checks).filter(([, v]) => !v.ok).map(([k, v]) => [k, v.why])),
          chosen: r.chosen,
          board: r.final.map((a) => a.type),
          words: r.words,
          ttftMs: r.call.ttftMs,
          totalMs: r.call.totalMs,
          costUsd: Number(r.call.costUsd.toFixed(6)),
          judge: r.judge ? [r.judge.correctness, r.judge.tutoring, r.judge.gradeFit, r.judge.warmth, r.judge.safety] : null,
          why: r.judge?.reason,
          reply: r.reply,
        }));
        writeFileSync(join(ROOT, "docs", "eval", "ask.json"), `[\n${scores.map((x) => JSON.stringify(x)).join(",\n")}\n]\n`);
      }
    },
    90 * 60_000,
  );
});
