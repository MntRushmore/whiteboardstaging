import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import { PROBE_FIGURE } from "@/lib/live/chat/figure";
import { checkProofProposal } from "@/lib/live/chat/proof";
import { ALGEBRA_PROOF_EXAMPLE, buildChatMessages, cleanChatActions, PROOF_EXAMPLES } from "@/lib/server/prompts/chat";
import { loadEnvLocal } from "../handwriting";
import { loadCatalog, MODELS_CACHE_DIR, SpendLedger } from "../models/client";
import { CHAT_CORPUS, requestFor } from "./corpus";
import { modelSummary, renderChatMarkdown } from "./report";
import { judgeIntent, proofScore, runChat, scoreGraphs, scoreLines, scoreProblems, type ChatResult } from "./run";

/**
 * The BOARD CHAT eval (./run.ts). Offline, in every `vitest run`: the corpus covers every course and
 * kind of request, the prompt builds for each, and the scoring is right on hand-written replies
 * (a good problem set verifies, a bad one does not; an off-topic reply with an action misses).
 *
 * With RUN_CHAT_EVAL=1 (real OpenRouter calls, cached under src/__eval__/.cache/models/, held under
 * a $0.60 cap on its own ledger): every request through the candidate models, and with EVAL_WRITE=1
 * docs/eval/chat.{md,json}.
 *
 *   npm run eval:chat                 RUN_CHAT_EVAL=1 EVAL_WRITE=1
 *   CHAT_EVAL_MODELS=a/b,c/d          only these models
 *   CHAT_EVAL_LIMIT=5                 the first 5 requests (a pilot)
 */
