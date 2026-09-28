import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GEOMETRY_PROOFS } from "./courses/geometryProofs";
import { renderProofsMarkdown, runProofBoard } from "./proofs";

/**
 * The proofs scoreboard (offline, no recognizer, no model): the checker on correct proofs and on
 * seeded errors, and the planner from every prefix.
 *
 *   npm run eval:proofs     same run, and writes docs/eval/proofs.md
 */
const ROOT = resolve(__dirname, "..", "..");

describe("eval: two-column proofs", () => {
  it("ticks every correct row, rings the seeded errors, and plans every proof to the end", () => {
    const board = runProofBoard();
    const rows = board.check.reduce((n, c) => n + c.rows, 0);
    const ok = board.check.reduce((n, c) => n + c.ok, 0);
    const rung = board.seeds.filter((s) => s.rung).length;
    const prefixes = board.plan.reduce((n, p) => n + p.prefixes, 0);
    const completed = board.plan.reduce((n, p) => n + p.completed, 0);
    console.log(`eval:proofs: ${GEOMETRY_PROOFS.length} proofs; rows ticked ${ok}/${rows}; seeded errors ringed ${rung}/${board.seeds.length}; prefixes planned ${completed}/${prefixes}`);

    expect(GEOMETRY_PROOFS.length).toBeGreaterThanOrEqual(25);
    // (a) every row of every correct proof is ticked, and none is ever ringed without the figure
    expect(board.check.flatMap((c) => c.misses)).toEqual([]);
    // (b) at least 40 seeded errors, every one ringed, and no right row above one ringed
    expect(board.seeds.length).toBeGreaterThanOrEqual(40);
    expect(board.seeds.filter((s) => !s.rung).map((s) => s.seed.id)).toEqual([]);
    expect(board.seeds.filter((s) => s.falseRings.length > 0).map((s) => s.seed.id)).toEqual([]);
    // (c) the planner finishes every prefix from the figure read
    expect(board.plan.filter((p) => p.failed.length > 0).map((p) => `${p.id}: ${p.failed.join(",")}`)).toEqual([]);

    if (process.env.EVAL_WRITE === "1") {
      const dir = join(ROOT, "docs", "eval");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "proofs.md"), renderProofsMarkdown(board));
    }
  }, 120_000);
});
