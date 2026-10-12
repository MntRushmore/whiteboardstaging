/**
 * Type it (docs/TYPE-MATH.md): what the board's first load shares with the bar, which is a lazy
 * chunk (`src/components/typeMath/TypeBar.tsx`). No parser, no React: an event name, a dispatcher
 * and one atom, so the shapes and the Live loop can talk to the bar without loading it.
 */

import { atom } from "tldraw";

/**
 * A readback's editor (`MathShapeUtil`) asks the bar to open a line in its box: plain typing, never
 * raw LaTeX. `detail` is `TypedEditDetail`. The listener calls `preventDefault()` to say it took it.
 */
export const TYPE_EDIT_EVENT = "typemath:edit";

export interface TypedEditDetail {
  lineId: string;
}

/**
 * Asks the bar to load this line into its box (edit mode). True when a bar took it; false when
 * there is none on this board (no writer, Live off), so the caller keeps its own editor.
 */
export function requestTypedEdit(lineId: string): boolean {
  if (typeof window === "undefined" || !lineId) return false;
  const event = new CustomEvent<TypedEditDetail>(TYPE_EDIT_EVENT, { detail: { lineId }, cancelable: true });
  return !window.dispatchEvent(event);
}

/** Takes the bar's edit requests; returns the cleanup. */
export function listenForTypedEdits(onEdit: (lineId: string) => void): () => void {
  const listener = (e: Event) => {
    const lineId = (e as CustomEvent<Partial<TypedEditDetail>>).detail?.lineId;
    if (typeof lineId !== "string" || !lineId) return;
    e.preventDefault();
    onEdit(lineId);
  };
  window.addEventListener(TYPE_EDIT_EVENT, listener);
  typedEditTarget.set(true);
  return () => {
    window.removeEventListener(TYPE_EDIT_EVENT, listener);
    typedEditTarget.set(false);
  };
}

/** A bar listens for edits on this board: a readback's double-click goes to it, not the LaTeX editor. */
export const typedEditTarget = atom<boolean>("typeMath.editTarget", false);

/**
 * How much of the board's foot the open bar covers: px from the bottom of the board (the tldraw
 * container) up to the bar's top edge, 0 while it is closed. The hint cards and "Now you try" stay
 * above it; the writer keeps a new line above it when it moves the camera. The bar also sets it on
 * the container as the CSS variable `--type-bar-inset`.
 */
export const typeBarInset = atom<number>("typeMath.barInset", 0);
