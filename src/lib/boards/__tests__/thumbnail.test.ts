import { describe, expect, it } from "vitest";
import { DEFAULT_SCREEN, SCREEN } from "@/lib/screens/screens";
import { THUMBNAIL_WIDTHS, fitThumbnail, isBoardEmpty, thumbnailHeight, thumbnailRect } from "../thumbnail";
import { pendingExitWrites, settleExitWrites, trackExitWrite } from "../exitWrites";

/** A fake encoder: `sizes[width][type]` is the URL length at quality 1, shrinking with quality. */
function fakeEncoder(lengthAt: (width: number, type: string, quality: number) => number, supported = ["image/webp", "image/jpeg"]) {
  const calls: string[] = [];
  const encode = (width: number, type: string, quality: number) => {
    calls.push(`${width}:${type}@${quality}`);
    const actual = supported.includes(type) ? type : "image/png";
    return `data:${actual};base64,`.padEnd(lengthAt(width, actual, quality), "A");
  };
  return { encode, calls };
}

describe("fitThumbnail", () => {
  it("takes the largest, best encoding when it fits", () => {
    const { encode, calls } = fakeEncoder(() => 12_000);
    const url = fitThumbnail(encode, 20_000);
    expect(url?.startsWith("data:image/webp")).toBe(true);
    expect(calls).toEqual([`${THUMBNAIL_WIDTHS[0]}:image/webp@0.8`]);
  });

  it("steps down quality, then width, until the URL fits the column", () => {
    // A dense screen: only 480 px JPEG at 0.5 fits.
    const { encode, calls } = fakeEncoder((w, type, q) => (type === "image/webp" ? 50_000 : w >= 640 ? 30_000 : q >= 0.7 ? 21_000 : 15_000));
    const url = fitThumbnail(encode, 20_000);
    expect(url?.startsWith("data:image/jpeg")).toBe(true);
    expect(url?.length).toBe(15_000);
    expect(calls.at(-1)).toBe("480:image/jpeg@0.5");
  });

  it("skips an encoder that silently falls back to PNG (Safari has no WebP)", () => {
    const { encode } = fakeEncoder(() => 9_000, ["image/jpeg"]);
    expect(fitThumbnail(encode, 20_000)?.startsWith("data:image/jpeg")).toBe(true);
  });

  it("returns null when nothing fits or the encoder fails", () => {
    expect(fitThumbnail(fakeEncoder(() => 99_999).encode, 20_000)).toBeNull();
    expect(fitThumbnail(() => null, 20_000)).toBeNull();
  });
});

describe("thumbnail geometry", () => {
  it("is 16:9 like a screen", () => {
    for (const w of THUMBNAIL_WIDTHS) expect(thumbnailHeight(w) / w).toBeCloseTo(SCREEN.h / SCREEN.w, 2);
  });

  it("shows the page's screen, or a 16:9 screen around ink that predates screens", () => {
    expect(thumbnailRect({ screen: { x: 0, y: 0, w: 1600, h: 900 } }, null)).toEqual(DEFAULT_SCREEN);
    expect(thumbnailRect({}, null)).toEqual(DEFAULT_SCREEN);
    const grown = thumbnailRect({}, { x: 0, y: 0, w: 3000, h: 400 });
    expect(grown.w).toBeGreaterThanOrEqual(3000);
    expect(grown.w / grown.h).toBeCloseTo(SCREEN.w / SCREEN.h, 2);
  });
});

describe("isBoardEmpty", () => {
  const editorWith = (counts: number[]) => ({
    getPages: () => counts.map((_, i) => ({ id: `page:${i}` })),
    getPageShapeIds: (id: string) => new Set(Array.from({ length: counts[Number(id.split(":")[1])] }, (_, k) => k)),
  });

  it("is true only when every screen is blank", () => {
    expect(isBoardEmpty(editorWith([0]) as never)).toBe(true);
    expect(isBoardEmpty(editorWith([0, 0, 0]) as never)).toBe(true);
    expect(isBoardEmpty(editorWith([0, 3]) as never)).toBe(false);
  });
});

describe("exit writes", () => {
  it("resolves at once with nothing pending", async () => {
    await expect(settleExitWrites(10)).resolves.toBeUndefined();
  });

  it("waits for tracked writes, including failed ones", async () => {
    let finish!: () => void;
    const slow = new Promise<void>((r) => (finish = r));
    trackExitWrite(slow);
    trackExitWrite(Promise.reject(new Error("offline")));
    expect(pendingExitWrites()).toBeGreaterThan(0);
    let done = false;
    const settled = settleExitWrites(5_000).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await settled;
    expect(done).toBe(true);
    expect(pendingExitWrites()).toBe(0);
  });

  it("gives up after the timeout", async () => {
    trackExitWrite(new Promise(() => {}));
    const t0 = Date.now();
    await settleExitWrites(30);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});
