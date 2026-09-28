import type { DiagramSpec } from "../contracts";
import type { LectureSketch } from "../chart/sketch";
import { WORDS, measureWords, type WordsLayout } from "../words";
import { DIAGRAM, drawDiagram, roomUnder, sizesAt, type Item } from "./layout";

/**
 * A timeline as a teacher draws one: a line across with an arrowhead at the end, a tick for each
 * event in order (evenly spaced — the dates are words, not a scale), the date over its tick and
 * what happened under it. When the events are too many for that, they alternate: one above the
 * line, the next below, each with twice the width; when even that is too tight, the line runs down
 * the page with the dates on its left and the events on its right. The dates are in the accent
 * colour, the events in the tutor's.
 *
 * LIVE. The line is divided into fixed slots (at least six), so an event said
 * later takes the next slot and nothing drawn moves — unless it is so much taller than the others
 * that the line must drop, or it turns the layout from across to alternating. Parts: "line",
 * "tick:<i>", "when:<i>", "what:<i>".
 */

export type TimelineDiagram = Extract<DiagramSpec, { kind: "timeline" }>;

export const TIMELINE = {
  tick: 7,
  /** the line to the writing either side of it */
  gap: 7,
  /** a date to its event, when stacked (more than the writing's clearance, `DIAGRAM.textPad`) */
  stack: 7,
  /** between neighbours on one side */
  sideGap: 12,
  /** the line runs this far past the first and last events */
  overhang: 18,
  /** a vertical timeline's rows are at least this far apart */
  rowGap: 10,
  /** the line is divided into at least this many slots */
  slots: 6,
  /** the dates' ink */
  accent: "orange",
} as const;

type Mode = "across" | "alternate" | "down";

function measureAll(texts: readonly string[], size: number, maxW: number, maxLines: number): WordsLayout[] | null {
  const out: WordsLayout[] = [];
  for (const t of texts) {
    const m = measureWords(t, size, { maxWidth: maxW, maxLines, balance: true });
    if (!m) return null;
    out.push(m);
  }
  return out;
}

export function layoutTimeline(spec: TimelineDiagram, mode: Mode, k: number, room: { w: number; h: number }): Item[] | null {
  const T = TIMELINE;
  const n = spec.events.length;
  const { node: size, small } = sizesAt(k);
  const items: Item[] = [];

  if (mode === "down") {
    const whens = measureAll(
      spec.events.map((e) => e.when),
      size,
      room.w * 0.3,
      2,
    );
    if (!whens) return null;
    const lineX = Math.max(...whens.map((w) => w.w)) + T.gap + T.tick;
    const whats = measureAll(
      spec.events.map((e) => e.what),
      small,
      room.w - lineX - T.tick - T.gap,
      3,
    );
    if (!whats) return null;
    const rowH = spec.events.map((_, i) => Math.max(whens[i].h, whats[i].h));
    const total = rowH.reduce((a, b) => a + b, 0) + (n - 1) * T.rowGap + 2 * T.overhang;
    if (total > room.h) return null;
    const ys: number[] = [];
    let y = T.overhang;
    for (const h of rowH) {
      ys.push(y + h / 2);
      y += h + T.rowGap;
    }
    items.push({ t: "arrow", pts: [{ x: lineX, y: 0 }, { x: lineX, y: total }], part: "line" });
    spec.events.forEach((_, i) => {
      items.push({ t: "line", pts: [{ x: lineX - T.tick, y: ys[i] }, { x: lineX + T.tick, y: ys[i] }], part: `tick:${i}` });
      items.push({ t: "text", layout: whens[i], at: { x: lineX - T.tick - T.gap, y: ys[i] }, align: "right", valign: "middle", part: `when:${i}`, style: { color: TIMELINE.accent } });
      items.push({ t: "text", layout: whats[i], at: { x: lineX + T.tick + T.gap, y: ys[i] }, align: "left", valign: "middle", part: `what:${i}` });
    });
    return items;
  }

  // fixed slots, so an event said later takes the next one and nothing drawn moves
  const slot = (room.w - 2 * T.overhang) / Math.max(n, T.slots);
  const each = mode === "across" ? slot - T.sideGap : 2 * slot - T.sideGap;
  const whens = measureAll(
    spec.events.map((e) => e.when),
    size,
    mode === "across" ? each : Math.min(each, slot * 1.6),
    2,
  );
  if (!whens) return null;
  const whats = measureAll(
    spec.events.map((e) => e.what),
    small,
    each,
    3,
  );
  if (!whats) return null;
  const xs = spec.events.map((_, i) => T.overhang + slot * (i + 0.5));
  const off = T.tick + T.gap;
  // how far the writing reaches above and below the line
  let up = 0;
  let down = 0;
  spec.events.forEach((_, i) => {
    if (mode === "across") {
      up = Math.max(up, whens[i].h);
      down = Math.max(down, whats[i].h);
    } else if (i % 2 === 0) up = Math.max(up, whens[i].h + T.stack + whats[i].h);
    else down = Math.max(down, whens[i].h + T.stack + whats[i].h);
  });
  // the line's height in whole lines of writing: a new event a little taller does not move it
  const q = (small / 14) * WORDS.lineStep;
  const lineY = off + Math.ceil(up / q - 1e-9) * q;
  if (lineY + off + down > room.h) return null;
  items.push({ t: "arrow", pts: [{ x: 0, y: lineY }, { x: room.w, y: lineY }], part: "line" });
  const date = { color: TIMELINE.accent };
  spec.events.forEach((_, i) => {
    const x = xs[i];
    items.push({ t: "line", pts: [{ x, y: lineY - T.tick }, { x, y: lineY + T.tick }], part: `tick:${i}` });
    const above = mode === "across" || i % 2 === 0;
    if (mode === "across") {
      items.push({ t: "text", layout: whens[i], at: { x, y: lineY - off }, align: "center", valign: "bottom", part: `when:${i}`, style: date });
      items.push({ t: "text", layout: whats[i], at: { x, y: lineY + off }, align: "center", valign: "top", part: `what:${i}` });
    } else if (above) {
      items.push({ t: "text", layout: whens[i], at: { x, y: lineY - off }, align: "center", valign: "bottom", part: `when:${i}`, style: date });
      items.push({ t: "text", layout: whats[i], at: { x, y: lineY - off - whens[i].h - T.stack }, align: "center", valign: "bottom", part: `what:${i}` });
    } else {
      items.push({ t: "text", layout: whens[i], at: { x, y: lineY + off }, align: "center", valign: "top", part: `when:${i}`, style: date });
      items.push({ t: "text", layout: whats[i], at: { x, y: lineY + off + whens[i].h + T.stack }, align: "center", valign: "top", part: `what:${i}` });
    }
  });
  return items;
}

export function sketchTimeline(spec: TimelineDiagram, box: { w: number; h: number }, seed: number): LectureSketch | null {
  if (spec.events.length < 1) return null;
  for (const levels of [DIAGRAM.levels.slice(0, 3), DIAGRAM.levels.slice(3)]) {
    for (const mode of ["across", "alternate", "down"] as const) {
      for (const k of levels) {
        const room = roomUnder(spec.title, box, k);
        if (!room) continue;
        const items = layoutTimeline(spec, mode, k, room);
        const out = items ? drawDiagram(items, spec.title, box, k, seed, sizesAt(k).node) : null;
        if (out) return out;
      }
    }
  }
  return null;
}
