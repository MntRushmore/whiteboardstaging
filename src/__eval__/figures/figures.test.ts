import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "@/lib/live/contracts";
import { splitInk } from "@/lib/live/diagrams";
import { getEngine } from "@/lib/live/engine";
import { figureAnswer, planFigure, readFromReply } from "@/lib/live/figure";
import { figureSetup } from "@/lib/server/prompts/figure";
import { loadEnvLocal } from "../handwriting";
import { loadCatalog, MODELS_CACHE_DIR, SpendLedger } from "../models/client";
import { buildFigureCorpus } from "./corpus";
import { figurePng, rsvgPath } from "./render";
import { renderFiguresMarkdown } from "./report";
import { runFigures, type FigureResult } from "./run";

/**
 * The FIGURE eval (./run.ts). Offline, in every `vitest run`: the corpus is at least 40 figures
 * over every configuration, each figure's gold read plans (and the engine solves) to its answer,
 * and each is a drawing to the board (`splitInk`: nothing of it read as a line of writing).
 *
 * With RUN_FIGURE_EVAL=1 (real OpenRouter calls, cached under src/__eval__/.cache/models/, held
 * under a $0.90 cap on its own ledger): every figure through the candidate models and the old
 * prompt, and with EVAL_WRITE=1 docs/eval/figures.{md,json}. Skipped where rsvg-convert is missing.
 *
 *   npm run eval:figures                  RUN_FIGURE_EVAL=1 EVAL_WRITE=1
 *   FIGURE_EVAL_MODELS=a/b,c/d            only these models
 *   FIGURE_EVAL_LIMIT=10                  the first 10 figures (a pilot)
 *   FIGURE_EVAL_BASELINE=0                without the old prompt
 */
const RUN = process.env.RUN_FIGURE_EVAL === "1";
const ROOT = resolve(__dirname, "..", "..", "..");
const RSVG = rsvgPath();
export const FIGURE_SPEND_CAP_USD = 0.9;
/** production's figure model before this change, and cheap vision models from US providers */
export const FIGURE_MODELS = ["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite", "openai/gpt-5.4-nano", "anthropic/claude-haiku-4.5"] as const;
/** the model the old prompt is measured on: production's figure model before this change */
const BASELINE_MODEL = "google/gemini-3.1-flash-lite";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("eval: figures (offline)", () => {
  const corpus = buildFigureCorpus();

  it("has at least 40 figures across every configuration", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(40);
    expect(new Set(corpus.map((f) => f.id)).size).toBe(corpus.length);
    expect(new Set(corpus.map((f) => f.config)).size).toBeGreaterThanOrEqual(18);
  });

  it("every figure's gold read plans to its answer, and the board writes it", () => {
    const wrong: string[] = [];
    for (const f of corpus) {
      const labels = f.labels.map((l) => l.latex);
      const plan = planFigure(readFromReply(f.gold), { labels });
      if (!plan.ok) {
        wrong.push(`${f.id}: refused (${plan.reason})`);
        continue;
      }
      const setup = figureSetup({ unknown: f.answer.letter, ...f.gold, lines: [] }, { lines: [], labels });
      const answer = figureAnswer(engine, setup, labels);
      const got = answer.ok ? answer.values.find((v) => v.letter === f.answer.letter)?.value : undefined;
      if (got === undefined || Math.abs(got - f.answer.value) > 1e-6) wrong.push(`${f.id}: ${answer.ok ? got : answer.reason} (want ${f.answer.value})`);
    }
    expect(wrong).toEqual([]);
  });

  it("every figure is a drawing to the board: none of its ink is read as a line of writing", () => {
    const stray: string[] = [];
    for (const f of corpus) {
      const ink = [...f.strokes, ...f.labels.flatMap((l) => l.strokes)];
      const split = splitInk(ink);
      if (split.writing.length > 0 || split.diagrams.length === 0) stray.push(`${f.id}: ${split.writing.length} strokes of writing, ${split.diagrams.length} drawings`);
    }
    expect(stray).toEqual([]);
  });

  it.skipIf(!RSVG)("renders every figure as a crop the board would send (≤ 768 px wide)", () => {
    for (const f of corpus.slice(0, 5)) {
      const png = figurePng([...f.strokes, ...f.labels.flatMap((l) => l.strokes)], RSVG!);
      expect(png.width).toBeLessThanOrEqual(768);
      expect(png.dataUrl).toMatch(/^data:image\/png;base64,/);
    }
  });
});

