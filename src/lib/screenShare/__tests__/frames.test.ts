import { describe, expect, it } from "vitest";
import { base64Of, changed, CHUNK_CHARS, chunkFrame, frameSize, greyOf, screenTopic } from "../frames";

describe("the screen share's frames", () => {
  it("names one person's private channel", () => {
    expect(screenTopic("abc")).toBe("screen:abc");
  });

  it("cuts a frame into broadcast-sized chunks that put back together exactly", () => {
    const b64 = "A".repeat(CHUNK_CHARS * 2 + 10);
    const chunks = chunkFrame(7, b64, 1280, 720);
    expect(chunks.map((c) => [c.f, c.i, c.n])).toEqual([[7, 0, 3], [7, 1, 3], [7, 2, 3]]);
    expect(chunks.every((c) => c.d.length <= CHUNK_CHARS)).toBe(true);
    expect(chunks.map((c) => c.d).join("")).toBe(b64);
    expect(chunkFrame(1, "abc", 10, 10)).toEqual([{ f: 1, i: 0, n: 1, w: 10, h: 10, d: "abc" }]);
  });

  it("keeps a frame no wider than 1280 px, its shape kept", () => {
    expect(frameSize(2560, 1600)).toEqual({ w: 1280, h: 800 });
    expect(frameSize(800, 600)).toEqual({ w: 800, h: 600 });
    expect(frameSize(0, 600)).toEqual({ w: 0, h: 0 });
  });

  it("sees a new question as a change, and a blinking caret as none", () => {
    const a = new Uint8Array(64 * 36).fill(240);
    const caret = a.slice();
    caret[100] = 20;
    caret[164] = 20;
    const question = a.slice();
    for (let i = 300; i < 600; i++) question[i] = 30;
    expect(changed(null, a)).toBe(true);
    expect(changed(a, caret)).toBe(false);
    expect(changed(a, question)).toBe(true);
  });

  it("greys RGBA and takes the base64 out of a data URL", () => {
    expect(Array.from(greyOf([255, 255, 255, 255, 0, 0, 0, 255]))).toEqual([255, 0]);
    expect(base64Of("data:image/jpeg;base64,QUJD")).toBe("QUJD");
    expect(base64Of("nope")).toBe("");
  });
});
