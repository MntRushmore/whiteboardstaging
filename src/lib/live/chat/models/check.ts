// The check only (no drawing code): the route's gate runs it on the server (`chatGate.ts`).
import type { VisualModel } from "../contracts";
import { autoStep, decimalsOf, equationHolds, intervalsOf, labelNumber, MAX_TICKS, placeParts, same, say } from "./maths";

/**
 * What doesn't make sense in a visual model's spec, as sentences a model can act on ([] when it
 * will be drawn true to what it says): more shaded parts than parts, a mark or a jump off its line,
 * a range with too many ticks to read, a label that says other than the picture shows (a jump from
 * 3 to 7 labelled +5, a bar with 3 of 8 shaded labelled 3/4), an equation in a label that is wrong,
 * a tape whose total contradicts its segments or whose lengths are not in proportion to its numbers.
 * The board does every sum in a model itself, so a picture never shows wrong maths; this only
 * refuses specs that ask it to. Never throws. At most eight.
 */
export function modelProblems(model: VisualModel): string[] {
  try {
    return check(model).slice(0, 8);
  } catch (err) {
    return [err instanceof Error ? err.message.slice(0, 160) : "the model could not be checked"];
  }
}

/** The number a model's area model splits into at most this many parts (rows × columns). */
export const AREA_MAX_PARTS = 9;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Labels that are equations must be true: "3 × 4 = 12", never "3 × 4 = 13". */
function equationProblem(where: string, label: string | undefined): string | null {
  if (!label) return null;
  const eq = equationHolds(label);
  return eq && !eq.holds ? `${where} label "${label}" is wrong: ${label.split("=")[0].trim()} is ${say(eq.left)}` : null;
}

