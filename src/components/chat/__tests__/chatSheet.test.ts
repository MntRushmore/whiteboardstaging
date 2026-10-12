import { describe, expect, it } from "vitest";
import { CHAT_SHEET_HEIGHT, CHAT_SHEET_MIN_BOARD_PX, chatHostClass } from "../chatSheet";

/**
 * The chat's bottom sheet, pulled up tall on a phone or an upright iPad, never squeezes the board
 * so far that tldraw's toolbars and the page counter are pushed into the bar (QA 2026-10-12, 390×844).
 */

/** The tall sheet's height in px for a viewport `vh` px tall, as its class says (`max(46dvh, min(88dvh, 100dvh - N))`). */
function tallPx(vh: number): number {
  const m = /^h-\[max\((\d+)dvh,min\((\d+)dvh,calc\(100dvh_-_(\d+)px\)\)\)\]$/.exec(CHAT_SHEET_HEIGHT.tall);
  if (!m) throw new Error(`unexpected class ${CHAT_SHEET_HEIGHT.tall}`);
  const [rest, tall, board] = [Number(m[1]), Number(m[2]), Number(m[3])];
  expect(board).toBe(CHAT_SHEET_MIN_BOARD_PX);
  return Math.max((rest / 100) * vh, Math.min((tall / 100) * vh, vh - board));
}

describe("the chat sheet", () => {
  it("closed: no host; resting: 46% of the screen; tall: the capped height", () => {
    expect(chatHostClass(false, true)).toBe("hidden");
    expect(chatHostClass(true, false)).toContain(CHAT_SHEET_HEIGHT.rest);
    expect(chatHostClass(true, true)).toContain(CHAT_SHEET_HEIGHT.tall);
    expect(chatHostClass(true, true)).not.toContain("h-[88dvh]");
    // docked beside the board on a wide screen held sideways, whatever its height
    expect(chatHostClass(true, true)).toContain("md:landscape:h-auto");
  });

  it("pulled up tall, the board keeps room for its bar and toolbars, and the sheet is never shorter than at rest", () => {
    // a 390×844 phone: was 743 px (the board 101 px); now the board keeps 320
    expect(844 - tallPx(844)).toBe(CHAT_SHEET_MIN_BOARD_PX);
    expect(tallPx(844)).toBeGreaterThan(0.46 * 844);
    // an upright iPad (820×1180) and a small phone (375×667): the same room for the board
    expect(1180 - tallPx(1180)).toBe(CHAT_SHEET_MIN_BOARD_PX);
    expect(667 - tallPx(667)).toBe(CHAT_SHEET_MIN_BOARD_PX);
    // a very short screen: the resting height, never less
    expect(tallPx(560)).toBeCloseTo(0.46 * 560);
  });
});
