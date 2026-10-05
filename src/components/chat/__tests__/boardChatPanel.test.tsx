import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BoardChat } from "../useBoardChat";

let chat: Partial<BoardChat> = {};
vi.mock("../useBoardChat", () => ({
  useBoardChat: () => ({ messages: [], busy: false, send: vi.fn(), retry: vi.fn(), weakSpot: null, practiceWeakSpots: vi.fn(), ...chat }),
}));

import { BoardChatPanel } from "../BoardChatPanel";
import { CHAT_SUGGESTIONS, WEAK_SPOTS_COPY } from "../chatView";
import type { LiveController } from "@/lib/live/contracts";

const render = () => renderToStaticMarkup(<BoardChatPanel boardId="b1" controller={{} as LiveController} onClose={() => {}} />).replace(/&#x27;/g, "'");

describe("BoardChatPanel", () => {
  beforeEach(() => {
    chat = {};
  });

  it("the Ask box's return key says send on an on-screen keyboard (return sends)", () => {
    const html = render();
    const textarea = html.match(/<textarea\b[^>]*>/)?.[0] ?? "";
    expect(textarea).toContain('enterKeyHint="send"');
  });

  it("no record to practise from: the four suggestions and no weak-spots chip", () => {
    const html = render();
    for (const s of CHAT_SUGGESTIONS) expect(html).toContain(s);
    expect(html).not.toContain(WEAK_SPOTS_COPY.chip);
  });

  it("a skill to practise: the chip comes first, a real button", () => {
    chat = { weakSpot: { id: "fractions", name: "Fractions" } };
    const html = render();
    const chip = html.indexOf(WEAK_SPOTS_COPY.chip);
    expect(chip).toBeGreaterThan(0);
    expect(chip).toBeLessThan(html.indexOf(CHAT_SUGGESTIONS[0]));
    expect(html).toContain(`<button type="button" title="${WEAK_SPOTS_COPY.chipHint}"`);
  });

  it("the chip is with the first suggestions only: gone once the chat has messages", () => {
    chat = { weakSpot: { id: "fractions", name: "Fractions" }, messages: [{ id: "1", role: "user", text: "hi" }] };
    expect(render()).not.toContain(WEAK_SPOTS_COPY.chip);
  });
});
