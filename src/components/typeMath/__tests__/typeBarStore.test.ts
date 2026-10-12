import { afterEach, describe, expect, it, vi } from "vitest";
import { TYPE_EDIT_EVENT, listenForTypedEdits, requestTypedEdit, typedEditTarget } from "@/lib/typeMath/barLink";
import { TYPING_FIRST_QUERY, isTypingFirstDevice, setTypeBarOpen, toggleTypeBar, typeBarShown, typeBarState } from "../typeBarStore";

/** A window with the media queries a device answers, an event target and a localStorage. */
function stubWindow(matches: Record<string, boolean>, storage = new Map<string, string>()) {
  const target = new EventTarget();
  const win = Object.assign(target, {
    matchMedia: (q: string) => ({ matches: matches[q] ?? false, addEventListener: () => {}, removeEventListener: () => {} }),
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) },
  });
  vi.stubGlobal("window", win);
  return { win, storage };
}

afterEach(() => {
  vi.unstubAllGlobals();
  typeBarState.choice.set(null);
  typeBarState.forced.set(false);
  typeBarState.shown.set(false);
  typeBarState.editLine.set(null);
  typeBarState.suppressed.set(false);
});

describe("useTypingFirst: a laptop types first", () => {
  it("a mouse or trackpad as the main pointer (a touch-screen laptop too)", () => {
    stubWindow({ [TYPING_FIRST_QUERY]: true });
    expect(isTypingFirstDevice()).toBe(true);
  });

  it("an iPad or a phone (a coarse main pointer, no hover) does not", () => {
    stubWindow({ [TYPING_FIRST_QUERY]: false, "(pointer: coarse)": true });
    expect(isTypingFirstDevice()).toBe(false);
  });

  it("no window (a server render) or no matchMedia: not a laptop", () => {
    expect(isTypingFirstDevice()).toBe(false);
    vi.stubGlobal("window", {});
    expect(isTypingFirstDevice()).toBe(false);
  });
});

describe("typeBarShown: when the bar shows", () => {
  const base = { available: true, forced: false, choice: null, typingFirst: false, tour: false };

  it("opens by itself on a laptop; starts closed on a touch device", () => {
    expect(typeBarShown({ ...base, typingFirst: true })).toBe(true);
    expect(typeBarShown(base)).toBe(false);
  });

  it("the guided board's tour keeps it closed (it teaches the pen, and its coach marks sit there)", () => {
    expect(typeBarShown({ ...base, typingFirst: true, tour: true })).toBe(false);
  });

  it("the Type button's choice wins on any device, remembered", () => {
    expect(typeBarShown({ ...base, choice: true })).toBe(true);
    expect(typeBarShown({ ...base, typingFirst: true, choice: false })).toBe(false);
  });

  it("a readback's edit opens it; nothing opens it without a writer", () => {
    expect(typeBarShown({ ...base, choice: false, forced: true })).toBe(true);
    expect(typeBarShown({ ...base, available: false, typingFirst: true, choice: true, forced: true })).toBe(false);
  });

  it("the Type button toggles and remembers its choice on the device", () => {
    const { storage } = stubWindow({});
    typeBarState.forced.set(true);
    typeBarState.shown.set(false);
    toggleTypeBar(10_000);
    expect(typeBarState.choice.get()).toBe(true);
    expect(typeBarState.forced.get()).toBe(false);
    expect(typeBarState.openedBy.get()).toBe("button");
    expect(storage.get("agathon.type.open.v1")).toBe("1");
    setTypeBarOpen(false);
    expect(storage.get("agathon.type.open.v1")).toBe("0");
  });

  it("one tap, one toggle: tldraw's toolbar fires a touch's onSelect twice (touchstart, then click)", () => {
    stubWindow({});
    typeBarState.shown.set(false);
    toggleTypeBar(50_000);
    expect(typeBarState.choice.get()).toBe(true);
    typeBarState.shown.set(true);
    toggleTypeBar(50_120);
    expect(typeBarState.choice.get()).toBe(true);
    toggleTypeBar(51_000);
    expect(typeBarState.choice.get()).toBe(false);
  });

  it("open but stepped aside for Ask's sheet: Type closes the sheet instead of the bar", () => {
    const { storage } = stubWindow({});
    storage.set("agathon.chat.open.v1", "1");
    typeBarState.choice.set(true);
    typeBarState.shown.set(true);
    typeBarState.suppressed.set(true);
    toggleTypeBar(90_000);
    expect(typeBarState.choice.get()).toBe(true);
    expect(storage.get("agathon.chat.open.v1")).toBe("0");
  });

  it("a storage that throws keeps the choice for this visit", () => {
    vi.stubGlobal("window", { localStorage: { setItem: () => { throw new Error("denied"); } } });
    expect(() => setTypeBarOpen(true)).not.toThrow();
    expect(typeBarState.choice.get()).toBe(true);
  });
});

describe("the readback's edit goes to the bar (barLink)", () => {
  it("taken when a bar listens: the request says so, and the line reaches it", () => {
    stubWindow({});
    const got: string[] = [];
    const stop = listenForTypedEdits((id) => got.push(id));
    expect(typedEditTarget.get()).toBe(true);
    expect(requestTypedEdit("line-7")).toBe(true);
    expect(got).toEqual(["line-7"]);
    stop();
    expect(typedEditTarget.get()).toBe(false);
    // no bar: the shape keeps its own editor
    expect(requestTypedEdit("line-7")).toBe(false);
  });

  it("no line id, or no window: not taken", () => {
    expect(requestTypedEdit("line-1")).toBe(false);
    stubWindow({});
    const stop = listenForTypedEdits(() => {});
    expect(requestTypedEdit("")).toBe(false);
    // a malformed event is ignored, not taken
    expect(window.dispatchEvent(new CustomEvent(TYPE_EDIT_EVENT, { detail: {}, cancelable: true }))).toBe(true);
    stop();
  });
});
