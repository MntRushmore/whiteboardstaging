import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../useBoardChat", () => ({
  useBoardChat: () => ({ messages: [], busy: false, send: vi.fn(), retry: vi.fn() }),
}));

import { BoardChatPanel } from "../BoardChatPanel";
import type { LiveController } from "@/lib/live/contracts";

describe("BoardChatPanel", () => {
  it("the Ask box's return key says send on an on-screen keyboard (return sends)", () => {
    const html = renderToStaticMarkup(<BoardChatPanel boardId="b1" controller={{} as LiveController} onClose={() => {}} />);
    const textarea = html.match(/<textarea\b[^>]*>/)?.[0] ?? "";
    expect(textarea).toContain('enterKeyHint="send"');
  });
});
