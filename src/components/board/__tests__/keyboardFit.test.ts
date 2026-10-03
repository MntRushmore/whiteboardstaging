/**
 * The board over the visible part of the screen while the on-screen keyboard is up for the Ask
 * panel docked beside it (src/components/board/keyboardFit.ts). The numbers are an 11" iPad's held
 * sideways (1194 x 834; the keyboard leaves ~430 px) and a phone's (the keyboard leaves ~330 px).
 */
import { describe, expect, it, vi } from "vitest";
import { attachKeyboardFit, keyboardFitBox, type KeyboardFitEnv } from "../keyboardFit";

const IPAD_SIDEWAYS = { height: 834 };
const PHONE_SIDEWAYS = { height: 390 };

describe("keyboardFitBox", () => {
  it("no keyboard: laid out as is", () => {
    expect(keyboardFitBox({ height: 834, offsetTop: 0, scale: 1 }, IPAD_SIDEWAYS)).toBeNull();
    // rounding or a thin bar is not a keyboard
    expect(keyboardFitBox({ height: 810, offsetTop: 0, scale: 1 }, IPAD_SIDEWAYS)).toBeNull();
  });

  it("the keyboard up on an iPad: the visible box, where Safari has panned to", () => {
    expect(keyboardFitBox({ height: 430.4, offsetTop: 0, scale: 1 }, IPAD_SIDEWAYS)).toEqual({ top: 0, height: 430 });
    expect(keyboardFitBox({ height: 430, offsetTop: 404, scale: 1 }, IPAD_SIDEWAYS)).toEqual({ top: 404, height: 430 });
    // a hardware keyboard's shortcut bar hides enough to count
    expect(keyboardFitBox({ height: 779, offsetTop: 0, scale: 1 }, IPAD_SIDEWAYS)).toEqual({ top: 0, height: 779 });
  });

  it("a phone, too little room, a pinch-zoomed page, no visual viewport: Safari's own handling", () => {
    expect(keyboardFitBox({ height: 190, offsetTop: 200, scale: 1 }, PHONE_SIDEWAYS)).toBeNull();
    expect(keyboardFitBox({ height: 300, offsetTop: 0, scale: 1 }, IPAD_SIDEWAYS)).toBeNull();
    expect(keyboardFitBox({ height: 500, offsetTop: 100, scale: 1.6 }, IPAD_SIDEWAYS)).toBeNull();
    expect(keyboardFitBox(null, IPAD_SIDEWAYS)).toBeNull();
    expect(keyboardFitBox({ height: 600, offsetTop: 0, scale: 1 }, { height: 0 })).toBeNull();
  });
});

function setup(opts: { docked?: boolean } = {}) {
  const vv = Object.assign(new EventTarget(), { height: IPAD_SIDEWAYS.height, offsetTop: 0, scale: 1 });
  const doc = new EventTarget();
  const state = { focusInPanel: false };
  const resetScroll = vi.fn();
  const env: KeyboardFitEnv = {
    viewport: vv,
    focusEvents: doc,
    layoutHeight: () => IPAD_SIDEWAYS.height,
    focusInPanel: () => state.focusInPanel,
    panelDocked: () => opts.docked ?? true,
    resetScroll,
  };
  const root = { style: { top: "", height: "", bottom: "" } as unknown as CSSStyleDeclaration };
  const detach = attachKeyboardFit(root, env);
  const keyboard = (height: number, offsetTop = 0) => {
    vv.height = height;
    vv.offsetTop = offsetTop;
    vv.dispatchEvent(new Event("resize"));
  };
  const focus = (inPanel: boolean) => {
    state.focusInPanel = inPanel;
    doc.dispatchEvent(new Event(inPanel ? "focusin" : "focusout"));
  };
  return { vv, root, keyboard, focus, detach, resetScroll };
}

describe("attachKeyboardFit", () => {
  it("typing in the panel: the root follows the visible box, and goes back when the keyboard does", () => {
    const t = setup();
    t.focus(true);
    expect(t.root.style).toMatchObject({ top: "", height: "", bottom: "" });
    t.keyboard(430, 404);
    expect(t.root.style).toMatchObject({ top: "404px", height: "430px", bottom: "auto" });
    // Safari settles its pan: the root follows
    t.vv.offsetTop = 0;
    t.vv.dispatchEvent(new Event("scroll"));
    expect(t.root.style).toMatchObject({ top: "0px", height: "430px" });
    t.keyboard(834, 0);
    expect(t.root.style).toMatchObject({ top: "", height: "", bottom: "" });
    expect(t.resetScroll).toHaveBeenCalledTimes(1);
  });

  it("leaving the panel (a tap on the board) puts the root back at once", () => {
    const t = setup();
    t.focus(true);
    t.keyboard(430);
    t.focus(false);
    expect(t.root.style).toMatchObject({ top: "", height: "", bottom: "" });
  });

  it("the panel as a bottom sheet (an upright iPad, a phone): Safari's own handling", () => {
    const t = setup({ docked: false });
    t.focus(true);
    t.keyboard(824, 341);
    expect(t.root.style).toMatchObject({ top: "", height: "" });
  });

  it("the keyboard up for something else (a text shape on the board): Safari's own handling", () => {
    const t = setup();
    t.keyboard(430, 404);
    expect(t.root.style).toMatchObject({ top: "", height: "" });
    expect(t.resetScroll).not.toHaveBeenCalled();
  });

  it("detaching while fitted puts the root back and stops listening", () => {
    const t = setup();
    t.focus(true);
    t.keyboard(430);
    t.detach();
    expect(t.root.style).toMatchObject({ top: "", height: "", bottom: "" });
    t.keyboard(500);
    expect(t.root.style.height).toBe("");
  });

  it("no visual viewport: nothing to do", () => {
    const root = { style: { top: "", height: "", bottom: "" } as unknown as CSSStyleDeclaration };
    const detach = attachKeyboardFit(root, { viewport: undefined, focusEvents: new EventTarget(), layoutHeight: () => 834, focusInPanel: () => true, panelDocked: () => true, resetScroll: () => {} });
    expect(() => detach()).not.toThrow();
  });
});
