/**
 * One-step equations (docs/KEYS.md, Phase 3): `x + 7 = 15`, `x − 4 = 9`, `5 + x = 12`, `3x = 12`. No
 * cells: the kid works on typed lines (`x = 15 − 7`) and writes the answer (`x = 8`, or `8`). A typed
 * step is right when it is true for the answer (`x + 7 − 7 = 15 − 7`).
 */
import type { Rng } from "@/lib/learning/generators/rng";
import type { EquationForm, MathItem } from "../item";

export function equationText(form: EquationForm, a: number, b: number, letter = "x"): string {
  switch (form) {
    case "x+a":
      return `${letter} + ${a} = ${b}`;
    case "x-a":
      return `${letter} − ${a} = ${b}`;
    case "a+x":
      return `${a} + ${letter} = ${b}`;
    case "ax":
      return `${a}${letter} = ${b}`;
  }
}

export function solve(form: EquationForm, a: number, b: number): number {
  switch (form) {
    case "x+a":
    case "a+x":
      return b - a;
    case "x-a":
      return b + a;
    case "ax":
      return b / a;
  }
}

export function equationItem(form: EquationForm, a: number, b: number, letter = "x"): MathItem {
  const x = solve(form, a, b);
  if (!Number.isInteger(x)) throw new Error("equationItem: the answer must be whole");
  const text = equationText(form, a, b, letter);
  const op = form === "x-a" ? "minus" : form === "ax" ? "times" : "plus";
  const words = form === "ax" ? `${a} times ${letter} equals ${b}` : form === "a+x" ? `${a} plus ${letter} equals ${b}` : `${letter} ${op} ${a} equals ${b}`;
  return {
    id: `eq:${text.replace(/\s+/g, "")}`,
    skill: "one_step_equations",
    kind: "equation",
    text,
    words: `${words}. Find ${letter}.`,
    addends: [],
    total: x,
    answer: String(x),
    math: { kind: "equation", form, a, b, letter, x },
    layout: { kind: "lines" },
  };
}

export const EQUATION_FORMS: readonly EquationForm[] = ["x+a", "x-a", "a+x", "ax"];

/** A one-step equation with a whole answer from 2 to 20. */
export function equationOf(r: Rng, form: EquationForm): MathItem {
  for (let i = 0; i < 100; i++) {
    const x = r.int(2, 20);
    const a = form === "ax" ? r.int(2, 9) : r.int(2, 15);
    const b = form === "x-a" ? x - a : form === "ax" ? a * x : x + a;
    if (b <= 0 || b === a || (form !== "ax" && 2 * a === b)) continue;
    return equationItem(form, a, b);
  }
  return equationItem(form, 7, form === "x-a" ? 8 : form === "ax" ? 14 : 15);
}
