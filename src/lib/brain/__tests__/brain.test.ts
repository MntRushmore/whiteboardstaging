/**
 * The brain (`src/lib/brain`) is the web board's own logic behind plain JSON: each method must give
 * exactly what the functions it wraps give when the board calls them. Real inputs from the
 * scoreboards (`src/__eval__`). The JavaScriptCore side of the same promise is the Swift package's
 * parity test against `golden.ndjson` (`src/__eval__/brain/golden.test.ts`).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeLine,
  call,
  clusterStrokes,
  layoutHandwriting,
  localSolveOf,
  marks,
  nowYouTry,
  recognizerPayload,
  stackedLineOf,
  toInkStroke,
  variantOf,
  weakSpotPractice,
  type BrainStroke,
} from "@/lib/brain";
import { decode, encode } from "@/lib/brain/json";
import { sha1Hex } from "@/lib/brain/sha1";
import { getEngine } from "@/lib/live/engine";
import type { InkLine, InkStroke } from "@/lib/live/contracts";
import { barGroups, splitInk } from "@/lib/live/diagrams";
import { stackGroups } from "@/lib/live/stackedSums";
import { toInkStrokes as fixtureInk, writeStack } from "@/lib/live/__fixtures__/strokes";
import { clusterLines, unionRects } from "@/lib/live/strokeClusters";
import { buildPayload, hashPayload } from "@/lib/live/strokePayload";
import { localSolve } from "@/lib/live/localSolve";
import { HAND_WRITE, handSeedFor, handSizeFor, planFromStrokes, planHandwriting } from "@/lib/live/handwriting";
import { markStrokes } from "@/lib/live/marks";
import { problemLines, seedOf } from "@/lib/learning/nowYouTry";
import { practiceProblems, hasPractice } from "@/lib/learning/practiceSet";
import { learnerHint, summarize } from "@/lib/learning/summary";
import { ATTEMPTS, NOW, TZ } from "@/lib/learning/__tests__/progressFixtures";
import { weakSpotPractice as webWeakSpotPractice } from "@/components/chat/chatView";
import { CORPUS } from "@/__eval__/corpus";
import { canDraw } from "@/__eval__/offline";
import { handInk, VARIANTS } from "@/__eval__/handwriting";
import { buildBarScenes, buildScenes } from "@/__eval__/drawings";
import { toBrainStrokes } from "@/__eval__/brain/cases";

/**
 * Strokes as the board holds them, and as the app sends them: the same points, no rounding, and the
 * same box (the board's box is the editor's geometry, which need not be the points' box to the last
 * bit; the app passes its own the same way).
 */
function both(ink: InkStroke[]): { ink: InkStroke[]; brain: BrainStroke[] } {
  return { ink, brain: ink.map((s) => ({ id: s.id as string, x: s.segments[0].map((p) => p.x), y: s.segments[0].map((p) => p.y), bounds: s.bounds })) };
}

/** A record without its random id: what the clusterer decided, not its dice. */
function withoutId<T extends { id: string }>(record: T): Omit<T, "id"> {
  const rest: Partial<T> = { ...record };
  delete rest.id;
  return rest as Omit<T, "id">;
}

function shapeOf(lines: readonly InkLine[]) {
  return lines.map(withoutId);
}

describe("sha1Hex", () => {
  it("is SHA-1 of the UTF-8 bytes", () => {
    const samples = ["", "a", "abc", JSON.stringify([[1, 2, 3], [4, 5]]), "x".repeat(1000), "π ≈ 3.14159 — ∑ 😀", "\u{10FFFF}é"];
    for (let i = 0; i < 40; i++) samples.push(Array.from({ length: i * 13 }, (_, k) => String.fromCharCode(32 + ((k * 7 + i) % 90))).join(""));
    for (const s of samples) expect(sha1Hex(s), s.slice(0, 20)).toBe(createHash("sha1").update(s, "utf8").digest("hex"));
  });
});

