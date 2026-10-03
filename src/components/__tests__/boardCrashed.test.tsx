import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BOARD_LOAD_COPY, BoardCrashed, BoardLoadError } from "@/components/BoardLoadError";

/** the markup with its entities read back (apostrophes are escaped) */
const render = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/**
 * The board's editor error screen. tldraw's default offers "Reset data", which runs
 * `localStorage.clear()`: the unsaved-changes backups (and the sign-in) would go with it.
 */
describe("BoardCrashed", () => {
  it("says the work is safe and offers a reload and the way home, never a reset", () => {
    const html = render(<BoardCrashed error={new Error("Cannot read properties of undefined")} />);
    expect(html).toContain(BOARD_LOAD_COPY.crashTitle);
    expect(html).toContain(BOARD_LOAD_COPY.crashBody);
    expect(html).toContain(`>${BOARD_LOAD_COPY.retry}</button>`);
    expect(html).toContain(BOARD_LOAD_COPY.back);
    expect(html).toContain("Cannot read properties of undefined");
    expect(html).not.toMatch(/reset/i);
    expect(html).not.toContain(BOARD_LOAD_COPY.errorBody);
  });

  it("leaves the load error screens as they were", () => {
    const html = render(<BoardLoadError state={{ kind: "error", message: BOARD_LOAD_COPY.errorTitle }} onRetry={() => {}} />);
    expect(html).toContain(BOARD_LOAD_COPY.errorBody);
    expect(html).toContain(`>${BOARD_LOAD_COPY.retry}</button>`);
    expect(html).not.toContain(BOARD_LOAD_COPY.crashBody);
  });
});
