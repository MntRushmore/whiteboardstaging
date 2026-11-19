/**
 * runBoardDraw's decisions around the check before show (v1.0 reliability), with the models faked:
 * right work is a checkmark however it was asked for; a picture that fails its check is painted again
 * with the corrections; one that fails twice is never shown (Solve writes its answer instead); a
 * broken checker never stops a picture.
 */
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardDrawEvent } from "../contracts";

type Body = { model: string; messages: Array<{ content: unknown }> };
const calls: { tutor: number; painter: number; check: number; painterPrompts: string[] } = { tutor: 0, painter: 0, check: 0, painterPrompts: [] };
let tutorReply = "";
let checkReplies: Array<string | Error> = [];
let picture = "";
/** a painter or tutor that never answers until its call is stopped (the budget tests) */
let painterHangs = false;
let tutorHangs = false;
const hang = (signal?: AbortSignal) =>
  new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }));

vi.mock("@/lib/server/openrouter", async (orig) => {
  const real = await orig<typeof import("@/lib/server/openrouter")>();
  return {
    ...real,
    openrouterChat: vi.fn(async (body: Body, opts: { title?: string; signal?: AbortSignal }) => {
      if (opts.title?.endsWith("tutor")) {
        calls.tutor++;
        if (tutorHangs) return hang(opts.signal);
        return { choices: [{ message: { content: tutorReply } }], usage: { cost: 0.001 } };
      }
      if (opts.title?.endsWith("painter")) {
        calls.painter++;
        const parts = body.messages[0].content as Array<{ type: string; text?: string }>;
        calls.painterPrompts.push(parts.find((p) => p.type === "text")?.text ?? "");
        if (painterHangs) return hang(opts.signal);
        return { choices: [{ message: { content: "", images: [{ image_url: { url: picture } }] } }], usage: { cost: 0.034 } };
      }
      calls.check++;
      const r = checkReplies.shift() ?? '{"items":[],"ok":true}';
      if (r instanceof Error) throw r;
      return { choices: [{ message: { content: r } }], usage: { cost: 0.0005 } };
    }),
  };
});
vi.mock("@/lib/server/mathpix", () => ({ recognizeImage: vi.fn(async () => ({ ok: false, reason: "network" })) }));

const { runBoardDraw } = await import("../run");
const { decodeRgb } = await import("../overlay");

