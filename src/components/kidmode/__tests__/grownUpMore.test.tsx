import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GrownUpMore, { inLayerOverMore, layerOverMore, type LayerNode } from "../GrownUpMore";
import { GROWN_UP_MORE_ATTR } from "../tourAnchors";

/**
 * The simple board's More: what counts as a layer over it (which takes Escape first, and whose taps
 * are not taps outside it), and the hook the guided board's coach marks find it by.
 */

/** A stand-in for a DOM element: its attributes, and the element it sits in. */
function node(attrs: Record<string, string>, parent: LayerNode | null = null): LayerNode {
  return {
    getAttribute: (name) => attrs[name] ?? null,
    hasAttribute: (name) => name in attrs,
    parentElement: parent,
  };
}

const coachMark = node({ role: "dialog", "aria-modal": "false", "data-coach-mark": "1" });
const tourFinish = node({ role: "dialog", "aria-modal": "true" });
const radixDialog = node({ role: "dialog" }); // Radix's Dialog sets no aria-modal: it hides the rest instead
const menu = node({ role: "menu" });
const confirm = node({ role: "alertdialog" });
const popper = node({ "data-radix-popper-content-wrapper": "" });
const board = node({ class: "tl-canvas" });

describe("layerOverMore", () => {
  it("is a menu or a modal dialog: it closes first, on its own Escape", () => {
    expect(layerOverMore(menu)).toBe(true);
    expect(layerOverMore(tourFinish)).toBe(true);
    expect(layerOverMore(radixDialog)).toBe(true);
    expect(layerOverMore(confirm)).toBe(true);
  });

  it("is not the guided board's coach mark (a non-modal dialog), so Escape still closes More beside it", () => {
    expect(layerOverMore(coachMark)).toBe(false);
    expect(layerOverMore(node({ role: "dialog", "aria-modal": "false" }))).toBe(false);
    expect(layerOverMore(board)).toBe(false);
    expect(layerOverMore(node({ role: "status" }))).toBe(false);
  });
});

describe("inLayerOverMore", () => {
  it("a tap inside a menu, a popover's portal or a modal dialog is not a tap outside More", () => {
    expect(inLayerOverMore(node({ role: "menuitem" }, menu))).toBe(true);
    expect(inLayerOverMore(node({ role: "option" }, node({}, popper)))).toBe(true);
    expect(inLayerOverMore(node({ type: "button" }, tourFinish))).toBe(true);
  });

  it("a tap on the coach mark (its Next, its Skip tour) or the board is a tap outside: More closes", () => {
    expect(inLayerOverMore(node({ type: "button" }, node({}, coachMark)))).toBe(false);
    expect(inLayerOverMore(coachMark)).toBe(false);
    expect(inLayerOverMore(node({}, board))).toBe(false);
    expect(inLayerOverMore(null)).toBe(false);
  });
});

describe("GrownUpMore", () => {
  const render = (open: boolean) =>
    renderToStaticMarkup(
      <GrownUpMore open={open} onOpenChange={vi.fn()} simpleOn onSimpleChange={vi.fn()}>
        <span>controls</span>
      </GrownUpMore>,
    );

  it("its button carries the hook the tour's coach marks find More by", () => {
    const button = render(false).match(/<button\b[^>]*aria-controls="grown-up-more"[^>]*>/)?.[0] ?? "";
    expect(button).toContain(`${GROWN_UP_MORE_ATTR}=""`);
  });

  it("keeps the card mounted but hidden while closed (the pill and the ink meter in it keep working)", () => {
    expect(render(false)).toMatch(/<section[^>]*id="grown-up-more"[^>]*hidden=""/);
    expect(render(false)).toContain("controls");
    expect(render(true)).not.toMatch(/<section[^>]*hidden=""/);
  });
});
