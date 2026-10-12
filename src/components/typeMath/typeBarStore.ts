"use client";

import { useEffect, useSyncExternalStore } from "react";
import { atom, useValue } from "tldraw";
import { listenForTypedEdits } from "@/lib/typeMath/barLink";
import { setChatOpen } from "@/components/chat/useChatOpen";

/**
 * Type it's bar (docs/TYPE-MATH.md), the part in the board's first load: whether it shows, the
 * toolbar's Type buttons, and a line sent to it to edit. The bar itself, with the parser and its
 * preview, is the lazy chunk `TypeBar`, mounted by the board page while it shows.
 */

/** The main pointer is a mouse or a trackpad: a laptop (a touch-screen laptop too), not an iPad. */
export const TYPING_FIRST_QUERY = "(pointer: fine) and (hover: hover)";

const CHOICE_KEY = "agathon.type.open.v1";

function readChoice(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(CHOICE_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

export type TypeBarOpener = "default" | "button" | "edit";

export const typeBarState = {
  /** the board's controller writes typed lines (`writeTyped`): the Type buttons show */
  available: atom("typeBar.available", false),
  /** the bar shows (the board page decides; the Type buttons read it) */
  shown: atom("typeBar.shown", false),
  /** opened or closed with a Type button on this device (remembered); null: never */
  choice: atom<boolean | null>("typeBar.choice", readChoice()),
  /** opened to edit a line (a readback's double-click): this visit only */
  forced: atom("typeBar.forced", false),
  /** what opened it last, for `type.open` */
  openedBy: atom<TypeBarOpener>("typeBar.openedBy", "default"),
  /** open, but stepped aside for Ask's bottom sheet on a short board (the bar sets it) */
  suppressed: atom("typeBar.suppressed", false),
  /** a line to load into the box, taken (and cleared) by the bar */
  editLine: atom<string | null>("typeBar.editLine", null),
};

function subscribePointer(cb: () => void): () => void {
  const mql = typeof window !== "undefined" ? window.matchMedia?.(TYPING_FIRST_QUERY) : undefined;
  mql?.addEventListener?.("change", cb);
  return () => mql?.removeEventListener?.("change", cb);
}

/** The device's answer now (`useTypingFirst`'s snapshot): false without a window or `matchMedia`. */
export function isTypingFirstDevice(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.(TYPING_FIRST_QUERY).matches ?? false);
}

/** True where the main pointer is a mouse or trackpad: there the bar opens by itself, focused. */
export function useTypingFirst(): boolean {
  return useSyncExternalStore(subscribePointer, isTypingFirstDevice, () => false);
}

/** Opens or closes the bar (a Type button): remembered on this device. */
export function setTypeBarOpen(open: boolean): void {
  typeBarState.forced.set(false);
  typeBarState.choice.set(open);
  if (open) typeBarState.openedBy.set("button");
  try {
    window.localStorage.setItem(CHOICE_KEY, open ? "1" : "0");
  } catch {
    /* private mode: this visit only */
  }
}

/** A second toggle this soon after one is the same tap (see `toggleTypeBar`). */
const TOGGLE_ONCE_MS = 450;
let lastToggle = -Infinity;

/**
 * A Type button's tap. tldraw's toolbar item calls its `onSelect` on touchstart AND on the click
 * that follows (React's touch listeners are passive, so its preventDefault cannot stop the click):
 * harmless for a tool, but a toggle would open and close again. One tap, one toggle.
 */
export function toggleTypeBar(now: number = Date.now()): void {
  if (now - lastToggle < TOGGLE_ONCE_MS) return;
  lastToggle = now;
  // open but hidden by Ask's sheet: the kid wants to type, so the sheet goes and the bar is back
  if (typeBarState.shown.get() && typeBarState.suppressed.get()) {
    setChatOpen(false);
    return;
  }
  setTypeBarOpen(!typeBarState.shown.get());
}

/** Whether the bar shows (`useTypeBar`): pure, for the tests. */
export function typeBarShown(o: { available: boolean; forced: boolean; choice: boolean | null; typingFirst: boolean; tour: boolean }): boolean {
  return o.available && (o.forced || (o.choice ?? (o.typingFirst && !o.tour)));
}

/**
 * The board page: whether the bar shows. The device's choice once made with a Type button; else
 * open where the main pointer is a mouse or trackpad, but not on the guided first board (its tour
 * teaches the pen, and its coach marks sit where the bar would). A readback's edit opens it too.
 * Only while the board can write typed lines (`available`); then a readback's double-click comes
 * here instead of the LaTeX editor.
 */
export function useTypeBar(available: boolean, tour: boolean): boolean {
  const typingFirst = useTypingFirst();
  const choice = useValue("type bar choice", () => typeBarState.choice.get(), []);
  const forced = useValue("type bar forced", () => typeBarState.forced.get(), []);
  const shown = typeBarShown({ available, forced, choice, typingFirst, tour });
  useEffect(() => {
    typeBarState.available.set(available);
    typeBarState.shown.set(shown);
  }, [available, shown]);
  useEffect(() => {
    if (!available) return;
    const stop = listenForTypedEdits((lineId) => {
      typeBarState.forced.set(true);
      typeBarState.openedBy.set("edit");
      typeBarState.editLine.set(lineId);
    });
    return () => {
      stop();
      typeBarState.available.set(false);
      typeBarState.shown.set(false);
    };
  }, [available]);
  return shown;
}

/** The Type buttons (the toolbar's, the kid dock's): shown while the board can write typed lines. */
export function useTypeButton(): { available: boolean; open: boolean } {
  const available = useValue("type button", () => typeBarState.available.get(), []);
  const open = useValue("type button open", () => typeBarState.shown.get() && !typeBarState.suppressed.get(), []);
  return { available, open };
}

/** The Type buttons' words. */
export const TYPE_BUTTON_COPY = {
  label: "Type",
  hint: "Type your math",
} as const;
