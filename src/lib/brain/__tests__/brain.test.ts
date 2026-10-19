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
