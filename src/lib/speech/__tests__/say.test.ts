import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "tldraw";

const mod = vi.hoisted(() => ({
  sayAuto: vi.fn(),
  sayNow: vi.fn(),
  stop: vi.fn(),
  watchBoardWhileOn: vi.fn(),
}));
vi.mock("@/components/speech/readAloud", () => ({
  sayAuto: mod.sayAuto,
  sayNow: mod.sayNow,
  watchBoardWhileOn: mod.watchBoardWhileOn,
}));

const editor = {} as Editor;
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A window with events and requestIdleCallback (run by hand). */
function fakeWindow() {
  const target = new EventTarget();
  const idle: Array<() => void> = [];
  const w = Object.assign(target, {
    localStorage: { getItem: () => null },
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
  mod.watchBoardWhileOn.mockReset().mockReturnValue(mod.stop);
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
    expect(mod.watchBoardWhileOn).not.toHaveBeenCalled();
  });

  it("say / sayNow hand the words on once the module is loaded; blank words are dropped", async () => {
    vi.stubGlobal("window", fakeWindow().w);
    const { say, sayNow } = await import("../say");
    say("Try again");
    say("   ");
    say("Nice!", { polite: true });
    sayNow("Say it again");
    await vi.waitFor(() => expect(mod.sayNow).toHaveBeenCalled());
    expect(mod.sayAuto.mock.calls).toEqual([["Try again"], ["Nice!", { polite: true }]]);
    expect(mod.sayNow.mock.calls).toEqual([["Say it again"]]);
  });

  it("the watcher starts in idle time, as the one that runs only while read aloud is on, and its stop stops it", async () => {
    const { w, runIdle } = fakeWindow();
    vi.stubGlobal("window", w);
    const { watchReadAloud } = await import("../say");
    const stop = watchReadAloud(editor);
    await flush();
    expect(mod.watchBoardWhileOn).not.toHaveBeenCalled();
    runIdle();
    await vi.waitFor(() => expect(mod.watchBoardWhileOn).toHaveBeenCalledWith(editor));
    stop();
    expect(mod.stop).toHaveBeenCalled();
  });

  it("stopped before idle time: the watcher never starts", async () => {
    const { w, runIdle } = fakeWindow();
    vi.stubGlobal("window", w);
    const { watchReadAloud } = await import("../say");
    const stop = watchReadAloud(editor);
    stop();
    runIdle();
    // the module loads (say() proves it), and still no watcher
    const { say } = await import("../say");
    say("x");
    await vi.waitFor(() => expect(mod.sayAuto).toHaveBeenCalled());
    expect(mod.watchBoardWhileOn).not.toHaveBeenCalled();
  });
});
