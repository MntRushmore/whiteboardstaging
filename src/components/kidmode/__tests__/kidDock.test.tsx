import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The simple board's dock as drawn, on a laptop, an upright iPad and a phone: which buttons are in
 * its row, which wait behind More, and that every one of them is a big target with one word.
 */

// a board with the pen in hand, three pages, as wide as `board.width`
const board = vi.hoisted(() => ({ width: 1440, tool: "draw" }));
const editor = vi.hoisted(() => ({
  getCurrentToolId: () => board.tool,
  getStyleForNextShape: () => "black",
  getCanUndo: () => true,
  getCanRedo: () => false,
  getPages: () => [{ id: "page:1" }, { id: "page:2" }, { id: "page:3" }],
  getCurrentPageId: () => "page:3",
  getViewportScreenBounds: () => ({ w: board.width, h: 900 }),
}));
vi.mock("tldraw", async (importOriginal) => ({
  ...(await importOriginal<typeof import("tldraw")>()),
  useEditor: () => editor,
  useValue: (_name: string, fn: () => unknown) => fn(),
}));

const { default: KidDock } = await import("../KidDock");
const { DOCK_COPY } = await import("../dockView");

/** Each of the dock's buttons by its word (or, with a picture alone, its name), in order. */
function words(html: string): string[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => inner.match(/<span>([^<]+)<\/span>/)?.[1] ?? attrs.match(/aria-label="([^"]+)"/)?.[1] ?? "");
}

/** Does this tag's class list have one of these classes? */
const hasClass = (tag: string, ...names: string[]) => (tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? []).some((c) => names.includes(c));

function render(width: number) {
  board.width = width;
  return renderToStaticMarkup(<KidDock />);
}

describe("KidDock", () => {
  it("a laptop: one row of everything, tools | Undo Redo | colours | pages | Ask", () => {
    const out = render(1440);
    expect(out).toContain('data-fit="row"');
    expect(words(out)).toEqual(["Select", "Pen", "Eraser", "Shapes", "Picture", "Undo", "Redo", "Black", "Red", "Green", "Purple", "Page before", "Next page", "New page", "Ask"]);
    expect(out).not.toContain("data-kid-more-tools");
  });

  it("an upright iPad: Shapes, Picture and Redo behind More; with no Type button the four colours fit beside them", () => {
    const out = render(820);
    expect(out).toContain('data-fit="fold"');
    expect(words(out)).toEqual(["Select", "Pen", "Eraser", "Undo", "More", "Black", "Red", "Green", "Purple", "Page before", "Next page", "New page", "Ask"]);
  });

  it("a phone: two rows in one dock, the pages and Ask over the tools, and nothing wraps", () => {
    const out = render(390);
    expect(out).toContain('data-fit="stack"');
    expect(words(out)).toEqual(["Page before", "Next page", "New page", "Ask", "Select", "Pen", "Eraser", "Color", "Undo", "More"]);
    // no Type button anywhere: everything on the board is written (Type it was taken off, 2026-10-13)
    for (const width of [1440, 820, 390, 360]) expect(words(render(width))).not.toContain("Type");
  });

  it("every button is a 52 px tall target at least 44 px wide (46 and up for a tool with its word)", () => {
    for (const width of [1440, 820, 390]) {
      for (const tag of render(width).match(/<button\b[^>]*>/g) ?? []) {
        expect(hasClass(tag, "h-[52px]"), `${width}px: ${tag}`).toBe(true);
        expect(hasClass(tag, "min-w-12", "min-w-16", "min-w-[46px]", "min-w-[104px]", "w-11", "flex-1"), `${width}px: ${tag}`).toBe(true);
      }
    }
  });

  it("shows the tool in hand pressed: Select, and Shapes for a shape", () => {
    board.tool = "select";
    expect(render(1440)).toMatch(/<button[^>]*aria-pressed="true"[^>]*data-kid-select=""/);
    board.tool = "line";
    expect(render(1440)).toMatch(/<button[^>]*aria-pressed="true"[^>]*data-kid-shapes=""/);
    // folded, More shows the shape in hand is in there
    expect(render(820)).toMatch(/<button[^>]*aria-pressed="true"[^>]*data-kid-more-tools=""/);
    board.tool = "draw";
  });

  it("Picture's one file picker takes a photo or a PDF", () => {
    const input = render(1440).match(/<input\b[^>]*data-kid-picture-input[^>]*>/)?.[0] ?? "";
    expect(input).toContain('type="file"');
    expect(input).toMatch(/accept="[^"]*image\/png[^"]*image\/jpeg[^"]*application\/pdf/);
    expect(DOCK_COPY.pictureHint).toMatch(/photo/i);
  });
});
