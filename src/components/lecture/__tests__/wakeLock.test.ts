/**
 * The screen stays on while a lecture listens (src/components/lecture/wakeLock.ts): an iPad that
 * locks itself suspends the page, and the microphone with it.
 */
import { describe, expect, it } from "vitest";
import { createScreenWakeLock } from "../wakeLock";

class Sentinel extends EventTarget {
  released = false;
  async release() {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

function env(opts: { refuse?: boolean } = {}) {
  const sentinels: Sentinel[] = [];
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  const wakeLock = {
    request: async (type: "screen") => {
      expect(type).toBe("screen");
      if (opts.refuse) throw new DOMException("refused", "NotAllowedError");
      const s = new Sentinel();
      sentinels.push(s);
      return s;
    },
  };
  const hide = async () => {
    doc.visibilityState = "hidden";
    // the browser releases every screen lock of a hidden page
    for (const s of sentinels) await s.release();
    doc.dispatchEvent(new Event("visibilitychange"));
  };
  const show = async () => {
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
  };
  const held = () => sentinels.filter((s) => !s.released).length;
  return { env: { wakeLock, doc: doc as unknown as Document }, sentinels, hide, show, held };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("createScreenWakeLock", () => {
  it("holds one lock while held, and lets go on release", async () => {
    const e = env();
    const lock = createScreenWakeLock(e.env);
    lock.hold();
    lock.hold();
    await settle();
    expect(e.sentinels).toHaveLength(1);
    expect(e.held()).toBe(1);
    lock.release();
    await settle();
    expect(e.held()).toBe(0);
  });

  it("asks again when the page comes back into view (the browser drops it when hidden)", async () => {
    const e = env();
    const lock = createScreenWakeLock(e.env);
    lock.hold();
    await settle();
    await e.hide();
    expect(e.held()).toBe(0);
    await e.show();
    await settle();
    expect(e.held()).toBe(1);
    // released: coming back into view asks for nothing
    lock.release();
    await e.hide();
    await e.show();
    await settle();
    expect(e.held()).toBe(0);
  });

  it("a lock granted after release is let go at once", async () => {
    const e = env();
    const lock = createScreenWakeLock(e.env);
    lock.hold();
    lock.release(); // before the request answered
    await settle();
    expect(e.sentinels).toHaveLength(1);
    expect(e.held()).toBe(0);
  });

  it("refused or missing: nothing breaks", async () => {
    const e = env({ refuse: true });
    const lock = createScreenWakeLock(e.env);
    expect(() => lock.hold()).not.toThrow();
    await settle();
    expect(() => lock.release()).not.toThrow();
    const none = createScreenWakeLock({ wakeLock: null, doc: null });
    expect(() => {
      none.hold();
      none.release();
    }).not.toThrow();
  });
});
