import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "tldraw";

const mod = vi.hoisted(() => ({
  sayAuto: vi.fn(),
  sayNow: vi.fn(),
  stop: vi.fn(),
  watchBoard: vi.fn(),
}));
vi.mock("@/components/speech/readAloud", () => ({
  sayAuto: mod.sayAuto,
  sayNow: mod.sayNow,
  watchBoard: mod.watchBoard,
}));

import { READ_ALOUD_EVENT, READ_ALOUD_KEY } from "../contracts";

const editor = {} as Editor;
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A window with storage, events and requestIdleCallback (run by hand). */
function fakeWindow(stored: string | null) {
  const target = new EventTarget();
  const idle: Array<() => void> = [];
  const w = Object.assign(target, {
    localStorage: { getItem: (k: string) => (k === READ_ALOUD_KEY ? stored : null) },
    requestIdleCallback: (cb: () => void) => idle.push(cb),
    cancelIdleCallback: vi.fn(),
  });
  return { w, runIdle: () => idle.splice(0).forEach((cb) => cb()) };
}

beforeEach(() => {
  vi.resetModules();
  mod.sayAuto.mockReset();
  mod.sayNow.mockReset();
  mod.stop.mockReset();
  mod.watchBoard.mockReset().mockReturnValue(mod.stop);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("say.ts: the board's front door to read aloud", () => {
  it("on the server (no window) it does nothing and loads nothing", async () => {
    const { say, sayNow, watchReadAloud } = await import("../say");
    say("Hello");
    sayNow("Hello");
    watchReadAloud(editor)();
    await flush();
    expect(mod.sayAuto).not.toHaveBeenCalled();
    expect(mod.sayNow).not.toHaveBeenCalled();
    expect(mod.watchBoard).not.toHaveBeenCalled();
  });

  it("say / sayNow hand the words on once the module is loaded; blank words are dropped", async () => {
    vi.stubGlobal("window", fakeWindow(null).w);
    const { say, sayNow } = await import("../say");
    say("Try again");
    say("   ");
    sayNow("Say it again");
    await vi.waitFor(() => expect(mod.sayNow).toHaveBeenCalled());
    expect(mod.sayAuto.mock.calls).toEqual([["Try again"]]);
    expect(mod.sayNow.mock.calls).toEqual([["Say it again"]]);
  });

  it("the watcher starts in idle time, and its stop stops it", async () => {
    const { w, runIdle } = fakeWindow(null);
    vi.stubGlobal("window", w);
    const { watchReadAloud } = await import("../say");
    const stop = watchReadAloud(editor);
    await flush();
    expect(mod.watchBoard).not.toHaveBeenCalled();
    runIdle();
    await vi.waitFor(() => expect(mod.watchBoard).toHaveBeenCalledWith(editor));
    stop();
    expect(mod.stop).toHaveBeenCalled();
  });

  it("switched off on this device: nothing loads until it is switched on", async () => {
    const { w, runIdle } = fakeWindow("off");
    vi.stubGlobal("window", w);
    const { watchReadAloud } = await import("../say");
    watchReadAloud(editor);
    runIdle();
    await flush();
    expect(mod.watchBoard).not.toHaveBeenCalled();
    w.dispatchEvent(new CustomEvent(READ_ALOUD_EVENT, { detail: "off" }));
    await flush();
    expect(mod.watchBoard).not.toHaveBeenCalled();
    w.dispatchEvent(new CustomEvent(READ_ALOUD_EVENT, { detail: "on" }));
    await vi.waitFor(() => expect(mod.watchBoard).toHaveBeenCalledTimes(1));
  });

  it("stopped before idle time: the watcher never starts", async () => {
    const { w, runIdle } = fakeWindow(null);
    vi.stubGlobal("window", w);
    const { watchReadAloud } = await import("../say");
    const stop = watchReadAloud(editor);
    stop();
    runIdle();
    // the module loads (say() proves it), and still no watcher
    const { say } = await import("../say");
    say("x");
    await vi.waitFor(() => expect(mod.sayAuto).toHaveBeenCalled());
    expect(mod.watchBoard).not.toHaveBeenCalled();
  });
});