const W = 480;
const H = 320;
const KID = `<path d="M40 60 L120 60 M40 90 L140 90" stroke="#222" stroke-width="5"/>`;
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/>${KID}${body}</svg>`;
const boardPng = await sharp(Buffer.from(svg(""))).png().toBuffer();
picture = `data:image/png;base64,${(await sharp(Buffer.from(svg(`<rect x="250" y="150" width="120" height="60" fill="none" stroke="#000" stroke-width="5"/>`))).png().toBuffer()).toString("base64")}`;

async function run(mode: "feedback" | "suggest" | "answer", source: "auto" | "voice", extra: { budgetMs?: number; signal?: AbortSignal } = {}) {
  const events: BoardDrawEvent[] = [];
  const summary = await runBoardDraw({
    ...extra,
    runId: "r",
    requestId: "q",
    imageDataUrl: `data:image/png;base64,${boardPng.toString("base64")}`,
    board: await decodeRgb(boardPng),
    mode,
    source,
    signal: extra.signal ?? new AbortController().signal,
    emit: (e) => events.push(e),
  });
  return { summary, events, last: events[events.length - 1] };
}

const PICTURE = JSON.stringify({ needsHelp: true, correct: false, instructions: "Draw 47 as 4 tens rods and 7 ones, 38 as 3 rods and 8 ones, then = 85", checks: ["exactly 3 tens rods beside 38", "85 is written"], answer: "85" });
const FAIL = '{"items":[{"check":"1","seen":"2 rods","ok":false}],"ok":false}';
const PASS = '{"items":[{"check":"1","seen":"3 rods","ok":true}],"ok":true}';

beforeEach(() => {
  Object.assign(calls, { tutor: 0, painter: 0, check: 0, painterPrompts: [] });
  checkReplies = [];
  painterHangs = false;
  tutorHangs = false;
});

describe("runBoardDraw: the run's budget (never a hang, never a silent end)", () => {
  it("a painter that never answers: Solve writes the tutor's answer, and the painter's call is stopped", async () => {
    tutorReply = PICTURE;
    painterHangs = true;
    const t = Date.now();
    const { events, last, summary } = await run("answer", "voice", { budgetMs: 150 });
    expect(Date.now() - t).toBeLessThan(1000);
    expect(last).toEqual({ type: "write", latex: "= 85", expression: "85" });
    expect(events.filter((e) => e.type !== "status")).toHaveLength(1);
    expect(summary).toMatchObject({ result: "write", outOfTime: true });
    expect(summary.timings.totalMs).toBeGreaterThanOrEqual(140);
  });

  it("Suggest (no answer to write) ends with `none`, said plainly", async () => {
    tutorReply = JSON.stringify({ needsHelp: true, instructions: "Draw 4 rows of 3 dots", checks: ["4 rows of 3"], answer: "12" });
    painterHangs = true;
    const { last, summary } = await run("suggest", "voice", { budgetMs: 150 });
    const { OUT_OF_TIME_REASON } = await import("../run");
    expect(last).toEqual({ type: "none", reason: OUT_OF_TIME_REASON });
    expect(summary).toMatchObject({ result: "none", outOfTime: true });
  });

  it("a tutor that never answers ends with `none` too (nothing known to write)", async () => {
    tutorHangs = true;
    const { events, last } = await run("answer", "voice", { budgetMs: 150 });
    expect(last.type).toBe("none");
    expect(events.filter((e) => e.type !== "status")).toHaveLength(1);
  });

  it("a run inside its budget is untouched; a client that left gets no fallback", async () => {
    tutorReply = PICTURE;
    checkReplies = [PASS];
    const fast = await run("answer", "voice", { budgetMs: 5000 });
    expect(fast.last.type).toBe("done");
    expect(fast.summary.outOfTime).toBeUndefined();

    painterHangs = true;
    const gone = new AbortController();
    setTimeout(() => gone.abort(), 50);
    const left = await run("answer", "voice", { budgetMs: 150, signal: gone.signal });
    expect(left.events.filter((e) => e.type !== "status")).toEqual([]);
    expect(left.summary.result).toBe("aborted");
  });
});

describe("runBoardDraw: right work", () => {
  it("is a checkmark on Draw now too, even when the tutor wrote something to add (the demo's nudge)", async () => {
    tutorReply = '{"needsHelp": false, "correct": true, "instructions": "Great job! Maybe circle the 85."}';
    const { last, summary } = await run("suggest", "voice");
    expect(last).toEqual({ type: "none", reason: "The work is right.", correct: true });
    expect(summary.result).toBe("none");
    expect(calls.painter).toBe(0);
  });
});

describe("runBoardDraw: check before show", () => {
  it("shows a picture that passes, once painted, with the painter told to count and shade dark", async () => {
    tutorReply = PICTURE;
    checkReplies = [PASS];
    const { last, summary } = await run("answer", "voice");
    expect(last.type).toBe("done");
    expect(calls).toMatchObject({ painter: 1, check: 1 });
    expect(calls.painterPrompts[0]).toContain("never a pale fill");
    expect(summary.verify).toMatchObject({ checks: 2, first: "pass", problems: 0 });
  });

  it("paints again with the corrections when the check fails, and shows the second when it passes", async () => {
    tutorReply = PICTURE;
    checkReplies = [FAIL, PASS];
    const { last, summary } = await run("answer", "voice");
    expect(last.type).toBe("done");
    expect(calls).toMatchObject({ painter: 2, check: 2 });
    expect(calls.painterPrompts[1]).toContain("Your last picture was WRONG");
    expect(calls.painterPrompts[1]).toContain("exactly 3 tens rods beside 38 (you drew: 2 rods)");
    expect(summary).toMatchObject({ paints: 2, verify: { first: "fail", second: "pass" } });
  });

  it("never shows a picture that fails twice: Solve writes its answer in the tutor's hand", async () => {
    tutorReply = PICTURE;
    checkReplies = [FAIL, FAIL];
    const { events, last, summary } = await run("answer", "voice");
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(last).toEqual({ type: "write", latex: "= 85", expression: "85" });
    expect(summary).toMatchObject({ result: "write", verify: { first: "fail", second: "fail", withheld: "write" } });
  });

  it("…and Suggest shows nothing, with the answer guard on its checks", async () => {
    tutorReply = JSON.stringify({ needsHelp: true, instructions: "Draw 4 rows of 3 dots", checks: ["exactly 4 rows of 3 dots"], answer: "12" });
    checkReplies = [FAIL, FAIL];
    const { events, last, summary } = await run("suggest", "voice");
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(last.type).toBe("none");
    expect(summary).toMatchObject({ result: "none", verify: { checks: 2, withheld: "none" } });
  });

  it("fails open: a checker that errors does not stop the picture", async () => {
    tutorReply = PICTURE;
    checkReplies = [Object.assign(new Error("slow"), { name: "TimeoutError" })];
    const { last, summary } = await run("answer", "voice");
    expect(last.type).toBe("done");
    expect(summary.verify).toMatchObject({ first: "error", error: "timeout" });
    expect(calls.painter).toBe(1);
  });

  it("checks nothing when there is nothing to check (a note with no numbers, no answer)", async () => {
    tutorReply = JSON.stringify({ needsHelp: true, instructions: "Arrow to the ones: carry the ten?" });
    const { last, summary } = await run("feedback", "auto");
    expect(last.type).toBe("done");
    expect(calls.check).toBe(0);
    expect(summary.verify).toBeUndefined();
  });
});

describe("answerLatex", async () => {
  const { answerLatex } = await import("../run");
  it("writes Solve's answer the way the iPad writes plain arithmetic", () => {
    expect(answerLatex("85")).toBe("= 85");
    expect(answerLatex("5/6")).toBe("= \\frac{5}{6}");
    expect(answerLatex("x = 5")).toBe("x = 5");
    expect(answerLatex("= -6")).toBe("= -6");
    expect(answerLatex("2/3 is bigger")).toBeNull();
    expect(answerLatex("22 cm")).toBe("= 22 cm");
    expect(answerLatex("")).toBeNull();
    expect(answerLatex("red")).toBeNull();
    expect(answerLatex("<script>1")).toBeNull();
  });
});
