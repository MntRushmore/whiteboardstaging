import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GrownUpMore, { inLayerOverMore, layerOverMore, MORE_COPY, type LayerNode, type MoreControls } from "../GrownUpMore";
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
  const controls = (patch: Partial<MoreControls> = {}): MoreControls => ({
    dial: <span>the dial</span>,
    auto: { on: true, hint: "Auto is on" },
    onAutoChange: vi.fn(),
    ask: false,
    onAsk: vi.fn(),
    onTopic: vi.fn(),
    status: <span>the status pill</span>,
    ink: <span data-testid="ink-meter">∞</span>,
    menu: { liveRunning: true, liveAvailable: true, onLiveEnabledChange: vi.fn(), canHelp: true, onClearMarks: vi.fn(), onShowModeInfo: vi.fn(), onReportProblem: vi.fn() },
    ...patch,
  });
  const render = (open: boolean, patch: Partial<MoreControls> = {}) =>
    renderToStaticMarkup(<GrownUpMore open={open} onOpenChange={vi.fn()} simpleOn onSimpleChange={vi.fn()} controls={controls(patch)} />);

  it("its button carries the hook the tour's coach marks find More by", () => {
    const button = render(false).match(/<button\b[^>]*aria-controls="grown-up-more"[^>]*>/)?.[0] ?? "";
    expect(button).toContain(`${GROWN_UP_MORE_ATTR}=""`);
  });

  it("keeps the card mounted but hidden while closed (the pill and the ink meter in it keep working)", () => {
    expect(render(false)).toMatch(/<section[^>]*id="grown-up-more"[^>]*hidden=""/);
    expect(render(false)).toContain("the status pill");
    expect(render(false)).toContain('data-testid="ink-meter"');
    expect(render(true)).not.toMatch(/<section[^>]*hidden=""/);
  });

  it("labels every row: how much help, Auto and what it does, the plan, and Board options as a row of its own", () => {
    const out = render(true);
    expect(out).toContain(MORE_COPY.help);
    expect(out).toContain(">Auto<");
    expect(out).toContain(MORE_COPY.autoOn);
    expect(render(true, { auto: { on: false, hint: "off" } })).toContain(MORE_COPY.autoOff);
    expect(out).toContain(`>${MORE_COPY.plan}`);
    expect(out).toMatch(/<button[^>]*data-testid="more-board-options"[^>]*>[\s\S]*Board options/);
    // two switches: Simple board and Auto, each a whole row
    expect(out.match(/role="switch"/g)).toHaveLength(2);
    // Report a bug lives in Board options, not twice
    expect(out).not.toContain("Report a bug");
  });

  it("no Auto row where Auto would do nothing, and no Ask while the tour keeps it in the bar", () => {
    const out = render(true, { auto: null, ask: null });
    expect(out.match(/role="switch"/g)).toHaveLength(1);
    expect(out).not.toContain(">Ask<");
    expect(out).toContain("New topic");
  });

  it("every button in it is at least 44 px tall", () => {
    const out = render(true);
    for (const button of out.match(/<button\b[^>]*>/g) ?? []) {
      if (button.includes('aria-controls="grown-up-more"')) continue; // More itself: 48 px (h-12)
      expect(button).toMatch(/\b(min-h-11|min-h-14|size-11)\b/);
    }
  });
});
