import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getEngine } from "@/lib/live/engine";
import { CORPUS } from "./corpus";
import { STAGES } from "./judge";
import { runOfflineEval, summaryLine } from "./offline";
import { renderOfflineMarkdown } from "./report";
import { YOUNG_CORPUS } from "./young/corpus";
import { runYoungEval, youngSummaryLine } from "./young/young";

/**
 * The offline maths scoreboard. Runs in every `npx vitest run` and never fails on a maths gap:
 * the corpus is full of things the engine cannot do YET, and the point is to see how many. It
 * asserts only that the harness itself works (every problem judged, stages coherent).
 *
 * With it, the young kids' section: a child's columns of working (K–6) marked as the board marks
 * them and compared with a teacher's marks (`young/`).
 *
 *   npm run eval:offline     same run, and writes docs/eval/offline.{md,json}
 */
const ROOT = resolve(__dirname, "..", "..");

describe("eval: offline scoreboard", () => {
  it("judges every corpus problem through localSolve, and marks every young column", async () => {
    const board = await runOfflineEval();
    expect(board.verdicts).toHaveLength(CORPUS.length);
    for (const v of board.verdicts) {
      // a pass is all five stages, and nothing passes without a local solution
      expect(v.pass).toBe(STAGES.every((s) => v.stages[s]));
      if (!v.stages.local) expect(v.pass).toBe(false);
      expect(v.failures.length === 0).toBe(v.pass);
    }
    console.log(summaryLine("eval:offline", board.summary));

    const young = runYoungEval(await getEngine());
    expect(young.verdicts).toHaveLength(YOUNG_CORPUS.length);
    for (const v of young.verdicts) expect(v.pass).toBe(v.lines.every((l) => l.pass) && v.solved.got === v.solved.expected);
    console.log(youngSummaryLine(young.summary));

    if (process.env.EVAL_WRITE === "1") {
      const dir = join(ROOT, "docs", "eval");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "offline.md"), renderOfflineMarkdown(board, young));
      writeFileSync(join(dir, "offline.json"), JSON.stringify({ summary: board.summary, verdicts: board.verdicts, young: { summary: young.summary, verdicts: young.verdicts } }, null, 2) + "\n");
    }
  }, 180_000);
});
