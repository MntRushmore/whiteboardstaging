import { planHandwriting } from "../handwriting";
import { FigureSpecSchema, type FigureSpec } from "./contracts";
import { degreesOf, fmt, lengthOf, nameLatex, wordIn } from "./labels";
import { RESOLVE, dist, resolveFigure, type FigAngle, type FigSegment, type Figure } from "./resolve";

/**
 * What is wrong with a figure spec, as sentences a model can act on — or [] when the drawing will
 * be true to what it says. Pure and fast (no drawing): the resolver's problems (a name used but not
 * defined, a zero-length side, a degenerate angle, a circle with no radius), then the marks and
 * labels that would lie about the drawing (a right-angle mark on 72°, sides labelled 3 and 4 drawn
 * 1 : 2, an angle labelled 70° drawn 52°, equal ticks on unequal sides), labels the hand cannot
 * write or that are words, and a figure too crowded to read.
 */

export const CHECK = {
  /** a right-angle mark is on an angle within this of 90° */
  rightDeg: 3,
  /** numeric side labels agree with the drawing to this fraction */
  lengthTol: 0.1,
  /** a degree label agrees with the drawn angle to this */
  angleDeg: 5,
  /** parallel arrows: directions within this */
  parallelDeg: 3,
  /** at most this many points, drawn elements (sides, lines, circles, angle marks) and labels */
  maxPoints: 20,
  maxElements: 48,
  maxLabels: 28,
  /** the hand size labels are checked at */
  size: 30,
} as const;

export function checkFigure(spec: FigureSpec): string[] {
  if (!spec || typeof spec !== "object" || typeof spec.points !== "object" || spec.points === null) {
    return ["The figure needs points: an object from each point's name to its x and y, e.g. { \"A\": { \"x\": 0, \"y\": 0 } }."];
  }
  const out: string[] = [];
  const parsed = FigureSpecSchema.safeParse(spec);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 6)) {
      const path = issue.path.map(String).join(".");
      out.push(`The spec does not fit the figure schema at ${path || "the top level"}: ${issue.message}.`);
    }
  }
  let resolved: ReturnType<typeof resolveFigure>;
  try {
    resolved = resolveFigure(spec);
  } catch {
    return out.length ? out : ["The figure spec could not be read; check that it matches the schema."];
  }
  const { fig, problems } = resolved;
  out.push(...problems);
  if (fig.points.length === 0) out.push("The figure has no points; define at least the points its sides, lines and circles use.");

  out.push(...coincident(fig));
  out.push(...rightMarks(fig.angles));
  out.push(...sideLengths(fig.segments));
  out.push(...angleLabels(fig.angles));
  out.push(...equalTicks(fig.segments));
  out.push(...equalArcs(fig.angles));
  out.push(...parallelArrows(fig));
  out.push(...labelText(fig));
  out.push(...crowding(fig));
  return out;
}

/** Two named points at one place: their names would be written on top of each other. */
function coincident(fig: Figure): string[] {
  const out: string[] = [];
  const pts = fig.points;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (dist(pts[i].p, pts[j].p) > fig.size * RESOLVE.same) continue;
      out.push(`Points ${pts[i].name} and ${pts[j].name} are at the same place (${fmt(pts[i].p.x)}, ${fmt(pts[i].p.y)}); give each point its own position, or use one name.`);
    }
  }
  return out;
}

function rightMarks(angles: readonly FigAngle[]): string[] {
  return angles
    .filter((g) => g.right && Math.abs(g.deg - 90) > CHECK.rightDeg)
    .map((g) => `Angle ${g.name} is marked as a right angle but is drawn ${fmt(g.deg)}°; move the points so it is 90° (within ${CHECK.rightDeg}°), or drop right.`);
}

/** The member of a group whose value is closest to the group's median: the others are compared to it. */
function reference<T>(items: readonly T[], value: (t: T) => number): T {
  const sorted = [...items].sort((a, b) => value(a) - value(b));
  const median = value(sorted[Math.floor((sorted.length - 1) / 2)]);
  return items.reduce((best, t) => (Math.abs(value(t) - median) < Math.abs(value(best) - median) ? t : best), items[0]);
}

/** Numeric side labels against the drawn lengths: every side compared with the most typical one. */
function sideLengths(segments: readonly FigSegment[]): string[] {
  const sides = segments.map((s) => ({ s, L: lengthOf(s.label), d: dist(s.a, s.b) })).filter((x): x is { s: FigSegment; L: number; d: number } => x.L !== null);
  if (sides.length < 2) return [];
  const ref = reference(sides, (x) => x.d / x.L);
  const out: string[] = [];
  for (const x of sides) {
    if (x === ref) continue;
    const expected = x.L / ref.L;
    const actual = x.d / ref.d;
    if (Math.abs(actual / expected - 1) <= CHECK.lengthTol) continue;
    out.push(
      `${ref.s.name} is labelled ${ref.s.label} and ${x.s.name} ${x.s.label}, but ${x.s.name} is drawn ${fmt(actual)} times ${ref.s.name} (it should be ${fmt(expected)} times); move the points so the lengths match the labels.`,
    );
  }
  return out;
}

function angleLabels(angles: readonly FigAngle[]): string[] {
  const out: string[] = [];
  for (const g of angles) {
    const want = degreesOf(g.label);
    if (want === null) continue;
    if (want >= 180) {
      out.push(`Angle ${g.name} is labelled ${fmt(want)}°, but an angle mark shows the smaller angle (${fmt(g.deg)}° here); label that one instead.`);
      continue;
    }
    if (Math.abs(want - g.deg) > CHECK.angleDeg) {
      out.push(`Angle ${g.name} is labelled ${fmt(want)}° but is drawn ${fmt(g.deg)}°; move the points so it measures ${fmt(want)}° (within ${CHECK.angleDeg}°).`);
    }
  }
  return out;
}