describe("json across the boundary", () => {
  it("keeps Infinity and NaN, and leaves a LaTeX line that reads NaN alone", () => {
    const value = { latex: "NaN", domain: { lo: -Infinity, hi: Infinity, latex: "Infinity" }, at: NaN, solutions: [1, Infinity] };
    const back = decode<typeof value>(encode(value));
    expect(back.latex).toBe("NaN");
    expect(back.domain.lo).toBe(-Infinity);
    expect(back.domain.hi).toBe(Infinity);
    expect(back.domain.latex).toBe("Infinity");
    expect(back.at).toBeNaN();
    expect(back.solutions).toEqual([1, Infinity]);
  });

  it("answers in an envelope and never throws", () => {
    expect(JSON.parse(call("analyzeLine", JSON.stringify({ latex: "2x + 3 = 11" }))).ok).toBe(true);
    expect(JSON.parse(call("nope", "{}")).error.code).toBe("unknown_method");
    expect(JSON.parse(call("analyzeLine", JSON.stringify({ latex: 4 }))).error.code).toBe("bad_args");
    expect(JSON.parse(call("analyzeLine", "{not json")).error.code).toBe("threw");
    expect(JSON.parse(call("toString", "{}")).error.code).toBe("unknown_method");
  });
});

describe("the engine", () => {
  it("analyzeLine is engine.analyzeLine", { timeout: 60_000 }, async () => {
    const engine = await getEngine();
    for (const p of CORPUS.slice(0, 200)) {
      for (const latex of p.lines) expect(analyzeLine({ latex, context: { mode: "feedback" } }), latex).toEqual(engine.analyzeLine(latex, { mode: "feedback" }));
    }
  });

  it("localSolve is the offline scoreboard's Solve, over the whole corpus", { timeout: 120_000 }, async () => {
    const engine = await getEngine();
    for (const p of CORPUS) expect(localSolveOf({ lines: p.lines }), p.id).toEqual(localSolve(engine, p.lines, undefined, { canDraw }));
  });
});

describe("ink", () => {
  it("recognizerPayload is buildPayload, and its hash the board's WebCrypto sha-1", { timeout: 60_000 }, async () => {
    const lines = CORPUS.flatMap((p) => p.lines).filter((_, i) => i % 9 === 0);
    for (const [i, latex] of lines.entries()) {
      const { strokes } = handInk(latex, VARIANTS[i % VARIANTS.length]);
      if (strokes.length === 0) continue;
      const { brain } = both(strokes);
      const line: InkLine = { id: "line", strokeIds: strokes.map((s) => s.id), bounds: unionRects(strokes.map((s) => s.bounds)), column: 0, row: 0, hash: "" };
      const payload = buildPayload(line, strokes);
      const got = recognizerPayload({ strokes: brain });
      if (!payload) {
        expect(got).toBeNull();
        continue;
      }
      expect(got?.strokes).toEqual({ x: payload.x, y: payload.y });
      expect(got?.bounds).toEqual({ w: payload.w, h: payload.h });
      expect(got?.hash).toBe(await hashPayload(payload));
    }
  });

  it("a stroke's box is its points' box", () => {
    const s = toInkStroke({ id: "s", x: [3, 1, 2], y: [5, 9, 4] });
    expect(s.bounds).toEqual({ x: 1, y: 4, w: 2, h: 5 });
  });

  it("clusterStrokes is the board's flush: drawings apart, bars and stacks a line each, then lines", { timeout: 120_000 }, () => {
    const scenes = [
      ...buildScenes()
        .filter((_, i) => i % 37 === 0)
        .map((s) => ({ ink: [...s.math, ...s.drawn.strokes, ...s.drawn.labels.flat()], equations: undefined })),
      ...buildBarScenes()
        .filter((_, i) => i % 7 === 0)
        .map((s) => ({ ink: s.ink, equations: s.equations })),
    ];
    expect(scenes.length).toBeGreaterThan(80);
    for (const scene of scenes) {
      const { ink, brain } = both(scene.ink);
      const split = splitInk(ink, [], { equations: scene.equations });
      const want = clusterLines(split.writing, [], [...barGroups(split.bars, ink), ...stackGroups(split.stacks, ink)]);
      const got = clusterStrokes({ strokes: brain, equations: scene.equations });
      expect(shapeOf(got.lines)).toEqual(shapeOf(want));
      expect(got.diagrams.map(withoutId)).toEqual(split.diagrams.map(withoutId));
      expect(got.bars).toEqual(split.bars);
      expect(got.roles).toEqual(Object.fromEntries(split.roles));
    }
  });

  it("seeded ids make clusterStrokes repeatable, and previous lines keep theirs", () => {
    const strokes = toBrainStrokes(handInk("2x + 3 = 11", VARIANTS[0]).strokes);
    const a = clusterStrokes({ strokes, idSeed: 5 });
    const b = clusterStrokes({ strokes, idSeed: 5 });
    expect(a).toEqual(b);
    expect(a.lines[0].id).toMatch(/^ln_[0-9a-f]{8}$/);
    const again = clusterStrokes({ strokes, previousLines: a.lines });
    expect(again.lines.map((l) => l.id)).toEqual(a.lines.map((l) => l.id));
  });
});

