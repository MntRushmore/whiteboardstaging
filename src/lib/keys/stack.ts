/**
 * The stack of problems on a page (docs/KEYS.md): the big problem at the bottom, a smaller one written
 * under its line on top. A solved smaller problem's answer flows back into the parent's cell, and it
 * comes off the stack. Phase 1 goes one level deep; nothing here stops a second.
 */
import { check } from "./check";
import type { MathItem, Values } from "./item";
import type { SubStep } from "./shrink";

export interface Frame {
  item: MathItem;
  values: Values;
  /** how this frame came to be (absent on the big problem) */
  step?: SubStep;
}

export type Stack = readonly Frame[];

export function rootStack(item: MathItem, values: Values = {}): Stack {
  return [{ item, values }];
}

export function top(stack: Stack): Frame {
  return stack[stack.length - 1];
}

export function root(stack: Stack): Frame {
  return stack[0];
}

/** A smaller problem goes on top, with its box empty. */
export function pushStep(stack: Stack, step: SubStep): Stack {
  return [...stack, { item: step.item, values: {}, step }];
}

/** Sets a cell of the frame at `depth` (0 the big problem; default the top). */
export function setValue(stack: Stack, cellId: string, value: string, depth = stack.length - 1): Stack {
  return stack.map((f, i) => (i === depth ? { ...f, values: { ...f.values, [cellId]: value } } : f));
}

export interface CarriedBack {
  stack: Stack;
  /** the parent's cell that took the answer */
  cellId: string;
  place: number;
  value: string;
  /** the smaller problem as solved, for the page to keep showing (`1 + 2 + 6 = 9`) */
  solved: { step: SubStep; values: Values };
}

/**
 * When the top problem is solved: its answer goes into the parent's target cell and it comes off.
 * Null while it is not solved (or there is no smaller problem on top).
 */
export function carryBack(stack: Stack): CarriedBack | null {
  if (stack.length < 2) return null;
  const t = top(stack);
  if (!t.step) return null;
  const result = check(t.item, { values: t.values, answer: "" });
  if (!result.ok) return null;
  const value = result.answer;
  const { cellId, place } = t.step.target;
  const rest = stack.slice(0, -1);
  return {
    stack: setValue(rest, cellId, value, rest.length - 1),
    cellId,
    place,
    value,
    solved: { step: t.step, values: t.values },
  };
}
