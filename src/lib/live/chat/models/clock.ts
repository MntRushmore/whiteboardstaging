import type { Pt } from "../../graphing/pen";
import type { VisualModel } from "../contracts";
import { handCircle, ModelInk, type ModelSketch } from "./kit";

/**
 * A clock face as a teacher draws one: the circle, the twelve hour marks and the sixty minute
 * marks round its edge (the hour marks longer and heavier), the numbers 1 to 12 inside them, then
 * the hands — the hour hand short and thick, the minute hand long — each with a small arrowhead,
 * and a dot at the centre. The hands are where a real clock's are: at 3:45 the hour hand is three
 * quarters of the way from 3 to 4, never on the 3.
 */

type Clock = Extract<VisualModel, { kind: "clock" }>;

export const CLOCK = {
  maxR: 165,
  minR: 76,
  /** the hour marks and the minute marks, measured in from the rim */
  hourTick: 14,
  minuteTick: 7,
  /** the numbers' hand size as a fraction of the radius, within min–max */
  number: { frac: 0.24, min: 24, max: 40 },
  /** the hands' lengths: the hour hand as a fraction of the numbers' ring, the minute hand just short of the numbers */
  hourHand: 0.6,
  /** the hands' pens */
  weight: { hour: 1.9, minute: 1.3, tick: 1, minuteTick: 0.45 },
} as const;

const HOUR_INK = "orange" as const;
const MINUTE_INK = "violet" as const;

/** The hands' angles (radians from 12 o'clock, clockwise): the hour hand moves on with the minutes. */
export function handAngles(hour: number, minute: number): { hour: number; minute: number } {
  return { hour: (((hour % 12) + minute / 60) / 12) * Math.PI * 2, minute: (minute / 60) * Math.PI * 2 };
}

export function planClock(spec: Clock, box: { w: number; h: number }, seed: number): ModelSketch | null {
  const K = CLOCK;
  const r = Math.min(K.maxR, (box.w - 10) / 2, (box.h - 10) / 2);
  if (r < K.minR) return null;
  const c = { x: r, y: r };
  const at = (a: number, d: number): Pt => ({ x: c.x + d * Math.sin(a), y: c.y - d * Math.cos(a) });
  const size = Math.round(Math.min(K.number.max, Math.max(K.number.min, r * K.number.frac)));
  const ring = r - K.hourTick - 8 - size * 0.42;
  const ink = new ModelInk(seed);
  ink.draw("face", (pen) => handCircle(pen, c, r));
  ink.draw("hours", (pen) => Array.from({ length: 12 }, (_, i) => pen.line(at((i / 12) * Math.PI * 2, r - K.hourTick), at((i / 12) * Math.PI * 2, r - 2))).flat(), undefined, K.weight.tick);
  ink.draw(
    "minutes",
    (pen) =>
      Array.from({ length: 60 }, (_, i) => i)
        .filter((i) => i % 5 !== 0)
        .flatMap((i) => pen.line(at((i / 60) * Math.PI * 2, r - K.minuteTick), at((i / 60) * Math.PI * 2, r - 2))),
    undefined,
    K.weight.minuteTick,
  );
  for (let n = 1; n <= 12; n++) {
    if (!ink.label(`number:${n}`, String(n), at((n / 12) * Math.PI * 2, ring), "center", "middle", size)) return null;
  }
  const { hour, minute } = handAngles(spec.hour, spec.minute);
  const hourLen = ring * K.hourHand;
  const minuteLen = ring - size * 0.5;
  ink.draw("hand:hour", (pen) => [...pen.line(c, at(hour, hourLen)), ...pen.arrowhead(at(hour, hourLen), Math.sin(hour), -Math.cos(hour), 15)], { color: HOUR_INK }, K.weight.hour);
  ink.draw("hand:minute", (pen) => [...pen.line(c, at(minute, minuteLen)), ...pen.arrowhead(at(minute, minuteLen), Math.sin(minute), -Math.cos(minute), 13)], { color: MINUTE_INK }, K.weight.minute);
  ink.draw("centre", (pen) => pen.disc(c, 5.5));
  return ink.finish(box);
}