/** Sides with the same number of ticks are marked equal: they must be drawn equal. */
function equalTicks(segments: readonly FigSegment[]): string[] {
  const out: string[] = [];
  for (const n of [1, 2, 3]) {
    const group = segments.filter((s) => s.ticks === n);
    if (group.length < 2) continue;
    const ref = reference(group, (s) => dist(s.a, s.b));
    for (const s of group) {
      if (s === ref) continue;
      const r = dist(s.a, s.b) / dist(ref.a, ref.b);
      if (Math.abs(r - 1) <= CHECK.lengthTol) continue;
      out.push(
        `${ref.name} and ${s.name} are marked equal (${n} tick${n > 1 ? "s" : ""} each), but ${s.name} is drawn ${fmt(r)} times ${ref.name}; move the points so they are the same length, or change the ticks.`,
      );
    }
  }
  return out;
}

/**
 * Angles with the same number of arcs are marked equal — two or three arcs always; one arc only
 * when it was given on purpose to unlabelled angles (a lone arc is also just "this angle").
 */
function equalArcs(angles: readonly FigAngle[]): string[] {
  const out: string[] = [];
  for (const n of [1, 2, 3]) {
    const group = angles.filter((g) => g.arcs === n && !g.right && (n > 1 || !g.label));
    if (group.length < 2) continue;
    const ref = reference(group, (g) => g.deg);
    for (const g of group) {
      if (g === ref || Math.abs(g.deg - ref.deg) <= CHECK.angleDeg) continue;
      out.push(
        `Angles ${ref.name} and ${g.name} are marked equal (${n} arc${n > 1 ? "s" : ""} each), but are drawn ${fmt(ref.deg)}° and ${fmt(g.deg)}°; move the points so they match, or change the arcs.`,
      );
    }
  }
  return out;
}

/** Sides and lines with the same number of arrows are marked parallel. */
function parallelArrows(fig: Figure): string[] {
  const out: string[] = [];
  const dirDeg = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const d = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    return ((d % 180) + 180) % 180;
  };
  const items = [
    ...fig.segments.filter((s) => s.arrows).map((s) => ({ name: s.name, n: s.arrows!, deg: dirDeg(s.a, s.b) })),
    ...fig.lines.filter((l) => l.arrows).map((l) => ({ name: l.name, n: l.arrows!, deg: dirDeg(l.a, l.b) })),
  ];
  for (const n of [1, 2, 3]) {
    const group = items.filter((x) => x.n === n);
    if (group.length < 2) continue;
    const ref = group[0];
    for (const x of group.slice(1)) {
      const diff = Math.abs(x.deg - ref.deg);
      const apart = Math.min(diff, 180 - diff);
      if (apart <= CHECK.parallelDeg) continue;
      out.push(
        `${ref.name} and ${x.name} are marked parallel (${n} arrow${n > 1 ? "s" : ""} each), but are drawn ${fmt(apart)}° apart; move the points so they are parallel, or change the arrows.`,
      );
    }
  }
  return out;
}

/** Every label and name must be maths the hand can write — and not a word. */
function labelText(fig: Figure): string[] {
  const out: string[] = [];
  const texts: Array<{ latex: string; where: string; name?: boolean }> = [
    ...fig.points.filter((p) => p.label).map((p) => ({ latex: nameLatex(p.name), where: `point ${p.name}`, name: true })),
    ...fig.segments.filter((s) => s.label).map((s) => ({ latex: s.label!, where: `segment ${s.name}` })),
    ...fig.lines.filter((l) => l.label).map((l) => ({ latex: l.label!, where: l.name })),
    ...fig.angles.filter((g) => g.label).map((g) => ({ latex: g.label!, where: `angle ${g.name}` })),
  ];
  for (const t of texts) {
    const { unsupported } = planHandwriting([t.latex], { size: CHECK.size, seed: 1 });
    if (unsupported.length > 0) {
      out.push(`The ${t.name ? "name" : "label"} "${t.latex}" on ${t.where} cannot be written by hand (${unsupported.join(", ")}); use short maths such as 3, x, 2x + 1 or 70^{\\circ}.`);
      continue;
    }
    const word = t.name ? null : wordIn(t.latex);
    if (word) out.push(`The label "${t.latex}" on ${t.where} is a word ("${word}"); the board carries no words — use a letter or a number, such as b, h or 3.`);
  }
  return out;
}

function crowding(fig: Figure): string[] {
  const out: string[] = [];
  if (fig.points.length > CHECK.maxPoints) {
    out.push(`The figure has ${fig.points.length} points; at most ${CHECK.maxPoints} stay readable — leave out points nothing needs.`);
  }
  const elements = fig.segments.length + fig.lines.length + fig.circles.length + fig.angles.length;
  if (elements > CHECK.maxElements) {
    out.push(`The figure has ${elements} sides, lines, circles and angle marks; at most ${CHECK.maxElements} stay readable — draw only what the question needs.`);
  }
  const labels =
    fig.points.filter((p) => p.label).length +
    fig.segments.filter((s) => s.label).length +
    fig.lines.filter((l) => l.label).length +
    fig.angles.filter((g) => g.label).length;
  if (labels > CHECK.maxLabels) {
    out.push(`The figure has ${labels} names and labels; at most ${CHECK.maxLabels} fit legibly — hide names nothing refers to (label: false) or drop labels.`);
  }
  return out;
}
