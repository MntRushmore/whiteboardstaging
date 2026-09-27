import type { SetupRequest, SetupResponse } from "@/lib/live/contracts";
import { FigureReplySchema, labelKey, parseLabel, planFigure, readFromReply, unicodeToLatex, type FigureReply, type QuantityKind } from "@/lib/live/figure";
import type { ChatMessage } from "@/lib/server/openrouter";
import { cleanSetupReply } from "./setup";

/**
 * System prompt for POST /api/live/setup WITH a crop: "the tutor reads the figure". The student
 * drew a figure (a triangle with its angles marked, parallel lines cut by a transversal, an
 * isosceles triangle with tick marks, a circle, a polygon, similar triangles) and either asked about
 * it (Solve / Help on the drawing, or `x = ?` beside it) or, in Solve, drew it with an unknown among
 * its labels and stopped.
 *
 * "The model perceives, the engine reasons": the model describes what it SEES — each labelled angle
 * and side, and the relationships the drawing shows — and computes nothing. `planFigure`
 * (src/lib/live/figure/plan.ts) turns that description into the equations, and the board's engine
 * solves them. The model also writes its own setup lines (the old reply), used only when its
 * description does not hold up, and then only if the engine solves them to a sensible size.
 *
 * The fact names and their item order are the contract with `planFigure` (src/lib/live/figure/
 * schema.ts); a synonym a model tends to use is mapped there, not here.
 */
export const FIGURE_SYSTEM_PROMPT = [
  "You read a student's hand-drawn geometry figure and describe exactly what it shows, so that a calculator can find the unknown. You never calculate.",
  "",
  "INPUT: an image of the figure with its labels; the labels as a handwriting reader read them (it may misread one: the image is the truth); the student's lines beside the figure, if any (a line like x = ? names what is asked).",
  "",
  "OUTPUT: one JSON object and nothing else:",
  '{"unknown": "<the letter asked for, or ?>", "quantities": [{"id": "a", "what": "angle" or "side", "label": "<the label exactly as written, or null>", "at": "<where it is, a few words>"}], "facts": [{"type": "<fact>", "items": ["<id>", ...]}], "lines": ["<LaTeX>", ...]}',
  "",
  "QUANTITIES: every labelled angle and every labelled side, one each, its label copied as written (70°, x, 2x + 10, (3x - 5)°, ?, 5). Add an unlabelled angle or side (label null) only when a fact needs it: the unlabelled base angle of an isosceles triangle, the corner with a right-angle box, an angle that links two labelled ones. A vertex letter (A, B, C) or a line's name (l, m, t) is not a quantity. Every labelled quantity must be in at least one fact.",
  "\"at\" says where it is. For an angle at a corner of a triangle or polygon, say whether it is INSIDE the shape or OUTSIDE it (between one side and another side extended past the corner). For an angle where a transversal crosses parallel lines, write exactly: \"<first or second> crossing, <between or outside> the parallel lines, <left or right> of the transversal\" (above or below the transversal when it runs across the page). Look at where its arc and label are: an angle above the upper parallel line or below the lower one is outside; one in the strip between the two lines is between.",
  "",
  "FACTS the drawing shows (items are quantity ids, in this order):",
  "- triangle [a, b, c]: the three angles of one triangle.",
  "- exterior_angle [e, r1, r2]: e is an exterior angle of a triangle (between one side and the next side extended); r1, r2 are the two interior angles NOT next to it.",
  "- straight_line [a, b, ...]: angles side by side that together make a straight line (a linear pair).",
  "- around_point [a, b, ...]: all the angles round one point (a full turn).",
  "- right_angle_parts [a, b, ...]: angles that together fill a right angle marked with a box.",
  "- vertical [a, b]: vertically opposite angles where two straight lines cross.",
  "- transversal [a, b]: two angles at the two crossings of one transversal with two lines marked parallel (arrow marks). Their \"at\" must give each one's position as above: the calculator works out whether they are equal.",
  "- isosceles [apex, base1, base2]: a triangle with two sides marked equal (tick marks); base1 and base2 are the angles opposite the equal sides, apex the angle between them.",
  "- equal [a, b]: two angles or two sides marked equal with the same marks.",
  "- equilateral [a, ...]: angles or sides of a triangle whose three sides are marked equal.",
  "- right_angle [a]: an angle marked with a right-angle box.",
  "- right_triangle [leg, leg, hypotenuse]: the three sides of a right triangle (the hypotenuse is opposite the right angle).",
  '- polygon [a, b, c, ...] with "sides": n: every interior angle of one polygon with n sides.',
  '- regular_polygon [a] with "sides": n and "angle": "interior" or "exterior": an angle of a regular polygon (all sides marked equal, or it is called regular).',
  "- exterior_angles [a, b, ...]: one exterior angle at each vertex of a polygon.",
  "- inscribed_central [inscribed, central]: an inscribed angle and the central angle on the same arc (an arc's degree label counts as its central angle).",
  "- same_arc [a, b]: two inscribed angles on the same arc.",
  "- tangent_radius [a]: the angle between a tangent and the radius at the point where it touches.",
  "- semicircle [a]: an angle inscribed in a semicircle (its arms end at the ends of a diameter).",
  "- cyclic_opposite [a, b]: opposite angles of a quadrilateral whose corners are on a circle.",
  "- similar [[p, q], [r, s]]: two similar figures; each pair is a side of the first figure and the matching side of the second.",
  "- midsegment [m, side]: m joins the midpoints of two sides of a triangle; side is the third side, parallel to it.",
  "Give the facts that tie the unknown to the given labels as directly as the figure allows; add any other fact it clearly shows.",
  "",
  "LINES: your own setup, as a student writes it beside the figure: at most 4 lines of LaTeX, each with =, the figure's own letters, angles as plain numbers (no degree sign), never computed and never the answer. Pythagoras for a length: x^{2} = 3^{2} + 4^{2}.",
  "",
  "EXAMPLE: two lines marked parallel cut by a transversal; 70° above the upper line, left of the transversal; x below the lower line, right of it.",
  '{"unknown": "x", "quantities": [{"id": "a", "what": "angle", "label": "70°", "at": "first crossing, outside the parallel lines, left of the transversal"}, {"id": "b", "what": "angle", "label": "x", "at": "second crossing, outside the parallel lines, right of the transversal"}], "facts": [{"type": "transversal", "items": ["a", "b"]}], "lines": ["x = 70"]}',
  "EXAMPLE: a triangle with two sides ticked equal; 40° between them; x at one of the other corners.",
  '{"unknown": "x", "quantities": [{"id": "a", "what": "angle", "label": "40°", "at": "top corner, inside, between the equal sides"}, {"id": "b", "what": "angle", "label": "x", "at": "bottom left corner, inside"}, {"id": "c", "what": "angle", "label": null, "at": "bottom right corner, inside"}], "facts": [{"type": "isosceles", "items": ["a", "b", "c"]}], "lines": ["2x + 40 = 180"]}',
  "",
  'If nothing is asked (no unknown among the labels and no x = ? line), answer {"unknown": "", "quantities": [], "facts": [], "lines": []}.',
].join("\n");

