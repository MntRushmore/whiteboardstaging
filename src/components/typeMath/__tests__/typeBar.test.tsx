import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveController } from "@/lib/live/contracts";
import type { TypedParse } from "@/lib/typeMath/contracts";
import TypeBar, { type TypeBarEditor, type TypeBarProps, type TypeParser } from "../TypeBar";
import { INITIAL_BAR, MATH_KEYS, TYPE_COPY, type BarState } from "../typeBarModel";

/** The editor surface the bar reads, with nothing behind it (no DOM in these tests). */
const editor: TypeBarEditor = {
  getContainer: () => ({}) as HTMLElement,
  getViewportScreenBounds: () => ({ x: 0, y: 0, w: 1440, h: 900, width: 1440, height: 900 }) as ReturnType<TypeBarEditor["getViewportScreenBounds"]>,
  getCurrentPageId: () => "page:1" as ReturnType<TypeBarEditor["getCurrentPageId"]>,
  getCurrentPageShapeIds: () => new Set() as ReturnType<TypeBarEditor["getCurrentPageShapeIds"]>,
  pageToViewport: (p) => ({ x: p.x, y: p.y }) as ReturnType<TypeBarEditor["pageToViewport"]>,
  getZoomLevel: () => 1,
  getStyleForNextShape: (() => "black") as unknown as TypeBarEditor["getStyleForNextShape"],
  getSelectedShapeIds: () => [],
  getEditingShapeId: () => null,
  undo: () => editor as never,
  redo: () => editor as never,
  focus: () => editor as never,
  menus: { hasAnyOpenMenus: () => false },
};

const parser: TypeParser = {
  plainToLatex: (text: string): TypedParse =>
    text.includes("(") && !text.includes(")") ? { ok: false, hint: "Close the bracket", partial: text.replace("(", "") } : { ok: true, latex: text.replace(/(\d+)\/(\d+)/g, "\\frac{$1}{$2}") },
  latexToPlain: (latex: string) => latex,
};

const writer = (): LiveController => ({ writeTyped: () => ({ ok: true, lineId: "x", bounds: { x: 0, y: 0, w: 1, h: 1 } }), typedLines: () => [], typedSpot: () => null }) as unknown as LiveController;

const render = (initial: Partial<BarState> = {}, props: Partial<TypeBarProps> = {}) =>
  renderToStaticMarkup(<TypeBar editor={editor} controller={writer()} parser={parser} initial={initial} {...props} />).replace(/&#x27;/g, "'");

const field = (value: string) => ({ ...INITIAL_BAR.field, value, start: value.length, end: value.length });

describe("TypeBar markup", () => {
  it("no bar when the controller cannot write a typed line (no writeTyped)", () => {
    expect(renderToStaticMarkup(<TypeBar editor={editor} controller={{} as LiveController} parser={parser} />)).toBe("");
  });

  it("no card until the writer's code is in (`prepareTyped`): Enter, the caret and ↑ need it", () => {
    const loading = { ...writer(), prepareTyped: () => new Promise<void>(() => undefined) } as LiveController;
    expect(renderToStaticMarkup(<TypeBar editor={editor} controller={loading} parser={parser} />)).toBe("");
  });

  it("the box, its keys, New problem, Enter and Hide, each named for a screen reader", () => {
    const html = render();
    expect(html).toContain(`aria-label="${TYPE_COPY.region}"`);
    expect(html).toContain(`aria-label="${TYPE_COPY.box}"`);
    expect(html).toContain(`placeholder="${TYPE_COPY.placeholder}"`);
    for (const k of MATH_KEYS) expect(html).toContain(`aria-label="${k.name}"`);
    expect(html).toContain(`aria-label="${TYPE_COPY.enterHint}"`);
    expect(html).toContain(TYPE_COPY.newProblem);
    expect(html).toContain(`aria-label="${TYPE_COPY.close}"`);
    // it tells the board how much of its foot it covers
    expect(html).toContain("data-type-bar");
  });

  it("the box is never under 16 px (no zoom on an iPhone) and the keys are 44 px targets", () => {
    const html = render();
    const input = html.match(/<input\b[^>]*>/)?.[0] ?? "";
    expect(input).toMatch(/text-\[18px\]/);
    expect(input).toContain('enterKeyHint="enter"');
    expect(input).toContain('autoComplete="off"');
    const keys = html.match(/<button[^>]*data-type-key="[a-z]+"[^>]*>/g) ?? [];
    expect(keys).toHaveLength(MATH_KEYS.length);
    for (const k of keys) expect(k).toMatch(/\bh-11\b.*\bmin-w-11\b/);
  });

  it("flat fills only: no gradients anywhere in the bar", () => {
    expect(render({ field: field("1/2") })).not.toMatch(/gradient/i);
  });

  it("typing 1/2: the preview draws it in the hand (an SVG of strokes in the kid's ink), and nothing greyed", () => {
    const html = render({ field: field("1/2") });
    const svg = html.match(/<svg[^>]*data-type-preview[^>]*>[\s\S]*?<\/svg>/)?.[0] ?? "";
    expect(svg).not.toBe("");
    expect(svg).not.toContain("data-muted");
    // a fraction is a numerator, a bar and a denominator: three strokes at least
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).not.toContain("data-type-hint");
  });

  it("ok:false: the partial greyed, with the hint beside it", () => {
    const html = render({ field: field("3(x+1") });
    expect(html).toMatch(/<svg[^>]*data-type-preview[^>]*data-muted/);
    expect(html).toContain("Close the bracket");
  });

  it("a refusal shows in the preview's place", () => {
    const html = render({ field: field("x+1"), notice: TYPE_COPY.refused.unwritable });
    expect(html).toContain(TYPE_COPY.refused.unwritable);
    expect(html).not.toMatch(/<svg[^>]*data-type-preview/);
  });

  it("changing a line: the chip says which line, New problem is off", () => {
    const line = { lineId: "l2", typed: true, typedText: "2x=8", latex: "2x=8", bounds: { x: 0, y: 0, w: 1, h: 1 } };
    const html = render({ field: field("2x=8"), edit: { index: 1, line, draft: "" } });
    expect(html).toContain(TYPE_COPY.editing(2));
    expect(html).toContain(`aria-label="${TYPE_COPY.editingHint(2)}"`);
    const newProblem = html.match(/<button[^>]*data-type-new="wide"[^>]*>/)?.[0] ?? "";
    expect(newProblem).toContain("disabled");
  });

  it("New problem armed: pressed, and said aloud", () => {
    const html = render({ armed: true });
    expect(html).toMatch(/<button[^>]*data-type-new="wide"[^>]*aria-pressed="true"/);
    expect(html).toContain(TYPE_COPY.newProblemArmed);
  });

  it("no tip in a server render (it needs a laptop's pointer); a reduced-motion rule for every animation", () => {
    const html = render();
    expect(html).not.toContain(TYPE_COPY.tip);
    expect(html).toContain("prefers-reduced-motion:reduce");
  });
});
