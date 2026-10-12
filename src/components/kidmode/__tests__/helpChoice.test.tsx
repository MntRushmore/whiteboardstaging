import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ASSISTANCE_MODES, DEFAULT_ASSISTANCE_MODE } from "@/hooks/useAssistanceMode";
import { LIVE_COPY } from "@/components/live/copy";
import { boardToolbarView } from "@/components/live/toolbar";
import HelpChoice, { HELP_CHOICE_ATTR } from "../HelpChoice";
import { HELP_CHOICE_COPY, HELP_CHOICES, helpChoiceFor, modeForChoice } from "../helpChoiceView";

/**
 * The simple board's choice of how much help Help me gives: Hint, Next step, Solve it. It is the
 * classic board's help dial in a kid's words (its modes, its default, its memory), so Help me keeps
 * doing what it did, at the level picked.
 */

describe("the help choice", () => {
  it("is the dial's Feedback, Suggest and Solve, least help first, in a kid's words", () => {
    expect(HELP_CHOICES.map((c) => [c.word, c.mode])).toEqual([
      ["Hint", "feedback"],
      ["Next step", "suggest"],
      ["Solve it", "answer"],
    ]);
    for (const c of HELP_CHOICES) {
      expect(ASSISTANCE_MODES).toContain(c.mode);
      // one line a kid reads, US English, no grown-up words
      expect(c.line.length).toBeLessThanOrEqual(34);
      expect(c.line).not.toMatch(/feedback|suggest|mode|assistance/i);
    }
    // Solve it is named as the bar's big button names it in Solve
    expect(HELP_CHOICES[2].word).toBe(LIVE_COPY.ask.solve);
  });

  it("starts where the dial starts: a new board is on Hint", () => {
    expect(helpChoiceFor(DEFAULT_ASSISTANCE_MODE)?.id).toBe("hint");
  });

  it("maps both ways, and Off (a grown-up's, in More) is no kid's choice", () => {
    for (const c of HELP_CHOICES) {
      expect(helpChoiceFor(c.mode)).toBe(c);
      expect(modeForChoice(c.id)).toBe(c.mode);
    }
    expect(helpChoiceFor("off")).toBe(null);
    expect(modeForChoice("off")).toBe(null);
    expect(modeForChoice("")).toBe(null);
  });

  it("goes with Help me: wherever the bar has a Help me or Solve it, and only there", () => {
    const at = (mode: (typeof ASSISTANCE_MODES)[number]) => boardToolbarView({ mode, liveEnabled: true, liveAvailable: true, auto: true, simple: true }).askButton;
    for (const c of HELP_CHOICES) expect(at(c.mode)).not.toBe(null);
    expect(at("off")).toBe(null);
    // Help me keeps its words: Help me at Hint and Next step, Solve it at Solve it
    expect(at("feedback")).toBe("help");
    expect(at("suggest")).toBe("help");
    expect(at("answer")).toBe("solve");
  });

  it("is a button joined to Help me, named with the level picked, its menu closed until tapped", () => {
    const out = renderToStaticMarkup(<HelpChoice mode="suggest" onModeChange={vi.fn()} />);
    const button = out.match(/<button\b[^>]*>/)?.[0] ?? "";
    expect(button).toContain(`${HELP_CHOICE_ATTR}="step"`);
    expect(button).toContain(`aria-label="${HELP_CHOICE_COPY.label("Next step")}"`);
    expect(button).toContain('aria-haspopup="menu"');
    expect(button).toContain('aria-expanded="false"');
    // a 44 x 48 target, level with the bar's 48 px buttons
    expect(button).toMatch(/\bh-12\b/);
    expect(button).toMatch(/\bw-11\b/);
    // the menu is not in the page until it opens
    expect(out).not.toContain("Solve it");
  });
});
