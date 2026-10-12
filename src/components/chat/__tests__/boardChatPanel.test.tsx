import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BoardChat } from "../useBoardChat";

let chat: Partial<BoardChat> = {};
vi.mock("../useBoardChat", () => ({
  useBoardChat: () => ({
    messages: [],
    busy: false,
    send: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    weakSpot: null,
    practiceWeakSpots: vi.fn(),
    hello: { loading: false, hello: null },
    ...chat,
  }),
}));

import { BoardChatPanel } from "../BoardChatPanel";
import { CHAT_COPY, SUGGESTIONS, WEAK_SPOTS_COPY, type ChatMessage } from "../chatView";
import type { LiveController } from "@/lib/live/contracts";

const render = (props: { tall?: boolean; onTallChange?: (t: boolean) => void } = {}) =>
  renderToStaticMarkup(<BoardChatPanel boardId="b1" controller={{} as LiveController} onClose={() => {}} {...props} />).replace(/&#x27;/g, "'");

const tutor = (state: ChatMessage["state"], text = ""): ChatMessage[] => [
  { id: "u", role: "user", text: "why is the sky blue?" },
  { id: "t", role: "tutor", text, state },
];

describe("BoardChatPanel", () => {
  beforeEach(() => {
    chat = {};
  });

  it("the Ask box's return key says send on an on-screen keyboard (return sends), and its text is never under 16 px", () => {
    const html = render();
    const textarea = html.match(/<textarea\b[^>]*>/)?.[0] ?? "";
    expect(textarea).toContain('enterKeyHint="send"');
    expect(textarea).toMatch(/text-\[17px\]/);
  });

  it("a fresh board: the friendly hello and its chips, and no weak-spots chip without a record", () => {
    const html = render();
    expect(html).toContain(CHAT_COPY.hello);
    // no grade known outside the board (no user): the high-school band
    for (const s of SUGGESTIONS.hs) expect(html).toContain(s);
    expect(html).not.toContain(WEAK_SPOTS_COPY.chip);
  });

  it("the tutor's own hello, once the saved chat is read; a placeholder while it is", () => {
    chat = { hello: { loading: false, hello: { greeting: "Welcome back, Maya!", chips: ["3 more like last time"] } } };
    expect(render()).toContain("Welcome back, Maya!");
    expect(render()).toContain("3 more like last time");
    chat = { hello: { loading: true, hello: null } };
    expect(render()).not.toContain(CHAT_COPY.hello);
  });

  it("a skill to practice: the chip comes first, a real button", () => {
    chat = { weakSpot: { id: "fractions", name: "Fractions" } };
    const html = render();
    const chip = html.indexOf(WEAK_SPOTS_COPY.chip);
    expect(chip).toBeGreaterThan(0);
    expect(chip).toBeLessThan(html.indexOf(SUGGESTIONS.hs[0]));
    expect(html).toContain(`<button type="button" title="${WEAK_SPOTS_COPY.chipHint}"`);
  });

  it("the chips are with the hello only: gone once the chat has messages", () => {
    chat = { weakSpot: { id: "fractions", name: "Fractions" }, messages: [{ id: "1", role: "user", text: "hi" }] };
    const html = render();
    expect(html).not.toContain(WEAK_SPOTS_COPY.chip);
    expect(html).not.toContain(CHAT_COPY.hello);
  });

  it("Stop while the words come; Send otherwise", () => {
    chat = { messages: tutor("streaming", "Sunlight is made of"), busy: true };
    expect(render()).toContain(`aria-label="${CHAT_COPY.stop}"`);
    chat = { messages: tutor("thinking"), busy: true };
    expect(render()).toContain(`aria-label="${CHAT_COPY.stop}"`);
    chat = { messages: tutor("writing", "Here are 5."), busy: true };
    expect(render()).not.toContain(`aria-label="${CHAT_COPY.stop}"`);
    expect(render()).toContain(`aria-label="${CHAT_COPY.send}"`);
  });

  it("a streaming reply shows its words as rich text with a caret; thinking shows the dots and the word", () => {
    chat = { messages: tutor("streaming", "Sunlight is **made** of"), busy: true };
    const html = render();
    expect(html).toContain("<strong");
    expect(html).toContain("made");
    expect(html).toMatch(/rounded-full bg-blue-500/);
    chat = { messages: tutor("thinking"), busy: true };
    expect(render()).toContain(CHAT_COPY.thinking);
  });

  it("writing on the board says so under the words", () => {
    chat = { messages: tutor("writing", "Here are 5 problems."), busy: true };
    expect(render()).toContain(CHAT_COPY.writing);
  });

  it("an error is one calm line with Try again (never red)", () => {
    chat = { messages: [{ id: "u", role: "user", text: "hi" }, { id: "t", role: "tutor", text: CHAT_COPY.errors.network, state: "error", error: { kind: "network", message: CHAT_COPY.errors.network, retry: true }, retryText: "hi" }] };
    const html = render();
    expect(html).toContain(CHAT_COPY.errors.network);
    expect(html).toContain(CHAT_COPY.retry);
    expect(html).not.toMatch(/\b(bg|text|border)-red-/);
  });

  it("44 px targets: header buttons, chips, send, Try again", () => {
    const html = render({ onTallChange: () => {} });
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(4);
    for (const b of buttons) expect(b).toMatch(/\b(size-11|min-h-11|h-11)\b/);
  });

  it("the speaker toggle and, on a bottom sheet, grow and shrink", () => {
    expect(render()).toContain(`aria-label="${CHAT_COPY.speakerOff}"`);
    expect(render()).not.toContain(CHAT_COPY.grow);
    expect(render({ tall: false, onTallChange: () => {} })).toContain(`aria-label="${CHAT_COPY.grow}"`);
    expect(render({ tall: true, onTallChange: () => {} })).toContain(`aria-label="${CHAT_COPY.shrink}"`);
  });

  it("no gradients, ever (the owner's rule)", () => {
    chat = { messages: tutor("streaming", "Hi") };
    expect(render()).not.toMatch(/gradient/i);
  });
});