const RUN = process.env.RUN_CHAT_EVAL === "1";
const ROOT = resolve(__dirname, "..", "..", "..");
export const CHAT_SPEND_CAP_USD = 0.6;
/** production's chat pair first, then cheap models from other providers */
export const CHAT_MODELS = ["openai/gpt-5.4-mini", "deepseek/deepseek-v4.1-flash", "google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite", "openai/gpt-5.4-nano"] as const;

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("eval: board chat (offline)", () => {
  it("about 30 requests over every course and kind", () => {
    expect(CHAT_CORPUS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CHAT_CORPUS.map((c) => c.id)).size).toBe(CHAT_CORPUS.length);
    expect(new Set(CHAT_CORPUS.map((c) => c.course))).toEqual(new Set(["algebra1", "algebra2", "geometry", "calculus", "mixed"]));
    expect(new Set(CHAT_CORPUS.map((c) => c.kind))).toEqual(new Set(["problems", "graph", "figure", "lines", "followup", "screen", "refusal", "help", "proof"]));
    // the owner's asks: a proof, the hardest proof ever, one to do
    for (const ask of ["write a proof", "write the hardest proof ever", "give me a proof to do"]) expect(CHAT_CORPUS.some((c) => c.message === ask && c.expect.types.includes("write_proof"))).toBe(true);
  });

  it("scoring help: the right problem, the right depth; no help_problem where there are no problems", () => {
    const three = CHAT_CORPUS.find((x) => x.id === "h-help-3")!;
    expect(judgeIntent(three, [{ type: "help_problem", problem: 3, depth: "step" }])).toEqual({ ok: true, why: "" });
    expect(judgeIntent(three, [{ type: "help_problem", problem: 2, depth: "step" }]).why).toBe("helped with 2, not problem 3");
    expect(judgeIntent(three, [{ type: "help_problem", problem: 3, depth: "solve" }]).why).toBe("solve for problem 3, not step");
    expect(judgeIntent(three, []).ok).toBe(false);
    const none = CHAT_CORPUS.find((x) => x.id === "h-no-problems")!;
    expect(judgeIntent(none, []).ok).toBe(true);
    expect(judgeIntent(none, [{ type: "help_problem", problem: 1, depth: "step" }]).ok).toBe(false);
    // the owner's trig problems, as the request shows them
    expect(String(buildChatMessages(requestFor(three))[1].content)).toContain("3. \\sin x = -\\frac{1}{2}, 0^{\\circ} \\le x < 360^{\\circ}");
  });

  it("scoring proofs: written or set up as asked, proved by the engine; an algebra proof's steps all checked", () => {
    const write = CHAT_CORPUS.find((x) => x.id === "p-write")!;
    const toDo = CHAT_CORPUS.find((x) => x.id === "p-to-do")!;
    const example = PROOF_EXAMPLES[0].action;
    expect(judgeIntent(write, [example])).toEqual({ ok: true, why: "" });
    expect(judgeIntent(write, [])).toEqual({ ok: false, why: "no write_proof (no action)" });
    expect(judgeIntent(toDo, [example]).why).toBe("a proof set up for the student was asked for");
    expect(judgeIntent(toDo, [{ ...example, worked: false }]).ok).toBe(true);
    const verdict = checkProofProposal(example);
    expect(proofScore(example, verdict)).toMatchObject({ schema: true, worked: true, provedFirst: true, provedAfterRepair: true, rows: 4, reasons: ["vertical", "midpoint", "midpoint", "sas"] });
    const odd = CHAT_CORPUS.find((x) => x.id === "p-odd-sum")!;
    const chain = { type: "write_lines" as const, lines: [...ALGEBRA_PROOF_EXAMPLE.lines] };
    expect(judgeIntent(odd, [chain]).ok).toBe(true);
    expect(judgeIntent(odd, [{ type: "write_lines", lines: ["2m + 1 + 2n + 1 = 2(m + n + 1)"] }]).why).toBe("not a chain of = lines");
    expect(scoreLines(engine, [chain])).toEqual([{ lines: chain.lines, chain: true, ok: true, why: "" }]);
    expect(scoreLines(engine, [{ type: "write_lines", lines: ["(a + b)^{2}", "= a^{2} + b^{2}"] }])[0]).toMatchObject({ ok: false, why: "false" });
  });

  it("the production prompt builds for every request, with the screen where it matters", () => {
    for (const c of CHAT_CORPUS) {
      const [, user] = buildChatMessages(requestFor(c));
      expect(String(user.content)).toContain(`REQUEST: ${c.message}`);
    }
    const more = CHAT_CORPUS.find((c) => c.id === "f-more")!;
    expect(String(buildChatMessages(requestFor(more))[1].content)).toContain("1. 2x + 3 = 11");
  });

  it("scoring: a good problem set is verified, clean and on count; a bad one is not", () => {
    const c = CHAT_CORPUS.find((x) => x.id === "a1-two-step")!;
    const good = cleanChatActions([{ type: "write_problems", problems: ["2x + 3 = 11", "3x - 4 = 11", "\\frac{x}{2} + 1 = 5", "5 - x = 2", "4x + 1 = 21"] }]).actions;
    expect(judgeIntent(c, good)).toEqual({ ok: true, why: "" });
    expect(scoreProblems(engine, good).map((p) => [p.verdict, p.clean])).toEqual(Array(5).fill(["verified", true]));
    const short = cleanChatActions([{ type: "write_problems", problems: ["2x + 3 = 11", "y = 2x"] }]).actions;
    expect(judgeIntent(c, short).why).toBe("2 problems for 5 asked");
    expect(scoreProblems(engine, short).map((p) => p.verdict)).toEqual(["verified", "unsolved"]);
  });

  it("scoring: a refusal must do nothing; 'solve it for me' must not write the answer; a range needs a window", () => {
    const off = CHAT_CORPUS.find((x) => x.id === "m-off-topic")!;
    expect(judgeIntent(off, []).ok).toBe(true);
    expect(judgeIntent(off, [{ type: "new_screen" }]).ok).toBe(false);
    const solve = CHAT_CORPUS.find((x) => x.id === "m-solve-for-me")!;
    expect(judgeIntent(solve, [{ type: "write_problems", problems: [["2x + 5 = 17"]] }]).ok).toBe(true);
    expect(judgeIntent(solve, [{ type: "write_problems", problems: [["x = 6"]] }]).why).toBe("wrote the answer");
    const sin = CHAT_CORPUS.find((x) => x.id === "gr-sin")!;
    expect(judgeIntent(sin, [{ type: "graph", relations: ["y = \\sin x"] }]).why).toBe("no window for the range asked");
    expect(scoreGraphs(engine, [{ type: "graph", relations: ["y = \\sin x"], window: { xMin: -6.28, xMax: 6.28 } }])).toEqual([{ relations: ["y = \\sin x"], graphed: true, window: true }]);
  });

  it("the report renders the summary from results", () => {
    const r: ChatResult = {
      id: "a1-two-step",
      course: "algebra1",
      kind: "problems",
      model: "m/x",
      json: true,
      proposed: 1,
      valid: 1,
      dropped: [],
      types: ["write_problems"],
      intent: true,
      intentWhy: "",
      problems: [{ lines: ["2x = 4"], verdict: "verified", answer: "x = 2", clean: true }],
      figures: [{ schema: true, cleanFirst: false, cleanAfterRepair: true, drawn: true, problems: ["x"], repair: { model: "m/x", key: "k", ok: true, latencyMs: 500, promptTokens: 1, completionTokens: 1, reasoningTokens: 0, costUsd: 0.001, costSource: "usage", attempts: 1, at: "", cached: false } }],
      graphs: [],
      proofs: [{ schema: true, worked: true, provedFirst: false, provedAfterRepair: true, rows: 8, reasons: ["given"], prove: "\\overline{AE} \\cong \\overline{CE}", problems: ["could not prove"], repair: { model: "m/x", key: "r", ok: true, latencyMs: 700, promptTokens: 1, completionTokens: 1, reasoningTokens: 0, costUsd: 0.001, costSource: "usage", attempts: 1, at: "", cached: false } }],
      lines: [],
      reply: "Here.",
      call: { model: "m/x", key: "k", ok: true, latencyMs: 1500, promptTokens: 1, completionTokens: 1, reasoningTokens: 0, costUsd: 0.002, costSource: "usage", attempts: 1, at: "", cached: false },
      content: "",
    };
    const s = modelSummary([r]);
    // the figure's repair (0.5 s) and the proof's (0.7 s) are part of the wait and the cost
    expect(s).toMatchObject({ verified: 1, problems: 1, figureCleanFirst: 0, figureClean: 1, figureDrawn: 1, proofs: 1, proofsFirst: 0, proofsProved: 1, p50: 2700 });
    expect(s.cost).toBeCloseTo(0.004, 9);
    const md = renderChatMarkdown({ corpus: CHAT_CORPUS, results: [r], spend: { totalUsd: 0.003, calls: 2, byModel: {} }, spentThisRun: 0.003, capUsd: 0.6, date: "2026-09-28", catalogFetchedAt: "2026-09-28" });
    expect(md).toContain("| `m/x` |");
    expect(md).toContain("**1/1 (100%)**");
    expect(PROBE_FIGURE.points.A).toBeDefined();
  });
});

