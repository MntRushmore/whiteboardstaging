import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The guided first board's coach marks point at real buttons, found by selector (BoardTour). A K–3
 * kid's guided board is a simple board: tldraw's toolbar gives way to the kid dock, the bar is a big
 * Help me (and Ask, while the tour points at it), and the dial waits behind More. Each coach mark's
 * anchor must be on that board too, or the mark points at whatever is in the middle of the screen.
 */

// the kid dock reads the board through tldraw's hooks: a board with the pen in hand and one page
const editor = vi.hoisted(() => ({
  getCurrentToolId: () => "draw",
  getStyleForNextShape: () => "black",
  getCanUndo: () => false,
  getPages: () => [{ id: "page:1" }],
  getCurrentPageId: () => "page:1",
}));
vi.mock("tldraw", async (importOriginal) => ({
  ...(await importOriginal<typeof import("tldraw")>()),
  useEditor: () => editor,
  useValue: (_name: string, fn: () => unknown) => fn(),
  useBreakpoint: () => 7,
}));

const { default: KidDock } = await import("@/components/kidmode/KidDock");
const { default: GrownUpMore } = await import("@/components/kidmode/GrownUpMore");
const { MORE_SELECTOR, PEN_SELECTOR } = await import("@/components/kidmode/tourAnchors");
const { ASK_BUTTON_ATTR, AskButton } = await import("@/components/live/AskButton");
const { boardToolbarView } = await import("@/components/live/toolbar");

/** Does this opening tag match one of the selector's alternatives (`[name]` or `[name="value"]`)? */
function matches(tag: string, selector: string): boolean {
  return selector.split(",").some((alt) => {
    const m = alt.trim().match(/^\[([\w.-]+)(?:="([^"]*)")?\]$/);
    if (!m) throw new Error(`not an attribute selector: ${alt}`);
    const [, name, value] = m;
    const attr = tag.match(new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>/])`));
    return attr !== null && (value === undefined || attr[1] === value);
  });
}

/** The opening tag of the button whose words are `label`. */
function buttonTag(html: string, label: string): string {
  const button = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]).find((b) => b.includes(`<span>${label}</span>`));
  if (!button) throw new Error(`no ${label} button`);
  return button.match(/^<button\b[^>]*>/)![0];
}

const openingTags = (html: string) => [...html.matchAll(/<[a-z]+\b[^>]*>/g)].map((m) => m[0]);

describe("the guided board's coach marks on the simple board", () => {
  it("1: “Grab the pen” finds the kid dock's Pen, and still tldraw's on the grown-up board", () => {
    const dock = renderToStaticMarkup(<KidDock />);
    expect(matches(buttonTag(dock, "Pen"), PEN_SELECTOR)).toBe(true);
    // only the Pen: not the colour in the dock's middle, which the old fallback landed on
    expect(openingTags(dock).filter((t) => matches(t, PEN_SELECTOR))).toHaveLength(1);
    expect(matches('<button data-testid="tools.draw">', PEN_SELECTOR)).toBe(true);
  });

  it("2: “Tap Help me” finds the simple board's big Help me", () => {
    const help = renderToStaticMarkup(<AskButton kind="help" glow={0} big onAsk={() => true} />);
    expect(matches(buttonTag(help, "Help me"), `[${ASK_BUTTON_ATTR}]`)).toBe(true);
  });

  it("2, without Help me: the dial is behind More, so it points at More", () => {
    // the dial is in More (hidden while it is closed): the help fallback goes on to More
    expect(boardToolbarView({ mode: "feedback", liveEnabled: false, liveAvailable: true, auto: true, simple: true, tour: true }).place.dial).toBe("more");
    const more = renderToStaticMarkup(
      <GrownUpMore
        open={false}
        onOpenChange={() => {}}
        simpleOn
        onSimpleChange={() => {}}
        controls={{
          dial: null,
          auto: null,
          onAutoChange: () => {},
          ask: null,
          onAsk: () => {},
          onTopic: () => {},
          status: null,
          ink: null,
          menu: { liveRunning: false, liveAvailable: true, onLiveEnabledChange: () => {}, canHelp: false, onClearMarks: () => {}, onShowModeInfo: () => {}, onReportProblem: () => {} },
        }}
      />,
    );
    const found = openingTags(more).filter((t) => matches(t, MORE_SELECTOR));
    // More's own button, the one in view while the card is closed
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^<button\b[^>]*aria-controls="grown-up-more"/);
  });

  it("3: “Tap Ask” finds Ask in the bar, which stays out of More while the tour runs", () => {
    expect(boardToolbarView({ mode: "feedback", liveEnabled: true, liveAvailable: true, auto: true, simple: true, tour: true }).place.ask).toBe("bar");
  });

  it("the tour looks for the pen and More with these selectors", () => {
    const source = fs.readFileSync(path.join(__dirname, "../BoardTour.tsx"), "utf8");
    expect(source).toMatch(/import \{[^}]*\bMORE_SELECTOR\b[^}]*\bPEN_SELECTOR\b[^}]*\} from "@\/components\/kidmode\/tourAnchors"/);
    expect(source).not.toContain(`'[data-testid="tools.draw"]'`);
  });
});
