import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BOARD_LINES } from "@/lib/landing/boardInk";
import { MAX_KIDS } from "@/lib/family/contracts";
import { LANDING_COPY } from "@/components/landing/copy";
import { PRODUCT_DESCRIPTION, PRODUCT_LINE, PRODUCT_NAME, ProductLine, ProductPanel } from "../ProductPanel";

const plain = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const panel = renderToStaticMarkup(<ProductPanel />);
const panelText = plain(panel);

describe("the sign-in panel", () => {
  it("says what the landing page says", () => {
    expect(PRODUCT_LINE).toBe(LANDING_COPY.hero.title);
    expect(panelText).toContain("Math practice kids actually do.");
    expect(panelText).toContain(PRODUCT_DESCRIPTION);
    expect(panelText).toContain("Kindergarten to 8th grade, or a high school course");
    expect(panelText).toContain("A tutor that checks every line");
    expect(panelText).toContain(`One plan for up to ${MAX_KIDS} kids, each with their own profile`);
  });

  it("is in US English, with no old claims, prices or trial lengths", () => {
    expect(panelText).not.toMatch(/maths|practise|in its own hand|graphs|proofs|writes back/i);
    expect(panelText).not.toMatch(/\$\d|\d+ days?|free (week|month)/i);
  });

  it("draws the hero's real ink: three lines, two check marks and a circle, with the board's words", () => {
    const lines = BOARD_LINES.slice(0, 3);
    for (const line of lines) {
      for (const stroke of [...line.kid, line.mark.stroke]) expect(panel).toContain(`d="${stroke.d}"`);
    }
    expect(lines.map((line) => line.mark.kind)).toEqual(["tick", "ring", "tick"]);
    expect(panelText).toContain("So close!");
    expect(panelText).toContain("Try that step again.");
    expect(panel).toContain('role="img"');
  });

  it("keeps the compact line in step with the headline", () => {
    const text = plain(renderToStaticMarkup(<ProductLine />));
    expect(text).toContain(PRODUCT_NAME);
    expect(text).toContain(PRODUCT_LINE);
  });
});
