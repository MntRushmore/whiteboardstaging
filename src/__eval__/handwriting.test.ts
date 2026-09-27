import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getEngine } from "@/lib/live/engine";
import { isMathpixConfigured } from "@/lib/server/mathpix";
import { CORPUS } from "./corpus";
import { describeVariant, loadEnvLocal, MAX_CALLS, runHandwritingEval, VARIANTS } from "./handwriting";
import { runOfflineEval, summaryLine, summarize } from "./offline";
import { renderHandwritingMarkdown } from "./report";

/**
 * The handwriting scoreboard: the tutor's own hand writes every corpus line, Mathpix reads it,
 * and Solve runs on what Mathpix read. It spends Mathpix calls (≤ 1500 per run, cached on disk
 * under src/__eval__/.cache/ so a rerun is free), so it is skipped unless RUN_LIVE_EVAL=1.
 *
 *   npm run eval:live     RUN_LIVE_EVAL=1 EVAL_WRITE=1: runs it, writes docs/eval/handwriting.{md,json}
 */
const LIVE = process.env.RUN_LIVE_EVAL === "1";
const ROOT = resolve(__dirname, "..", "..");

describe.skipIf(!LIVE)("eval: handwriting → Mathpix → Solve (RUN_LIVE_EVAL=1)", () => {
  it(
    "writes, reads and solves the corpus",
    async () => {
      const envFile = loadEnvLocal();
      expect(isMathpixConfigured(), `no Mathpix keys (looked for .env.local up from the repo root: ${envFile ?? "none found"})`).toBe(true);
      const engine = await getEngine();
      const { runs, budget } = await runHandwritingEval(engine, CORPUS);
      const offline = await runOfflineEval(engine);

      expect(runs).toHaveLength(CORPUS.length * VARIANTS.length);
      expect(budget.calls).toBeLessThanOrEqual(MAX_CALLS);
      const verdicts = runs.map((r) => r.verdict).filter((v) => v !== null);
      console.log(`eval:live: ${budget.calls} Mathpix calls, ${budget.hits} cached; ${summaryLine("from handwriting", { ...summarize(verdicts), total: runs.length })}`);

      if (process.env.EVAL_WRITE === "1") {
        const dir = join(ROOT, "docs", "eval");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "handwriting.md"), renderHandwritingMarkdown({ runs, offline: offline.verdicts, budget, variants: VARIANTS.map((v) => ({ name: v.name, ink: describeVariant(v) })) }));
        writeFileSync(join(dir, "handwriting.json"), JSON.stringify(
            {
              budget: { calls: budget.calls, cached: budget.hits, rateLimited: budget.rateLimited ?? 0 },
              variants: VARIANTS,
              // step-by-step transitions live in offline.json; here they would only repeat per variant
              runs: runs.map((r) => ({ ...r, verdict: r.verdict && { ...r.verdict, transitions: undefined, lines: undefined } })),
            },
            null,
            1,
          ) + "\n");
      }
    },
    30 * 60_000,
  );
});
