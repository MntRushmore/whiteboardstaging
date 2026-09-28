import { describe, expect, it } from "vitest";
import { DiagramSpecSchema, type DiagramSpec } from "../contracts";
import { sketchDiagram } from "../diagram";
import { LECTURE_BOXES } from "../plan";
import { DIAGRAM_GALLERY, problemsOf, wallMs } from "./gallery";

const BIG = LECTURE_BOXES.visual[0];
/** 40 characters: the longest a node may be */
const node40 = (i: number) => `Step ${i + 1}: a rather long thing to do`.slice(0, 40);
const label20 = (i: number) => `A longer item, no ${i + 1}`.slice(0, 20);
const label28 = (i: number) => `An item that is long, no ${i + 1}`.slice(0, 28);

const EXTREME: ReadonlyArray<{ title: string; spec: DiagramSpec }> = [
  { title: "flow: two steps", spec: { kind: "flow", steps: ["Cause", "Effect"] } },
  {
    title: "flow: seven long steps",
    spec: { kind: "flow", title: "A long process with many steps in it", steps: Array.from({ length: 7 }, (_, i) => node40(i)) },
  },
  {
    title: "flow: five steps, every arrow labelled",
    spec: { kind: "flow", steps: ["Magma", "Igneous rock", "Sediment", "Sedimentary rock", "Metamorphic rock"], arrows: ["cools", "weathering", "pressure", "heat and pressure"] },
  },
  { title: "cycle: three", spec: { kind: "cycle", steps: ["Egg", "Larva", "Adult"] } },
  { title: "cycle: eight long", spec: { kind: "cycle", title: "A cycle", steps: Array.from({ length: 8 }, (_, i) => `Stage ${i + 1} of the loop`) } },
  { title: "timeline: two", spec: { kind: "timeline", events: [{ when: "1066", what: "Battle of Hastings" }, { when: "1215", what: "Magna Carta" }] } },
  {
    title: "timeline: eight long",
    spec: { kind: "timeline", title: "Eight things that happened", events: Array.from({ length: 8 }, (_, i) => ({ when: `${1900 + i * 12} to ${1905 + i * 12}`, what: node40(i) })) },
  },
  { title: "hub: two", spec: { kind: "hub", center: "Energy", spokes: ["Kinetic", "Potential"] } },
  { title: "hub: eight long", spec: { kind: "hub", title: "Causes", center: "The fall of the Roman Empire in the West", spokes: Array.from({ length: 8 }, (_, i) => `Cause number ${i + 1} of it`) } },
  {
    title: "hub: five spokes of 30-38 characters (a real director's)",
    spec: {
      kind: "hub",
      title: "Why the Roman Republic fell",
      center: "Fall of the Republic",
      spokes: ["Power struggles between rival generals", "Growing gap between rich and poor", "Armies loyal to generals, not Rome", "Corruption in the Senate and courts", "Julius Caesar crossing the Rubicon"],
    },
  },
  {
    title: "hub: six spokes of 38-40 characters",
    spec: { kind: "hub", center: "Causes of climate change today", spokes: Array.from({ length: 6 }, (_, i) => `Cause ${i + 1}: burning fossil fuels for power`.slice(0, 40)) },
  },
  { title: "cycle: a step with a slash (a real director's)", spec: { kind: "cycle", title: "The water cycle", steps: ["Evaporation", "Condensation", "Precipitation", "Runoff/Infiltration"] } },
  { title: "cycle: an over-long word", spec: { kind: "cycle", steps: ["Photosynthesisandrespiration", "Decomposition", "Combustion"] } },
  { title: "tree: one child", spec: { kind: "tree", root: "Matter", children: [{ text: "Pure substances", children: ["Elements", "Compounds"] }] } },
  {
    title: "tree: twelve leaves, long names",
    spec: {
      kind: "tree",
      title: "Classification of living things",
      root: "Living things",
      children: [
        { text: "Animals", children: ["Vertebrates", "Invertebrates", "Sponges"] },
        { text: "Plants", children: ["Flowering plants", "Conifers", "Mosses"] },
        { text: "Fungi", children: ["Mushrooms", "Yeasts"] },
        { text: "Protists", children: ["Algae", "Amoebas"] },
        { text: "Bacteria and archaea", children: ["Bacteria", "Archaea"] },
      ],
    },
  },
  { title: "tree: five leaves only", spec: { kind: "tree", root: "Shapes", children: ["Circle", "Square", "Triangle", "Pentagon", "Hexagon"].map((t) => ({ text: t })) } },
  { title: "venn: only shared", spec: { kind: "venn", left: "Frogs", right: "Toads", leftOnly: [], both: ["Amphibians"], rightOnly: [] } },
  {
    title: "venn: four longer items per region",
    spec: { kind: "venn", title: "Two things compared", left: "The first thing", right: "The second thing", leftOnly: [0, 1, 2, 3].map(label20), both: [4, 5, 6, 7].map(label20), rightOnly: [8, 9, 10, 11].map(label20) },
  },
];

