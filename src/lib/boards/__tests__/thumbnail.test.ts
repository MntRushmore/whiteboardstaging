import { describe, expect, it } from "vitest";
import { DEFAULT_SCREEN, SCREEN } from "@/lib/screens/screens";
import { THUMBNAIL_RUNGS, THUMBNAIL_WIDTHS, createRungMemory, dataUrlLength, fitThumbnail, isBoardEmpty, thumbnailHeight, thumbnailRect } from "../thumbnail";
import { pendingExitWrites, settleExitWrites, trackExitWrite } from "../exitWrites";

/** A fake encoder: an image of `lengthAt(width, type, quality)` chars as a data URL (an unsupported type comes back as PNG). */
function fakeEncoder(lengthAt: (width: number, type: string, quality: number) => number, supported = ["image/webp", "image/jpeg"]) {
  const calls: string[] = [];
  const encode = async (width: number, type: string, quality: number) => {
    calls.push(`${width}:${type}@${quality}`);
    const actual = supported.includes(type) ? type : "image/png";
    // the bytes whose data URL is (at most 3 chars over) the length asked for
    const bytes = Math.max(0, Math.floor(((lengthAt(width, actual, quality) - `data:${actual};base64,`.length) / 4) * 3));
    return new Blob([new Uint8Array(bytes)], { type: actual });
  };
  return { encode, calls };
}

describe("fitThumbnail", () => {
  it("takes the largest, best encoding when it fits", async () => {
    const { encode, calls } = fakeEncoder(() => 12_000);
    const fit = await fitThumbnail(encode, 20_000);
    expect(fit?.blob.type).toBe("image/webp");
    expect(fit?.rung).toBe(0);
    expect(calls).toEqual([`${THUMBNAIL_WIDTHS[0]}:image/webp@0.8`]);
  });

  it("steps down quality, then width, until the URL fits the column", async () => {
    // A dense screen: only 480 px JPEG at 0.5 fits.
    const { encode, calls } = fakeEncoder((w, type, q) => (type === "image/webp" ? 50_000 : w >= 640 ? 30_000 : q >= 0.7 ? 21_000 : 15_000));
    const fit = await fitThumbnail(encode, 20_000);
    expect(fit?.blob.type).toBe("image/jpeg");
    expect(dataUrlLength("image/jpeg", fit!.blob.size)).toBeLessThanOrEqual(15_000);
    expect(calls.at(-1)).toBe("480:image/jpeg@0.5");
    expect(THUMBNAIL_RUNGS[fit!.rung]).toEqual({ width: 480, type: "image/jpeg", quality: 0.5 });
  });

  it("starts at the rung asked for: a board that needed a small one is not encoded from the top every save", async () => {
    const { encode, calls } = fakeEncoder(() => 12_000);
    const fit = await fitThumbnail(encode, 20_000, 5);
    expect(fit?.rung).toBe(5);
    expect(calls).toEqual([`${THUMBNAIL_RUNGS[5].width}:${THUMBNAIL_RUNGS[5].type}@${THUMBNAIL_RUNGS[5].quality}`]);
  });

  it("skips an encoder that silently falls back to PNG (Safari has no WebP)", async () => {
    const { encode } = fakeEncoder(() => 9_000, ["image/jpeg"]);
    expect((await fitThumbnail(encode, 20_000))?.blob.type).toBe("image/jpeg");
  });

  it("returns null when nothing fits or the encoder fails", async () => {
    expect(await fitThumbnail(fakeEncoder(() => 99_999).encode, 20_000)).toBeNull();
    expect(await fitThumbnail(async () => null, 20_000)).toBeNull();
  });
});

describe("dataUrlLength", () => {
  it("is the length of the data URL the blob reads as", () => {
    for (const bytes of [0, 1, 2, 3, 4, 1000, 14_999]) {
      const base64 = Buffer.from(new Uint8Array(bytes)).toString("base64");
      expect(dataUrlLength("image/webp", bytes)).toBe(`data:image/webp;base64,${base64}`.length);
    }
  });
});

describe("createRungMemory", () => {
  it("starts at the top, then where the last thumbnail fitted", () => {
    const m = createRungMemory(60_000);
    expect(m.start(0)).toBe(0);
    m.fitted(6);
    expect(m.start(10_000)).toBe(6);
    m.fitted(7);
    expect(m.start(20_000)).toBe(7);
  });

  it("walks from the top again after the refit time (ink rubbed out makes a board lighter)", () => {
    const m = createRungMemory(60_000);
    m.start(0);
    m.fitted(6);
    expect(m.start(59_999)).toBe(6);
    expect(m.start(60_000)).toBe(0);
    m.fitted(2);
    expect(m.start(70_000)).toBe(2);
  });

  it("starts from the top after nothing fitted", () => {
    const m = createRungMemory(60_000);
    m.start(0);
    m.fitted(6);
    m.fitted(null);
    expect(m.start(2_000)).toBe(0);
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