describe("the board's flush (cells, mates, strays)", () => {
  /** `latex` in the clean hand, its ink's top-left at (x, y), with ids `p…`. */
  function line(latex: string, x: number, y: number, prefix: string): BrainStroke[] {
    const strokes = toBrainStrokes(handInk(latex, VARIANTS[0]).strokes);
    const x0 = Math.min(...strokes.flatMap((s) => s.x));
    const y0 = Math.min(...strokes.flatMap((s) => s.y));
    return strokes.map((s, i) => ({ id: `${prefix}${i}`, x: s.x.map((v) => v - x0 + x), y: s.y.map((v) => v - y0 + y) }));
  }
  /** a problem page's cell: the whole page, the problem at its top */
  const page = { key: "page", n: 1, lines: ["3x - 5 = 10"], head: { x: 88, y: 60, w: 400, h: 70 }, cell: { x: 40, y: 40, w: 1520, h: 840 } };
  const columnsOf = (lines: InkLine[]) => lines.map((l) => [l.strokeIds[0].replace(/\d+$/, ""), l.column, l.row]);

  it("the work in one problem's cell is one column, however far apart its lines are", () => {
    // `3x = 15` on the first guide line, `x = 5` three guide lines under it (a blank gap of a new problem's)
    const strokes = [...line("3x = 15", 140, 236, "a"), ...line("x = 5", 140, 470, "b")];
    expect(columnsOf(clusterStrokes({ strokes, idSeed: 1 }).lines)).toEqual([["a", 0, 0], ["b", 1, 0]]);
    expect(columnsOf(clusterStrokes({ strokes, idSeed: 1, cells: [page] }).lines)).toEqual([["a", 0, 0], ["b", 0, 1]]);
    // lines that were one problem stay one (`mates`), with no cell
    const first = clusterStrokes({ strokes, idSeed: 1 }).lines;
    const again = clusterStrokes({ strokes, previousLines: first, mates: [first.map((l) => l.id)] }).lines;
    expect(new Set(again.map((l) => l.column)).size).toBe(1);
  });

  it("strays are no line: taps of the pen anywhere, an answer's signs and her own tick under a problem", () => {
    const tap = { id: "t0", x: [700, 701, 700], y: [500, 501, 501] };
    const work = line("2x = 8", 140, 236, "a");
    const withTap = clusterStrokes({ strokes: [...work, tap], idSeed: 2, cells: [] }).lines;
    expect(withTap.flatMap((l) => l.strokeIds)).not.toContain("t0");
    expect(clusterStrokes({ strokes: [...work, tap], idSeed: 2 }).lines.flatMap((l) => l.strokeIds)).toContain("t0");
    // `=` alone under the problem, its number still to come
    const sum = { ...page, lines: ["4 + 3"] };
    const signs = line("=", 140, 400, "e");
    expect(clusterStrokes({ strokes: [...work, ...signs], idSeed: 3, cells: [sum] }).lines.flatMap((l) => l.strokeIds).some((id) => id.startsWith("e"))).toBe(false);
  });

  it("a bar with a number under it is divide both sides", () => {
    expect(call("youngRead", JSON.stringify({ latex: "3", bar: true }))).toBe('{"ok":true,"result":{"latex":"\\\\div 3"}}');
    expect(call("youngRead", JSON.stringify({ latex: "3" }))).toBe('{"ok":true,"result":{"latex":"3"}}');
  });
});

