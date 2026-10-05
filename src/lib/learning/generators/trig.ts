/**
 * Trig values on the unit circle's special angles, and trig equations whose solutions are special
 * angles, written with their interval as the chat writes them (`2\cos x - 1 = 0, \ 0 \le x < 2\pi`).
 */
import type { FormTable } from "./form";
import type { Rng } from "./rng";
import { deg, frac } from "./tex";

type Fn = "sin" | "cos" | "tan";

/** Special angles in degrees, and the functions defined there. */
const DEGREES: readonly (readonly [angle: number, fns: readonly Fn[]])[] = [
  [0, ["sin", "cos", "tan"]],
  [30, ["sin", "cos", "tan"]],
  [45, ["sin", "cos", "tan"]],
  [60, ["sin", "cos", "tan"]],
  [90, ["sin", "cos"]],
  [120, ["sin", "cos", "tan"]],
  [135, ["sin", "cos", "tan"]],
  [150, ["sin", "cos", "tan"]],
  [180, ["sin", "cos", "tan"]],
  [210, ["sin", "cos"]],
  [240, ["sin", "cos"]],
  [270, ["sin", "cos"]],
  [300, ["sin", "cos"]],
  [315, ["sin", "cos"]],
  [330, ["sin", "cos"]],
];

/** The first quadrant, where a student starts. */
const FIRST = [30, 45, 60] as const;

/** Special angles in radians, as LaTeX. */
const RADIANS: readonly (readonly [latex: string, fns: readonly Fn[]])[] = [
  [frac("\\pi", 6), ["sin", "cos", "tan"]],
  [frac("\\pi", 4), ["sin", "cos", "tan"]],
  [frac("\\pi", 3), ["sin", "cos", "tan"]],
  [frac("\\pi", 2), ["sin", "cos"]],
  [frac("2\\pi", 3), ["sin", "cos", "tan"]],
  [frac("3\\pi", 4), ["sin", "cos", "tan"]],
  [frac("5\\pi", 6), ["sin", "cos", "tan"]],
  ["\\pi", ["sin", "cos", "tan"]],
  [frac("7\\pi", 6), ["sin", "cos"]],
  [frac("4\\pi", 3), ["sin", "cos"]],
  [frac("3\\pi", 2), ["sin", "cos"]],
  [frac("5\\pi", 3), ["sin", "cos"]],
  [frac("11\\pi", 6), ["sin", "cos"]],
];

/** Angles whose sine or cosine is 0, ±1/2 or ±1 (sums of these stay whole or halves). */
const SIMPLE: readonly (readonly [Fn, number])[] = [
  ["sin", 0],
  ["sin", 30],
  ["sin", 90],
  ["cos", 0],
  ["cos", 60],
  ["cos", 90],
  ["cos", 180],
  ["tan", 45],
];

/** The intervals a trig equation is solved on, as the chat writes them. */
const RAD_INTERVAL = ", \\ 0 \\le x < 2\\pi";
const DEG_INTERVAL = ", \\ 0^{\\circ} \\le x < 360^{\\circ}";

/**
 * `a·fn x = b` with a special value: the coefficient and the right side as LaTeX. `\sin x = \frac{1}{2}`
 * written as `2\sin x = 1`, `\cos x = -\frac{\sqrt{3}}{2}` as `2\cos x = -\sqrt{3}`.
 */
const SIN_COS_VALUES: readonly (readonly [a: number, b: string])[] = [
  [2, "1"],
  [2, "-1"],
  [2, "\\sqrt{3}"],
  [2, "-\\sqrt{3}"],
  [2, "\\sqrt{2}"],
  [2, "-\\sqrt{2}"],
];
const TAN_VALUES = ["1", "-1", "\\sqrt{3}", "-\\sqrt{3}"] as const;

function interval(r: Rng): string {
  return r.chance(0.5) ? RAD_INTERVAL : DEG_INTERVAL;
}

function sinCos(r: Rng): "sin" | "cos" {
  return r.chance(0.5) ? "sin" : "cos";
}

export const TRIG: FormTable = {
  trig_values: [
    (r) => [`\\${r.pick(["sin", "cos", "tan"] as const)} ${deg(r.pick(FIRST))}`],
    (r) => {
      const [a, fns] = r.pick(DEGREES);
      return [`\\${r.pick(fns)} ${deg(a)}`];
    },
    (r) => {
      const [a, fns] = r.pick(RADIANS);
      return [`\\${r.pick(fns)} ${a}`];
    },
    (r) => {
      const [fn, a] = r.pick([
        ["sin", 30],
        ["cos", 60],
        ["tan", 45],
        ["sin", 90],
        ["cos", 0],
      ] as const);
      return [`${r.int(2, 8)}\\${fn} ${deg(a)}`];
    },
    (r) => {
      const [f1, a1] = r.pick(SIMPLE);
      const [f2, a2] = r.pick(SIMPLE);
      return f1 === f2 && a1 === a2 ? null : [`\\${f1} ${deg(a1)} + \\${f2} ${deg(a2)}`];
    },
  ],

  trig_equations: [
    (r) => {
      const [a, b] = r.pick(SIN_COS_VALUES);
      return [`${a}\\${sinCos(r)} x = ${b}${interval(r)}`];
    },
    (r) => {
      const [a, b] = r.pick(SIN_COS_VALUES);
      const minus = b.startsWith("-") ? `+ ${b.slice(1)}` : `- ${b}`;
      return [`${a}\\${sinCos(r)} x ${minus} = 0${interval(r)}`];
    },
    (r) => [`\\tan x = ${r.pick(TAN_VALUES)}${interval(r)}`],
    (r) => {
      const v = r.pick([frac(1, 2), `-${frac(1, 2)}`, frac("\\sqrt{3}", 2), `-${frac("\\sqrt{3}", 2)}`, frac("\\sqrt{2}", 2)]);
      return [`\\${sinCos(r)} x = ${v}${interval(r)}`];
    },
    (r) => [`2\\${sinCos(r)} x = ${r.pick(["1", "-1"])}`],
    (r) => {
      const k = r.int(2, 4);
      return [`${2 * k}\\${sinCos(r)} x = ${k}${interval(r)}`];
    },
    (r) => [`\\${sinCos(r)} x = ${r.pick(["0", "1", "-1"])}${interval(r)}`],
  ],
};