function check(model: VisualModel): string[] {
  const out: string[] = [];
  const eq = (where: string, label: string | undefined) => {
    const p = equationProblem(where, label);
    if (p) out.push(p);
  };
  switch (model.kind) {
    case "number_line": {
      const { from, to } = model;
      if (!(to > from)) {
        out.push(`the line must run from a smaller number to a bigger one (it goes from ${say(from)} to ${say(to)})`);
        break;
      }
      const step = model.step ?? autoStep(from, to);
      const { n, whole } = intervalsOf(from, to, step);
      if (n + 1 > MAX_TICKS) {
        const better = autoStep(from, to);
        out.push(`from ${say(from)} to ${say(to)} in steps of ${say(step)} is ${n + 1} ticks, too many to read (at most ${MAX_TICKS}); use a step of ${say(better)}, or a shorter line`);
      } else if (!whole) out.push(`from ${say(from)} to ${say(to)} is not a whole number of steps of ${say(step)}: make the ends land on ticks`);
      const on = (v: number) => v >= from - 1e-9 && v <= to + 1e-9;
      for (const m of model.marks) {
        if (!on(m.at)) out.push(`the mark at ${say(m.at)} is off the line (it runs from ${say(from)} to ${say(to)})`);
        const v = m.label ? labelNumber(m.label) : null;
        if (v && !same(v.value, m.at)) out.push(`the mark at ${say(m.at)} is labelled "${m.label}", which is a different number`);
        eq("a mark's", m.label);
      }
      for (const j of model.jumps) {
        if (!on(j.from) || !on(j.to)) out.push(`the jump from ${say(j.from)} to ${say(j.to)} runs off the line (it runs from ${say(from)} to ${say(to)})`);
        if (same(j.from, j.to)) out.push(`the jump from ${say(j.from)} to ${say(j.to)} goes nowhere`);
        const v = j.label ? labelNumber(j.label) : null;
        const d = j.to - j.from;
        if (v && !(v.signed ? same(v.value, d) : same(v.value, Math.abs(d)))) {
          out.push(`the jump from ${say(j.from)} to ${say(j.to)} is ${d > 0 ? "+" : ""}${say(d)}, but its label says ${j.label}`);
        }
        eq("a jump's", j.label);
      }
      break;
    }
    case "fraction_bars":
    case "fraction_circles": {
      const items = model.kind === "fraction_bars" ? model.bars : model.circles;
      const what = model.kind === "fraction_bars" ? "bar" : "circle";
      items.forEach((it, i) => {
        if (it.shaded > it.parts) out.push(`${what} ${i + 1} has ${it.shaded} of ${it.parts} ${plural(it.parts, "part")} shaded: shaded must be at most parts`);
        const v = it.label ? labelNumber(it.label) : null;
        if (v && it.shaded <= it.parts && !same(v.value, it.shaded / it.parts)) {
          out.push(`${what} ${i + 1} shows ${it.shaded}/${it.parts} but its label says ${it.label}`);
        }
        eq(`${what} ${i + 1}'s`, it.label);
      });
      break;
    }
    case "array": {
      const dims = model.label ? /^\s*(\d+)\s*(?:×|x|\*|\\times|·)\s*(\d+)/.exec(model.label) : null;
      if (dims) {
        const [a, b] = [Number(dims[1]), Number(dims[2])];
        if (!((a === model.rows && b === model.cols) || (a === model.cols && b === model.rows))) {
          out.push(`the array is ${model.rows} rows of ${model.cols}, but its label says ${a} × ${b}`);
        }
      }
      eq("the array's", model.label);
      break;
    }
    case "equal_groups": {
      const words = model.label ? /(\d+)\s+groups?\s+of\s+(\d+)/i.exec(model.label) : null;
      if (words && (Number(words[1]) !== model.groups || Number(words[2]) !== model.each)) {
        out.push(`there are ${model.groups} ${plural(model.groups, "group")} of ${model.each}, but the label says ${words[1]} groups of ${words[2]}`);
      }
      const dims = model.label ? /^\s*(\d+)\s*(?:×|x|\*|\\times|·)\s*(\d+)/.exec(model.label) : null;
      if (dims) {
        const [a, b] = [Number(dims[1]), Number(dims[2])];
        if (!((a === model.groups && b === model.each) || (a === model.each && b === model.groups))) {
          out.push(`there are ${model.groups} ${plural(model.groups, "group")} of ${model.each}, but the label says ${a} × ${b}`);
        }
      }
      eq("the groups'", model.label);
      break;
    }
    case "area_model": {
      const parts = placeParts(model.a).length * placeParts(model.b).length;
      if (parts > AREA_MAX_PARTS) {
        out.push(`${say(model.a)} × ${say(model.b)} splits into ${parts} parts, too many to draw clearly (at most ${AREA_MAX_PARTS}): use smaller numbers`);
      }
      break;
    }
    case "base_ten":
      if (model.value < 1) out.push("0 has no blocks to draw: give a number from 1 to 999");
      break;
    case "place_value":
      if (decimalsOf(model.value) > 3) out.push(`${say(model.value)} has more than 3 decimal places: round it to thousandths`);
      break;
    case "tape": {
      const segments = model.rows.flatMap((r) => r.segments);
      const values = segments.map((s) => (s.label ? labelNumber(s.label) : null));
      const known = values.every((v) => v !== null);
      model.rows.forEach((r, i) => r.segments.forEach((s, j) => eq(`row ${i + 1} segment ${j + 1}'s`, s.label)));
      // to scale: every segment that says its number is as long as its number says
      if (known && segments.length > 1) {
        const ratio = values[0]!.value / segments[0].units;
        const off = segments.findIndex((s, k) => !same(values[k]!.value / s.units, ratio));
        if (off > 0) {
          out.push(`the segments are not to scale: "${segments[0].label}" is ${say(segments[0].units)} ${plural(segments[0].units, "unit")} long but "${segments[off].label}" is ${say(segments[off].units)}; make each segment's units match its number`);
        }
      }
      const total = model.total ? labelNumber(model.total) : null;
      if (total) {
        const sum = values.reduce((a, v) => a + (v?.value ?? 0), 0);
        const parts = values.filter((v) => v !== null).map((v) => say(v!.value));
        if (known && !same(sum, total.value)) out.push(`the total says ${model.total}, but the segments add up to ${say(sum)} (${parts.join(" + ")})`);
        else if (!known && sum > total.value + 1e-9) out.push(`the segments' numbers (${parts.join(" + ")}) already add up to more than the total ${model.total}`);
      }
      eq("the total's", model.total);
      break;
    }
    case "ten_frame":
    case "clock":
      break;
  }
  return out;
}