describe("stacked sums", () => {
  /** A stacked sum written in the tutor's hand as a student, clustered as the board clusters it: its stack and its line. */
  function stacked(rows: string[], answer: string | null) {
    const ink = fixtureInk(writeStack(rows, answer).all);
    const got = clusterStrokes({ strokes: ink.map((s) => ({ id: s.id as string, x: s.segments[0].map((p) => p.x), y: s.segments[0].map((p) => p.y) })) });
    expect(got.stacks).toHaveLength(1);
    return got.stacks[0];
  }

  it("a stacked sum is worked column by column, as the board works it: a tick, a ring round the wrong digit, nothing yet", () => {
    const stack = stacked(["286", "+680"], "966");
    const right = stackedLineOf({ latex: "\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 966 \\end{array}", confidence: 0.99, stack });
    expect(right.stacked).toBe(true);
    expect(right.analysis).toMatchObject({ verdict: "ok", solved: true });
    // the tick after the answer row, level with it
    expect(right.tick?.y).toBeCloseTo(stack.answer!.rect.y);
    const wrongStack = stacked(["286", "+680"], "866");
    const wrong = stackedLineOf({ latex: "\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 866 \\end{array}", confidence: 0.99, stack: wrongStack });
    expect(wrong.analysis).toMatchObject({ verdict: "mismatch", note: "Add the 1 you carried to the hundreds." });
    // the ring round the hundreds digit alone
    expect(wrong.ring!.w).toBeLessThan(wrongStack.answer!.rect.w);
    // unsure of the read: quiet, never a ring
    expect(stackedLineOf({ latex: "\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 866 \\end{array}", confidence: 0.6, stack: wrongStack }).analysis?.verdict).toBe("unknown");
    // started (no answer yet): nothing
    const open = stacked(["123", "+456"], null);
    expect(stackedLineOf({ latex: "\\begin{array}{r} 123 \\\\ +456 \\\\ \\hline \\end{array}", stack: open }).analysis?.verdict).toBe("none");
  });

  it("a read of a stack without its layout is worked from the read; a fraction misread from one is quiet; any other line is no stack", () => {
    expect(stackedLineOf({ latex: "\\begin{array}{r} 52 \\\\ -17 \\\\ \\hline 35 \\end{array}" }).analysis).toMatchObject({ verdict: "ok", solved: true });
    expect(stackedLineOf({ latex: "\\frac{+680}{966}" })).toMatchObject({ stacked: true, analysis: { verdict: "unknown" } });
    expect(stackedLineOf({ latex: "286 + 680 = 966" })).toEqual({ stacked: false, analysis: null, tick: null, ring: null });
    // long multiplication, its rows and its sum
    expect(stackedLineOf({ latex: "\\begin{array}{r} 46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 920 \\\\ \\hline 1058 \\end{array}" }).analysis).toMatchObject({ verdict: "ok", solved: true });
    expect(stackedLineOf({ latex: "\\begin{array}{r} 46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 920 \\\\ \\hline 1048 \\end{array}" }).analysis?.verdict).toBe("mismatch");
  });
});

describe("the hand", () => {
  it("layoutHandwriting is planHandwriting at the board's size and seed", () => {
    for (const p of CORPUS.filter((_, i) => i % 30 === 0)) {
      const got = layoutHandwriting({ steps: p.lines, lineHeight: 40, zoom: 0.52, seedKey: "ln_x" });
      const want = planHandwriting(p.lines, { size: handSizeFor(40, 0.52), seed: handSeedFor("ln_x") });
      expect(got.plan).toEqual(want.plan);
      expect(got.unsupported).toEqual(want.unsupported);
    }
  });

  it("marks are LiveLoop's: markStrokes, revealed at the hand's smallest size", () => {
    const bbox = { x: 100, y: 200, w: 180, h: 40 };
    for (const kind of ["check", "circle", "question"] as const) {
      const strokes = markStrokes(kind, bbox, handSeedFor(`ln_1:${kind}`));
      const got = marks({ kind, bbox, seedKey: `ln_1:${kind}` });
      expect(got.strokes).toEqual(strokes);
      expect(got.plan).toEqual(planFromStrokes(kind, strokes, HAND_WRITE.minSize));
    }
  });
});

describe("learning", () => {
  it("weakSpotPractice is the chat chip's", () => {
    const hint = learnerHint(summarize(ATTEMPTS, NOW, { tzOffsetMinutes: TZ }));
    for (const seed of [1, 2, 77, 1234]) expect(weakSpotPractice({ hint, seed })).toEqual(webWeakSpotPractice(hint, { hasPractice, practiceProblems }, seed));
  });

  it("nowYouTry is variantOf on the attempt's problem and seed", () => {
    for (const a of ATTEMPTS.slice(0, 4)) {
      expect(nowYouTry({ problemLatex: a.problemLatex, attemptId: a.id, stillClock: true })).toEqual(variantOf({ problem: problemLines(a.problemLatex), seed: seedOf(a.id), stillClock: true }));
    }
  });
});

describe("brain.js", () => {
  it("the committed bundle is what the sources build (`npm run brain:build`)", { timeout: 60_000 }, async () => {
    const { buildBrain } = await import("../../../../scripts/build-ios-brain.mjs");
    const { code } = await buildBrain({ write: false });
    const committed = readFileSync(resolve(__dirname, "../../../../ios/Packages/AgathonBrain/Sources/AgathonBrain/Resources/brain.js"), "utf8");
    expect(code === committed, "brain.js is stale: run `npm run brain:build` and commit it").toBe(true);
  });
});
