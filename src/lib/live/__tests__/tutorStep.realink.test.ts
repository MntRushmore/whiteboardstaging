/**
 * The messy-handwriting guard over REAL kids' reads (docs/TUTOR-WRITES.md): a replay of a past real-ink
 * bench run's cached reads (no calls) through `nextTutorStep`, asked after every line of each attempt.
 * Counts what the tutor would do — write, read back, decline — and how many writes would be wrong for
 * the attempt's LABELED truth, with the guard and without it. The corpus lives outside every repo (this
 * one is public): nothing of it is here, and only aggregate numbers are printed.
 *
 *     AGATHON_REALINK=1 [AGATHON_REALINK_CASES=…/bench/cases.json] [AGATHON_REALINK_RUN=…/runs/reader2/fix2-replay-cases.json] \
 *       npx vitest run src/lib/live/__tests__/tutorStep.realink.test.ts
 *
 * The run's outcomes carry no confidence: every read counts as `sure`, the guard's hardest case. Stacked
 * sums need their ink (`stackStep`), so they are left out here.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { all, create } from "mathjs";
import { describe, expect, it } from "vitest";
import { createEngine } from "../engine";
import { nextTutorStep, sameAsAnchor, type TutorStepResult } from "../tutorStep";

const corpus = path.join(os.homedir(), "whiteboardstaging/agathon-corpus");
const CASES = process.env.AGATHON_REALINK_CASES ?? path.join(corpus, "bench/cases.json");
const RUN = process.env.AGATHON_REALINK_RUN ?? path.join(corpus, "runs/reader2/fix2-replay-cases.json");

interface Case {
  id: string;
  problem: string[] | null;
  lines: Array<{ latex: string }>;
}
interface Outcome {
  id: string;
  lines: Array<{ written: string; read: string | null; readRight?: boolean }>;
}

const stacked = (s: string) => /\\begin\{array\}|\\hline|\\\\/.test(s);

describe.skipIf(process.env.AGATHON_REALINK !== "1")("the guard over real reads", () => {
  it("never writes more wrong steps than without it, and reports the counts", { timeout: 300_000 }, () => {
    const engine = createEngine({ create, all } as unknown as Parameters<typeof createEngine>[0]);
    const cases = new Map((JSON.parse(fs.readFileSync(CASES, "utf8")) as Case[]).map((c) => [c.id, c]));
    const run = JSON.parse(fs.readFileSync(RUN, "utf8")) as Outcome[];
    const tally = { asks: 0, write: 0, readback: 0, held: 0, decline: 0, wrong: 0, unjudged: 0, misreadAsks: 0, misreadWrites: 0 };
    const bare = { write: 0, wrong: 0 };
    let skipped = 0;
    const kinds: Record<string, number> = {};
    const judge = (anchor: string, r: TutorStepResult, lastRead: string): "right" | "wrong" | "unknown" => {
      const a = engine.analyzeLine(anchor, { mode: "answer" });
      const line = r.inline ? `${lastRead} ${r.step}` : r.step;
      const v = sameAsAnchor(engine, anchor, a, line);
      return v === "same" ? "right" : v === "different" ? "wrong" : "unknown";
    };
    for (const o of run) {
      const c = cases.get(o.id);
      if (!c) continue;
      if (o.lines.some((l) => stacked(l.written) || (l.read && stacked(l.read)))) {
        skipped++;
        continue;
      }
      const problem = (c.problem ?? []).filter(Boolean);
      const reads: string[] = [];
      const truth: string[] = [];
      for (const l of o.lines) {
        if (!l.read) continue;
        if (reads.length > 0 && reads[reads.length - 1] === l.read) continue;
        reads.push(l.read);
        truth.push(l.written);
        const anchor = problem[0] ?? truth[0];
        if (!anchor) continue;
        tally.asks++;
        const sure = reads.map(() => "sure" as const);
        const r = nextTutorStep(engine, { problem, work: [...reads], trust: sure });
        // no guard: every read taken as confirmed, the kid's own problem as known
        const b = nextTutorStep(engine, { problem, work: [...reads], trust: reads.map(() => "confirmed" as const), known: true });
        if (b.kind === "step" || b.kind === "answer") {
          bare.write++;
          if (judge(anchor, b, reads[reads.length - 1]) === "wrong") bare.wrong++;
        }
        const anyMisread = o.lines.slice(0, truth.length).some((x) => x.readRight === false);
        if (anyMisread) tally.misreadAsks++;
        if (r.kind === "step" || r.kind === "answer") {
          tally.write++;
          if (anyMisread) tally.misreadWrites++;
          const j = judge(anchor, r, reads[reads.length - 1]);
          if (j === "wrong") tally.wrong++;
          if (j === "unknown") tally.unjudged++;
        } else if (r.kind === "readback") tally.readback++;
        else if (r.kind === "lastStep") tally.held++;
        else {
          tally.decline++;
          kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
        }
      }
    }
    console.log(`REALINK asks ${tally.asks} (stacked cases left out: ${skipped}) | write ${tally.write}, read back ${tally.readback}, last step held ${tally.held}, decline/none ${tally.decline} ${JSON.stringify(kinds)}`);
    console.log(`REALINK writes wrong for the labeled truth: ${tally.wrong} (unjudged ${tally.unjudged}); asks on work with a misread: ${tally.misreadAsks}, of which written ${tally.misreadWrites}`);
    console.log(`REALINK without the guard: write ${bare.write}, wrong ${bare.wrong}`);
    expect(tally.wrong).toBeLessThanOrEqual(bare.wrong);
  });
});
