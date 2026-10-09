import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SPEECH_COPY } from "../copy";
import { SpeakButton } from "../SpeakButton";

describe("SpeakButton", () => {
  it("a real button with a name, an icon hidden from screen readers, and the caller's size", () => {
    const html = renderToStaticMarkup(<SpeakButton text="Try again" className="size-9" />);
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    expect(html).toContain(`aria-label="${SPEECH_COPY.replay}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("size-9");
    // the words are not in the markup: they are said, not shown twice
    expect(html).not.toContain("Try again");
  });
});
