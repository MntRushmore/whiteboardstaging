import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_LIMITS } from "@/lib/live/contracts";
import { recognizeStrokes } from "@/lib/server/mathpix";
import { cacheKey, handInk, handLatex, judgeRead, normalizeTex, payloadFor, pool, recognizeCached, VARIANTS, type CallBudget } from "./handwriting";
import { tokenDiff } from "./report";

vi.mock("@/lib/server/mathpix", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/mathpix")>()),
  recognizeStrokes: vi.fn(),
}));

/**
 * The handwriting scoreboard's offline half — no network: the tutor's hand becomes the board's
 * ink and payload, reads are judged, and Mathpix is only ever called through the cache and the
 * budget. (The live run itself is handwriting.test.ts, behind RUN_LIVE_EVAL=1.)
 */
describe("eval: the tutor's hand as the student's ink", () => {
  const [clean, slanted] = VARIANTS;

  it("writes a line as board ink the clusterer reads as ONE line, in both variants", () => {
    for (const v of VARIANTS) {
      const ink = handInk("2x + 3 = 11", v);
      expect(ink.unsupported).toEqual([]);
      expect(ink.strokes.length).toBeGreaterThan(5);
      expect(payloadFor(ink.strokes).clusters).toBe(1);
    }
  });

  it("reports what the hand cannot draw instead of drawing half of it", () => {
    expect(handInk("\\lim_{x \\to 2} (3x + 1)", clean).unsupported).toEqual(["\\lim"]);
    // Mathpix's `\mathrm{~km}` spacing is not ink
    expect(handLatex("5 \\mathrm{~km}")).toBe("5 \\,\\mathrm{km}");
    expect(handLatex("9.8 \\mathrm{~m/s^{2}}")).toBe("9.8 \\,\\mathrm{m/s}^{2}");
    expect(handInk("5 \\mathrm{~km} \\text{ to } \\mathrm{m}", clean).unsupported).toEqual([]);
  });

  it("builds the board's payload: integers, aligned, normalized to the line height, within the caps", () => {
    const { payload } = payloadFor(handInk("\\frac{x}{2} + 3 = 7", slanted).strokes);
    expect(payload).not.toBeNull();
    const p = payload!;
    expect(p.x.length).toBe(p.y.length);
    expect(p.x.length).toBeLessThanOrEqual(LIVE_LIMITS.maxStrokesPerLine);
    p.x.forEach((xs, i) => expect(xs.length).toBe(p.y[i].length));
    expect(p.x.flat().every(Number.isInteger)).toBe(true);
    expect(Math.max(...p.y.flat())).toBeGreaterThan(LIVE_LIMITS.normalizedLineHeight * 0.9);
    expect(Math.max(...p.y.flat())).toBeLessThanOrEqual(LIVE_LIMITS.normalizedLineHeight + 1);
  });

  it("is deterministic, and each variant is a different hand", () => {
    const a = payloadFor(handInk("x^{2} - 5x + 6 = 0", clean).strokes).payload!;
    const b = payloadFor(handInk("x^{2} - 5x + 6 = 0", clean).strokes).payload!;
    const c = payloadFor(handInk("x^{2} - 5x + 6 = 0", slanted).strokes).payload!;
    expect(cacheKey(a)).toBe(cacheKey(b));
    expect(cacheKey(a)).not.toBe(cacheKey(c));
  });
});

