import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getEngine } from "@/lib/live/engine";
import { loadEnvLocal } from "../handwriting";
import { runBench, SPEND_CAP_USD, type JobId } from "./bench";
import { loadCatalog, MODELS_CACHE_DIR, SpendLedger } from "./client";
import { HANDWRITING_JSON } from "./misreads";
import { renderModelsMarkdown } from "./report";

/**
 * The model bench: candidate OpenRouter models on the three jobs a model still does in Live Math
 * (word-problem setup, the solve fallback, misread repair). It spends real money — every call
 * reserves its worst case against a hard cap of $4.50 kept on disk across runs, and every answer
 * is cached under src/__eval__/.cache/models/ so a rerun is free — so it is skipped unless
 * RUN_MODEL_BENCH=1.
 *
 *   npm run eval:models          RUN_MODEL_BENCH=1 EVAL_WRITE=1: runs it, writes docs/eval/models.md
 *   MODEL_BENCH_LIMIT=5          at most 5 items per job (a manual pilot)
 *   MODEL_BENCH_MODELS=a/b,c/d   only these models
 *   MODEL_BENCH_JOBS=word,repair only these jobs
 */
const RUN = process.env.RUN_MODEL_BENCH === "1";
const ROOT = resolve(__dirname, "..", "..", "..");

/** Share of lines the handwriting scoreboard's Mathpix reads got wrong (of the lines it read). */
function misreadRate(): number {
  const runs = (JSON.parse(readFileSync(HANDWRITING_JSON, "utf8")) as { runs: Array<{ lines: Array<{ read: string }> }> }).runs;
  const reads = runs.flatMap((r) => r.lines).filter((l) => l.read === "exact" || l.read === "semantic" || l.read === "wrong");
  return reads.filter((l) => l.read === "wrong").length / Math.max(1, reads.length);
}

describe.skipIf(!RUN)("eval: model bench (RUN_MODEL_BENCH=1)", () => {
  it(
    "runs every candidate on the three jobs under the spend cap",
    async () => {
      const envFile = loadEnvLocal();
      expect(process.env.OPENROUTER_API_KEY, `no OPENROUTER_API_KEY (looked for .env.local up from the repo root: ${envFile ?? "none found"})`).toBeTruthy();
      mkdirSync(MODELS_CACHE_DIR, { recursive: true });
      const logFile = join(MODELS_CACHE_DIR, "run.log");
      writeFileSync(logFile, "");
      const log = (line: string) => appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);

      const catalog = await loadCatalog();
      const ledger = new SpendLedger(SPEND_CAP_USD);
      const before = ledger.totalUsd;
      log(`catalog ${catalog.live ? "fetched" : "from cache"} (${catalog.models.size} models); spent so far $${before.toFixed(4)}`);
      const engine = await getEngine();
      const list = (v: string | undefined) => v?.split(",").map((s) => s.trim()).filter(Boolean);
      const run = await runBench({
        catalog: catalog.models,
        ctx: { catalog: catalog.models, ledger },
        engine,
        limit: Number(process.env.MODEL_BENCH_LIMIT) || undefined,
        models: list(process.env.MODEL_BENCH_MODELS),
        jobs: list(process.env.MODEL_BENCH_JOBS) as JobId[] | undefined,
        log,
      });
      log(`done: ${run.results.length} results, spent this run $${(ledger.totalUsd - before).toFixed(4)}, total $${ledger.totalUsd.toFixed(4)}`);
      expect(ledger.totalUsd).toBeLessThanOrEqual(SPEND_CAP_USD);
      expect(run.results.length).toBeGreaterThan(0);

      const target = join(ROOT, "docs", "eval", "models.md");
      const md = renderModelsMarkdown({
        run,
        spend: ledger.snapshot,
        spentThisRun: ledger.totalUsd - before,
        catalogFetchedAt: catalog.fetchedAt.slice(0, 10),
        misreadRate: misreadRate(),
        date: new Date().toISOString().slice(0, 10),
        previous: existsSync(target) ? readFileSync(target, "utf8") : undefined,
      });
      writeFileSync(join(MODELS_CACHE_DIR, "last-run.md"), md);
      writeFileSync(join(MODELS_CACHE_DIR, "last-run.json"), JSON.stringify(run, null, 1) + "\n");
      if (process.env.EVAL_WRITE === "1") writeFileSync(target, md);
    },
    120 * 60_000,
  );
});
