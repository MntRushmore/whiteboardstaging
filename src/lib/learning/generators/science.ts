/**
 * Unit conversions in metric units the engine converts and the hand writes (`5 \mathrm{km} \to
 * \mathrm{m}`). Unit names of three letters or more read as words on the board, so they are left out.
 */
import type { FormTable } from "./form";
import { dec } from "./tex";

/** [from, to, how many `to` in one `from`] */
const METRIC: readonly (readonly [string, string, number])[] = [
  ["km", "m", 1000],
  ["kg", "g", 1000],
  ["m", "cm", 100],
  ["cm", "mm", 10],
  ["L", "mL", 1000],
];

const unit = (u: string) => `\\mathrm{${u}}`;

export const SCIENCE: FormTable = {
  units: [
    (r) => {
      const [from, to] = r.pick(METRIC);
      return [`${r.int(2, 9)} ${unit(from)} \\to ${unit(to)}`];
    },
    (r) => {
      const [from, to] = r.pick(METRIC);
      return [`${dec(r.int(1, 9) * 10 + 5, 1)} ${unit(from)} \\to ${unit(to)}`];
    },
    (r) => {
      const [from, to, f] = r.pick(METRIC);
      return [`${f * r.int(2, 9)} ${unit(to)} \\to ${unit(from)}`];
    },
    (r) => [`${18 * r.int(1, 5)} \\mathrm{km/h} \\to \\mathrm{m/s}`],
  ],
};