describe("planDiagram", () => {
  const all = [...DIAGRAM_GALLERY, ...EXTREME];

  it("every spec here is one the director may send", () => {
    for (const d of all) expect(DiagramSpecSchema.safeParse(d.spec).success, d.title).toBe(true);
  });

  it("draws every typical and extreme diagram in the big box: clean, in time", () => {
    for (const [i, d] of all.entries()) {
      const sk = sketchDiagram(d.spec, { seed: 300 + i, box: BIG });
      expect(sk, d.title).not.toBeNull();
      expect(problemsOf(sk!, BIG), d.title).toEqual([]);
      expect(wallMs(sk!), d.title).toBeLessThanOrEqual(8500);
      expect(wallMs(sk!), d.title).toBeGreaterThanOrEqual(1500);
    }
  });

  it("writes every node, step, event and item", () => {
    for (const [i, d] of all.entries()) {
      const sk = sketchDiagram(d.spec, { seed: 300 + i, box: BIG })!;
      const written = sk.texts.map((t) => t.text).join(" | ");
      const s = d.spec;
      const words =
        s.kind === "flow" || s.kind === "cycle"
          ? s.steps
          : s.kind === "timeline"
            ? s.events.flatMap((e) => [e.when, e.what])
            : s.kind === "hub"
              ? [s.center, ...s.spokes]
              : s.kind === "tree"
                ? [s.root, ...s.children.flatMap((c) => [c.text, ...(c.children ?? [])])]
                : [s.left, s.right, ...s.leftOnly, ...s.both, ...s.rightOnly];
      for (const w of words) expect(written, `${d.title}: ${w}`).toContain(w.replace(/\s+/g, " "));
    }
  });

  it("in the smaller boxes: clean when drawn, and most typical ones still drawn", () => {
    for (const box of LECTURE_BOXES.visual.slice(1)) {
      let drawn = 0;
      for (const [i, d] of DIAGRAM_GALLERY.entries()) {
        const sk = sketchDiagram(d.spec, { seed: 9 + i, box });
        if (!sk) continue;
        drawn++;
        expect(problemsOf(sk, box), `${d.title} in ${box.w}×${box.h}`).toEqual([]);
      }
      // the smallest box cannot hold every kind at a readable size (a Venn's overlap, a wide tree): null, not squashed
      expect(drawn, `${box.w}×${box.h}`).toBeGreaterThanOrEqual(Math.ceil(DIAGRAM_GALLERY.length * (box.w >= 440 ? 0.75 : 0.4)));
    }
  });

  it("is the same sketch for the same seed", () => {
    for (const d of DIAGRAM_GALLERY) {
      const a = sketchDiagram(d.spec, { seed: 5, box: BIG });
      const b = sketchDiagram(d.spec, { seed: 5, box: BIG });
      expect(b, d.title).toEqual(a);
    }
  });

  it("draws a flow in reading order: each step, then its arrow", () => {
    const sk = sketchDiagram(DIAGRAM_GALLERY[0].spec, { seed: 1, box: BIG })!;
    const steps = (DIAGRAM_GALLERY[0].spec as Extract<DiagramSpec, { kind: "flow" }>).steps;
    const order = steps.map((st) => sk.plan.lines.findIndex((l) => l.latex === st));
    expect(order.every((o) => o >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("leaves a title off before it leaves a diagram out, and gives up on one too dense to read", () => {
    // the rock cycle's labelled flow fits the middle box only without its title
    const d = DIAGRAM_GALLERY.find((g) => g.title.startsWith("flow: every arrow"))!.spec;
    const mid = LECTURE_BOXES.visual[1];
    const sk = sketchDiagram(d, { seed: 1, box: mid })!;
    expect(problemsOf(sk, mid)).toEqual([]);
    expect(sk.texts.some((t) => t.text === "The rock cycle")).toBe(false);
    expect(sketchDiagram(d, { seed: 1, box: BIG })!.texts.some((t) => t.text === "The rock cycle")).toBe(true);
    const dense: DiagramSpec = { kind: "venn", left: "The first thing", right: "The second thing", leftOnly: [0, 1, 2, 3].map(label28), both: [4, 5, 6, 7].map(label28), rightOnly: [8, 9, 10, 11].map(label28) };
    const out = sketchDiagram(dense, { seed: 1, box: BIG });
    if (out) expect(problemsOf(out, BIG)).toEqual([]);
  });

  it("is null when the box is too small for it", () => {
    expect(sketchDiagram(EXTREME[1].spec, { seed: 1, box: { w: 200, h: 140 } })).toBeNull();
    expect(sketchDiagram(DIAGRAM_GALLERY[11].spec, { seed: 1, box: { w: 180, h: 140 } })).toBeNull();
    expect(sketchDiagram(DIAGRAM_GALLERY[3].spec, { seed: 1, box: { w: 160, h: 120 } })).toBeNull();
  });
});