describe.skipIf(!RUN || !RSVG)("eval: figures with real models (RUN_FIGURE_EVAL=1)", () => {
  it(
    "runs the corpus through the candidate models under the spend cap",
    async () => {
      const envFile = loadEnvLocal();
      expect(process.env.OPENROUTER_API_KEY, `no OPENROUTER_API_KEY (looked for .env.local up from the repo root: ${envFile ?? "none found"})`).toBeTruthy();
      mkdirSync(MODELS_CACHE_DIR, { recursive: true });
      const logFile = join(MODELS_CACHE_DIR, "figures-run.log");
      writeFileSync(logFile, "");
      const log = (line: string) => appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);

      const catalog = await loadCatalog();
      const ledger = new SpendLedger(FIGURE_SPEND_CAP_USD, join(MODELS_CACHE_DIR, "figures-spend.json"));
      const before = ledger.totalUsd;
      const list = (v: string | undefined) => v?.split(",").map((s) => s.trim()).filter(Boolean);
      const models = list(process.env.FIGURE_EVAL_MODELS) ?? [...FIGURE_MODELS];
      const missing = models.filter((m) => !catalog.models.has(m));
      log(`catalog ${catalog.live ? "fetched" : "from cache"}; spent so far $${before.toFixed(4)}; missing: ${missing.join(", ") || "none"}`);
      const corpus = buildFigureCorpus().slice(0, Number(process.env.FIGURE_EVAL_LIMIT) || undefined);
      const crops = new Map(corpus.map((f) => [f.id, figurePng([...f.strokes, ...f.labels.flatMap((l) => l.strokes)], RSVG!).dataUrl]));
      const ctx = { catalog: catalog.models, ledger };
      const available = models.filter((m) => catalog.models.has(m));

      const results: FigureResult[] = [];
      results.push(...(await runFigures({ corpus, models: available, ctx, engine, crops, prompt: "structured", log })));
      if (process.env.FIGURE_EVAL_BASELINE !== "0" && catalog.models.has(BASELINE_MODEL)) {
        results.push(...(await runFigures({ corpus, models: [BASELINE_MODEL], ctx, engine, crops, prompt: "baseline", log })));
      }
      const spent = ledger.totalUsd - before;
      log(`done: ${results.length} results; spent this run $${spent.toFixed(4)}, total $${ledger.totalUsd.toFixed(4)}`);
      expect(ledger.totalUsd).toBeLessThanOrEqual(FIGURE_SPEND_CAP_USD);
      expect(results.length).toBeGreaterThan(0);

      const target = join(ROOT, "docs", "eval", "figures.md");
      const md = renderFiguresMarkdown({
        corpus,
        results,
        spend: ledger.snapshot,
        spentThisRun: spent,
        date: new Date().toISOString().slice(0, 10),
        catalogFetchedAt: catalog.fetchedAt.slice(0, 10),
        previous: existsSync(target) ? readFileSync(target, "utf8") : undefined,
      });
      writeFileSync(join(MODELS_CACHE_DIR, "figures-last-run.md"), md);
      const json = results.map(({ content, ...r }) => ({ ...r, content: content.slice(0, 4000) }));
      writeFileSync(join(MODELS_CACHE_DIR, "figures-last-run.json"), JSON.stringify(json, null, 1) + "\n");
      if (process.env.EVAL_WRITE === "1") {
        writeFileSync(target, md);
        // the scores, not the replies (those stay in the cache and figures-last-run.json)
        const scores = results.map((r) => {
          const { call, ...rest } = r;
          return { ...rest, content: undefined, latencyMs: call.latencyMs, costUsd: call.costUsd, cached: call.cached };
        });
        writeFileSync(join(ROOT, "docs", "eval", "figures.json"), JSON.stringify(scores, null, 1) + "\n");
      }
    },
    60 * 60_000,
  );
});
