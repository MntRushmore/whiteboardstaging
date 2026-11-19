/**
 * The check before show (../verify.ts) and what it looks at (../kidView.ts): the reply reader trusts
 * the items over the summary, a broken checker fails open, the correction names what was wrong, and
 * the picture checked is the iPad's (a pale fill is nearly clear there).
 */
import { describe, expect, it } from "vitest";
import type { openrouterChat } from "@/lib/server/openrouter";
import { blueAlpha, kidViewRgb, TUTOR_BLUE } from "../kidView";
import { correctionNote, parseVerifyReply, serverChecks, verifyPicture, verifyPrompt } from "../verify";
import type { Rgb } from "../overlay";

const CHECKS = ["exactly 4 tens rods beside 47", "exactly 3 tens rods beside 38", "85 is written after ="];

describe("parseVerifyReply", () => {
  it("passes only when every item holds", () => {
    const pass = parseVerifyReply('{"items":[{"check":"1","seen":"4 rods","ok":true},{"check":"2","seen":"3 rods","ok":true}],"ok":true}', CHECKS);
    expect(pass?.ok).toBe(true);
    expect(pass?.problems).toEqual([]);
  });

  it("fails on a failed item even when the summary says ok (the demo's 38 as 2 rods)", () => {
    const r = parseVerifyReply('```json\n{"items":[{"check":"1","seen":"4 rods","ok":true},{"check":"2","seen":"2 rods","ok":false}],"ok":true}\n```', CHECKS);
    expect(r?.ok).toBe(false);
    expect(r?.problems).toEqual(["exactly 3 tens rods beside 38 (you drew: 2 rods)"]);
  });

  it("names the server's own last item (the sums) when it fails", () => {
    const r = parseVerifyReply('{"items":[{"check":"4","seen":"= 84","ok":false}],"ok":false}', CHECKS);
    expect(r?.problems[0]).toMatch(/^the blue numbers and sums are right/);
  });

  it("is null for a reply it can't read", () => {
    expect(parseVerifyReply("looks fine to me", CHECKS)).toBeNull();
    expect(parseVerifyReply('{"ok": "yes"}', CHECKS)).toBeNull();
  });
});

describe("the checker's words", () => {
  it("numbers the checks and always adds the sums check", () => {
    const p = verifyPrompt("Draw 47 and 38 in base-ten blocks", CHECKS);
    expect(p).toContain("1. exactly 4 tens rods beside 47");
    expect(p).toContain("4. every blue number and sum is mathematically right");
    expect(p).toContain("COUNT one by one");
  });

  it("guards Suggest and Feedback against the answer, not Solve", () => {
    expect(serverChecks("suggest", "12")[0]).toContain("do NOT give away the final answer (12)");
    expect(serverChecks("feedback", "85")).toHaveLength(1);
    expect(serverChecks("answer", "85")).toEqual([]);
    expect(serverChecks("suggest", undefined)).toEqual([]);
  });

  it("tells the painter what was wrong and what it must show", () => {
    const n = correctionNote(["exactly 3 tens rods beside 38 (you drew: 2 rods)"], CHECKS);
    expect(n).toContain("WRONG");
    expect(n).toContain("- exactly 3 tens rods beside 38 (you drew: 2 rods)");
    expect(n).toContain("- 85 is written after =");
    expect(n).toContain("never a pale fill");
  });
});

/** a 4×2 white board and an overlay with one black and one pale-yellow pixel */
const board: Rgb = { width: 4, height: 2, data: new Uint8Array(4 * 2 * 3).fill(255) };
function overlay(): Uint8Array {
  const o = new Uint8Array(4 * 2 * 4);
  o.set([0, 0, 0, 255], 0);
  o.set([255, 243, 176, 255], 4);
  return o;
}

describe("the kid's view (the iPad's tutorBlue)", () => {
  it("turns darkness into blue: black is solid, paper is clear, a pale fill nearly clear", () => {
    expect(blueAlpha(0, 0, 0, 255)).toBe(1);
    expect(blueAlpha(255, 255, 255, 255)).toBe(0);
    expect(blueAlpha(0, 0, 0, 0)).toBe(0);
    expect(blueAlpha(255, 243, 176, 255)).toBeLessThan(0.08);
  });

  it("lays the overlay over the board in tutor blue", () => {
    const v = kidViewRgb(board, overlay());
    expect([...v.data.slice(0, 3)]).toEqual([TUTOR_BLUE.r, TUTOR_BLUE.g, TUTOR_BLUE.b]);
    // the pale fill: barely tinted
    expect(v.data[3]).toBeGreaterThan(235);
    expect([...v.data.slice(6, 9)]).toEqual([255, 255, 255]);
  });
});

describe("verifyPicture", () => {
  const fake = (reply: string | Error): typeof openrouterChat =>
    (async (body: Record<string, unknown>) => {
      if (reply instanceof Error) throw reply;
      const content = (body.messages as Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>)[0].content;
      expect(content[0].image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
      expect(body.temperature).toBe(0);
      return { choices: [{ message: { content: reply } }], usage: { cost: 0.0004 } } as never;
    }) as typeof openrouterChat;
  const base = { board, overlayRgba: overlay(), instructions: "x", checks: CHECKS, mode: "answer" as const, signal: new AbortController().signal };

  it("passes and fails on the checker's items", async () => {
    const ok = await verifyPicture({ ...base, chat: fake('{"items":[{"check":"1","seen":"4","ok":true}],"ok":true}') });
    expect(ok).toMatchObject({ ok: true, problems: [], costUsd: 0.0004 });
    const bad = await verifyPicture({ ...base, chat: fake('{"items":[{"check":"3","seen":"84","ok":false}],"ok":false}') });
    expect(bad.ok).toBe(false);
    expect(bad.problems).toEqual(["85 is written after = (you drew: 84)"]);
  });

  it("fails open: an error, a timeout or an unreadable reply shows the picture, marked", async () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    expect(await verifyPicture({ ...base, chat: fake(timeout) })).toMatchObject({ ok: true, error: "timeout" });
    expect(await verifyPicture({ ...base, chat: fake(new Error("502")) })).toMatchObject({ ok: true, error: "upstream" });
    expect(await verifyPicture({ ...base, chat: fake("sure") })).toMatchObject({ ok: true, error: "unreadable" });
  });
});
