import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NOW_YOU_TRY_COPY } from "@/lib/learning/nowYouTry";
import { NowYouTryOffer } from "../NowYouTry";

const offer = { attemptId: "A", problem: ["3x + 4 = 19"], since: 0 };
const render = (bottom = 64) => renderToStaticMarkup(<NowYouTryOffer offer={offer} bottom={bottom} onTake={vi.fn()} onDismiss={vi.fn()} />);

describe("Now you try: the pill", () => {
  it("one big button and a small Not now, both real buttons with names", () => {
    const html = render();
    expect(html).toContain(`aria-label="${NOW_YOU_TRY_COPY.region}"`);
    expect(html).toContain('role="group"');
    expect(html).toContain(NOW_YOU_TRY_COPY.go);
    expect(html).toContain(NOW_YOU_TRY_COPY.notNow);
    expect(html).toContain(`aria-label="${NOW_YOU_TRY_COPY.goLabel}"`);
    expect(html).toContain(`aria-label="${NOW_YOU_TRY_COPY.notNowLabel}"`);
    expect(html.match(/<button\b/g)).toHaveLength(2);
  });

  it("touch targets of 48 px or more (h-14 = 56 px, h-12 = 48 px)", () => {
    const buttons = render().match(/<button\b[^>]*>/g) ?? [];
    expect(buttons[0]).toMatch(/\bh-14\b/);
    expect(buttons[1]).toMatch(/\bh-12\b/);
  });

  it("sits above tldraw's bottom row, and still animates only for those who want motion", () => {
    expect(render(64)).toContain("bottom:78px");
    expect(render(0)).toContain("bottom:calc(env(safe-area-inset-bottom, 0px) + 72px)");
    expect(render()).toContain("motion-reduce:animate-none");
  });

  it("never shows the problem's LaTeX as text (the tutor writes it on the board)", () => {
    expect(render()).not.toContain("3x + 4 = 19");
  });
});