describe("eval: judging what Mathpix read", () => {
  it.each([
    ["2x + 3 = 11", "2 x+3=11", "exact"],
    ["x^{2} - 5x + 6 = 0", "x^2-5 x+6=0", "exact"],
    ["\\frac{x}{2} + 3 = 7", "\\frac{x}{2}+3=7", "exact"],
    ["3 - x \\geq 5", "3-x \\geq 5", "exact"],
    ["x^{2} - 4 < 0", "x^{2}-4<0", "exact"],
    ["2x + 3 = 11", "3 + 2x = 11", "semantic"],
    ["x + y = 18", "18 = x + y", "semantic"],
    ["4x + 3y - 2x + y", "4 x+3 y-2 x+y", "exact"],
    ["2x + 3 = 11", "2 x+3=17", "wrong"],
    ["2x + 3 > 11", "2 x+3<11", "wrong"],
    ["x = ?", "x=?", "exact"],
    ["f'(x) =", "f^{\\prime}(x)=", "exact"],
    ["x = ?", "x=7", "wrong"],
    ["2x + 3 = 11", "", "wrong"],
  ])("%s read as %s: %s", (written, read, want) => {
    expect(judgeRead(written, read)).toBe(want);
  });

  it("normalizes only what cannot change the maths", () => {
    expect(normalizeTex("\\left( x + 1 \\right)^{2}")).toBe("(x+1)^2");
    expect(normalizeTex("x \\leq 3")).toBe(normalizeTex("x \\le 3"));
    expect(normalizeTex("x \\le 3")).not.toBe(normalizeTex("x < 3"));
  });

  it("diffs a misread into what was lost and what was put in", () => {
    expect(tokenDiff("2x + 3 = 11", "2 \\times + 3 = 11")).toEqual({ removed: ["x"], added: ["\\times"] });
  });
});

describe("eval: Mathpix only through the cache and the budget", () => {
  const mock = vi.mocked(recognizeStrokes);
  const payload = payloadFor(handInk("2x + 3 = 11", VARIANTS[0]).strokes).payload!;
  let dir: string;
  let budget: CallBudget;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "eval-cache-"));
    budget = { remaining: 3, calls: 0, hits: 0 };
    mock.mockReset();
  });

  it("calls once, then answers from disk", async () => {
    mock.mockResolvedValue({ ok: true, latex: "2 x+3=11", text: "", confidence: 0.98, raw: {} });
    const first = await recognizeCached(payload, budget, dir);
    const second = await recognizeCached(payload, budget, dir);
    expect(first).toMatchObject({ ok: true, latex: "2 x+3=11", cached: false });
    expect(second).toMatchObject({ ok: true, latex: "2 x+3=11", cached: true });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(budget).toEqual({ remaining: 2, calls: 1, hits: 1 });
    // the cache holds the answer, never the request
    expect(readdirSync(dir)).toEqual([`${cacheKey(payload)}.json`]);
  });

  it("retries a transport failure once and does not cache it", async () => {
    mock.mockResolvedValue({ ok: false, reason: "timeout" });
    const r = await recognizeCached(payload, budget, dir);
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("waits out Mathpix's request limit instead of burning the budget on it", async () => {
    mock.mockResolvedValueOnce({ ok: false, reason: "http", status: 200, detail: "Limit exceeded for req (200) | http_max_requests" });
    mock.mockResolvedValueOnce({ ok: true, latex: "2 x+3=11", text: "", confidence: 1, raw: {} });
    const r = await recognizeCached(payload, budget, dir);
    expect(r).toMatchObject({ ok: true, cached: false });
    expect(budget.rateLimited).toBe(1);
    expect(budget.calls).toBe(2);
  });

  it("does not retry an error that is not transient", async () => {
    mock.mockResolvedValue({ ok: false, reason: "auth", status: 401 });
    expect(await recognizeCached(payload, budget, dir)).toMatchObject({ ok: false, reason: "auth" });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("paces request starts", async () => {
    mock.mockResolvedValue({ ok: true, latex: "x", text: "", confidence: 1, raw: {} });
    budget = { remaining: 10, calls: 0, hits: 0, minIntervalMs: 30 };
    const other = payloadFor(handInk("3x = 9", VARIANTS[0]).strokes).payload!;
    const t0 = Date.now();
    await Promise.all([recognizeCached(payload, budget, dir), recognizeCached(other, budget, dir)]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });

  it("stops at the call budget", async () => {
    budget.remaining = 0;
    expect(await recognizeCached(payload, budget, dir)).toMatchObject({ ok: false, reason: "budget" });
    expect(mock).not.toHaveBeenCalled();
  });

  it("keeps at most `limit` calls in flight and the results in order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await pool([5, 1, 4, 2, 3, 0], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });
});