function numbered(lines: readonly string[]): string {
  return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
}

/** Build the multimodal messages for a figure (image first, as the reread route sends it). */
export function buildFigureMessages(req: Pick<SetupRequest, "lines" | "labels" | "crop">): ChatMessage[] {
  const labels = (req.labels ?? []).map((l) => l.trim()).filter(Boolean);
  const lines = req.lines.map((l) => l.trim()).filter(Boolean);
  const text = [
    labels.length > 0 ? `Labels read on the figure: ${labels.join(", ")}` : "Labels read on the figure: none",
    lines.length > 0 ? `The student's lines beside it, top to bottom:\n${numbered(lines)}` : "No lines beside it.",
    "JSON only.",
  ].join("\n");
  return [
    { role: "system", content: FIGURE_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: req.crop ?? "" } },
        { type: "text", text },
      ],
    },
  ];
}

/** Minimal reasoning for the models that take it (Anthropic's thinking is off by default). */
export function figureReasoning(model: string): "low" | undefined {
  return model.startsWith("anthropic/") ? undefined : "low";
}

/** At most this many lines reach the board (`SetupResponseSchema`). */
const MAX_LINES = 6;

/** What the labels say is asked: an angle when the unknown's label (or any label) has a degree mark. */
function askedKind(reply: FigureReply, labels: readonly string[]): QuantityKind | undefined {
  const read = readFromReply(reply);
  const unknown = reply.unknown.replace(/[\s{}$]/g, "");
  const q = read.quantities.find((x) => x.label !== null && (x.label.trim() === "?" || (unknown && labelKey(x.label).includes(unknown.toLowerCase()))));
  if (q) return q.what;
  const degrees = [...labels, ...read.quantities.map((x) => x.label ?? "")].some((l) => {
    const p = parseLabel(l);
    return (p.kind === "value" && p.value.degrees) || (p.kind === "unknown" && p.degrees);
  });
  return degrees ? "angle" : undefined;
}

/**
 * The figure reply as the board receives it. The structured read first: when `planFigure` turns it
 * into equations, those are the lines (`figure.source: "facts"`, one stage per unknown with the
 * value the board's engine must agree with). Otherwise the model's own lines (`source: "lines"`,
 * with why the read was not used), which the board keeps only if its engine solves them to a
 * sensible size. `lines` empty: nothing usable (the route answers 502 and refunds).
 */
export function figureSetup(raw: unknown, req: Pick<SetupRequest, "lines" | "labels">): Pick<SetupResponse, "lines" | "unknown" | "figure"> {
  const parsed = FigureReplySchema.safeParse(raw);
  const reply: FigureReply = parsed.success ? parsed.data : { unknown: "", quantities: [], facts: [], lines: [] };
  const plan = planFigure(readFromReply(reply), { labels: req.labels ?? [], column: req.lines });
  // the model writes `θ` and `−` where the board writes `\theta` and `-`
  const own = cleanSetupReply({ unknown: unicodeToLatex(reply.unknown), lines: reply.lines.map((l) => (typeof l === "string" ? unicodeToLatex(l) : l)) });
  if (plan.ok) {
    const stages: NonNullable<SetupResponse["figure"]>["stages"] = [];
    let count = 0;
    for (const s of plan.stages) {
      if (count + s.lines.length > MAX_LINES) break;
      stages.push({ letter: s.letter, lines: s.lines, value: s.value, kind: s.kind });
      count += s.lines.length;
    }
    if (stages.length > 0) return { lines: stages.flatMap((s) => s.lines), unknown: stages[0].letter, figure: { source: "facts", stages } };
  }
  const kind = askedKind(reply, req.labels ?? []);
  return {
    lines: own.lines,
    unknown: own.unknown,
    figure: { source: "lines", reason: (plan.ok ? "too many lines" : plan.reason).slice(0, 300), ...(kind ? { kind } : {}) },
  };
}