describe.skipIf(!RUN)("eval: board chat with real models (RUN_CHAT_EVAL=1)", () => {
  it(
    "runs the corpus through the candidate models under the spend cap",
    async () => {
      const envFile = loadEnvLocal();
      expect(process.env.OPENROUTER_API_KEY, `no OPENROUTER_API_KEY (looked for .env.local up from the repo root: ${envFile ?? "none found"})`).toBeTruthy();
      mkdirSync(MODELS_CACHE_DIR, { recursive: true });
      const logFile = join(MODELS_CACHE_DIR, "chat-run.log");
      writeFileSync(logFile, "");
      const log = (line: string) => appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);

      const catalog = await loadCatalog();
      const ledger = new SpendLedger(CHAT_SPEND_CAP_USD, join(MODELS_CACHE_DIR, "chat-spend.json"));
      const before = ledger.totalUsd;
      const list = (v: string | undefined) => v?.split(",").map((s) => s.trim()).filter(Boolean);
      const models = list(process.env.CHAT_EVAL_MODELS) ?? [...CHAT_MODELS];
      const missing = models.filter((m) => !catalog.models.has(m));
      log(`catalog ${catalog.live ? "fetched" : "from cache"}; spent so far $${before.toFixed(4)}; missing: ${missing.join(", ") || "none"}`);
      const corpus = CHAT_CORPUS.slice(0, Number(process.env.CHAT_EVAL_LIMIT) || undefined);
      const results = await runChat({ corpus, models: models.filter((m) => catalog.models.has(m)), ctx: { catalog: catalog.models, ledger }, engine, log });
      const spent = ledger.totalUsd - before;
      log(`done: ${results.length} results; spent this run $${spent.toFixed(4)}, total $${ledger.totalUsd.toFixed(4)}`);
      expect(ledger.totalUsd).toBeLessThanOrEqual(CHAT_SPEND_CAP_USD);
      expect(results.length).toBeGreaterThan(0);

      const target = join(ROOT, "docs", "eval", "chat.md");
      const md = renderChatMarkdown({
        corpus,
        results,
        spend: ledger.snapshot,
        spentThisRun: spent,
        capUsd: CHAT_SPEND_CAP_USD,
        date: new Date().toISOString().slice(0, 10),
        catalogFetchedAt: catalog.fetchedAt.slice(0, 10),
        previous: existsSync(target) ? readFileSync(target, "utf8") : undefined,
      });
      writeFileSync(join(MODELS_CACHE_DIR, "chat-last-run.md"), md);
      writeFileSync(join(MODELS_CACHE_DIR, "chat-last-run.json"), JSON.stringify(results.map((r) => ({ ...r, content: r.content.slice(0, 4000) })), null, 1) + "\n");
      if (process.env.EVAL_WRITE === "1") {
        writeFileSync(target, md);
        const scores = results.map(({ content: _c, call, ...rest }) => {
          void _c;
          return { ...rest, latencyMs: call.latencyMs, costUsd: call.costUsd, cached: call.cached };
        });
        writeFileSync(join(ROOT, "docs", "eval", "chat.json"), JSON.stringify(scores, null, 1) + "\n");
      }
    },
    60 * 60_000,
  );
});
