/**
 * The free board's two surfaces: the home's banner (its progress, a way back to the free board,
 * Start your free trial to the plan screen) and the board's sheet at the moment of the win (its
 * words with and without the kid's name, the ink case, one primary button and Not now). Server
 * markup, as the other component tests here; the sheet's handlers are read off its element tree.
 */
import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/profile/useOwnProfile", () => ({ useOwnProfile: () => undefined }));

const { FreeBoardBanner } = await import("../FreeBoardBanner");
const { FreeBoardSheetCard } = await import("../FreeBoardSheet");
const { FREE_BOARD_COPY, sheetName } = await import("@/lib/billing/freeBoardCopy");
const { UNLIMITED_PLAN } = await import("@/lib/billing/unlimited");
const { PLAN_PATH } = await import("@/lib/onboarding/planMarker");

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const EMOJI = /\p{Extended_Pictographic}/u;

/** Every element in a tree (the card is a plain function: its output is walked, not mounted). */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children as ReactNode)];
}
const buttons = (tree: ReactNode) => elements(tree).filter((e) => e.type === "button");

describe("the home's free-board banner", () => {
  it("shows the free board's progress, the way back to it and Start your free trial", () => {
    const html = renderToStaticMarkup(<FreeBoardBanner boardId="b-free" done={2} />);
    expect(text(html)).toContain("2 of 5 problems on your free board");
    expect(html).toContain(`href="/board/b-free"`);
    expect(html).toContain(`href="${PLAN_PATH}"`);
    expect(text(html)).toContain("Start your free trial");
    // a pip per problem, two of them done
    expect(html.match(/data-done=""/g)).toHaveLength(2);
    expect(EMOJI.test(html)).toBe(false);
  });

  it("never says more than the goal, and says no count when the problems could not be read", () => {
    expect(text(renderToStaticMarkup(<FreeBoardBanner boardId="b" done={7} />))).toContain("5 of 5 problems");
    const unknown = renderToStaticMarkup(<FreeBoardBanner boardId="b" done={null} />);
    expect(text(unknown)).toContain(FREE_BOARD_COPY.progressUnknown);
    expect(unknown).not.toContain("data-done");
    expect(text(unknown)).not.toMatch(/\d of 5/);
  });

  it("names the plan from UNLIMITED_PLAN, never a written-in price or trial", () => {
    expect(FREE_BOARD_COPY.bannerHint).toContain(UNLIMITED_PLAN.name);
    expect(FREE_BOARD_COPY.bannerHint).toContain(`${UNLIMITED_PLAN.trialDays} days`);
    expect(FREE_BOARD_COPY.terms).toContain(`$${UNLIMITED_PLAN.monthlyUsd}`);
    expect(FREE_BOARD_COPY.terms).toContain(`${UNLIMITED_PLAN.trialDays} days`);
  });
});

describe("the sheet at the moment of the win", () => {
  it("says the kid's name when the profile has one: 'Nice work, Sam! Sam finished 5 problems.'", () => {
    const html = renderToStaticMarkup(<FreeBoardSheetCard reason="problems" name="Sam" onStart={() => undefined} onNotNow={() => undefined} />);
    expect(text(html)).toContain("Nice work, Sam!");
    expect(text(html)).toContain("Sam finished 5 problems.");
    expect(text(html)).toContain("Start your free trial to keep going.");
    // the five ticks the board earned
    expect(html.match(/<li/g)).toHaveLength(5);
    expect(EMOJI.test(html)).toBe(false);
  });

  it("speaks to the student without a name", () => {
    const html = text(renderToStaticMarkup(<FreeBoardSheetCard reason="problems" name={null} onStart={() => undefined} onNotNow={() => undefined} />));
    expect(html).toContain("Nice work!");
    expect(html).toContain("You finished 5 problems.");
  });

  it("says the free board is done when the ink ran out (no ticks)", () => {
    const html = renderToStaticMarkup(<FreeBoardSheetCard reason="ink" name="Sam" onStart={() => undefined} onNotNow={() => undefined} />);
    expect(text(html)).toContain("That's your free board done.");
    expect(text(html)).toContain("Your board is saved.");
    expect(text(html)).not.toContain("Nice work");
    expect(html).not.toContain("<li");
  });

  it("has one primary Start your free trial and a Not now, each doing its own thing", () => {
    const onStart = vi.fn();
    const onNotNow = vi.fn();
    const [start, notNow, ...rest] = buttons(FreeBoardSheetCard({ reason: "problems", name: "Sam", onStart, onNotNow }));
    expect(rest).toHaveLength(0);
    expect(start.props.children).toBe("Start your free trial");
    expect(notNow.props.children).toBe("Not now");
    (start.props.onClick as () => void)();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onNotNow).not.toHaveBeenCalled();
    (notNow.props.onClick as () => void)();
    expect(onNotNow).toHaveBeenCalledTimes(1);
    // the primary one is what takes focus when the sheet opens
    expect(start.props["data-autofocus"]).toBe("");
  });

  it("shows the plan's terms, from the plan", () => {
    const html = text(renderToStaticMarkup(<FreeBoardSheetCard reason="problems" name={null} onStart={() => undefined} onNotNow={() => undefined} />));
    expect(html).toContain(FREE_BOARD_COPY.terms);
  });
});

describe("the name on the sheet", () => {
  it("is the display name's first word, when it looks like a name", () => {
    expect(sheetName("Sam")).toBe("Sam");
    expect(sheetName("  Sam Lee ")).toBe("Sam");
    expect(sheetName("Zoë")).toBe("Zoë");
    expect(sheetName(null)).toBeNull();
    expect(sheetName("")).toBeNull();
    expect(sheetName("   ")).toBeNull();
    expect(sheetName("sam@example.com")).toBeNull();
    expect(sheetName("player123")).toBeNull();
    expect(sheetName("x".repeat(25))).toBeNull();
  });
});
