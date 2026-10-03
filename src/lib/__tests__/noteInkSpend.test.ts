import { afterEach, describe, expect, it, vi } from "vitest";
import { INK_SPENT_EVENT, noteInkSpend } from "@/lib/api-client";

/** Collects the INK_SPENT_EVENTs noteInkSpend dispatches, with their detail. */
function listen() {
  const seen: Array<Record<string, unknown>> = [];
  vi.stubGlobal("window", {
    dispatchEvent: (e: Event) => {
      if (e.type === INK_SPENT_EVENT) seen.push((e as CustomEvent).detail ?? {});
      return true;
    },
  });
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe("noteInkSpend (the board's meter re-reads after paid calls)", () => {
  it("a paid call that succeeded asks for a re-read", () => {
    const seen = listen();
    noteInkSpend("/api/live/recognize", "POST", new Response("{}", { status: 200 }));
    expect(seen).toEqual([{}]);
  });

  it("a 402 passes on the balance its body carries", async () => {
    const seen = listen();
    noteInkSpend("/api/live/solve", "post", Response.json({ error: "ink_empty", remaining: 4, cost: 10 }, { status: 402 }));
    await vi.waitFor(() => expect(seen).toEqual([{ remaining: 4 }]));
  });

  it("free calls, other routes and other failures say nothing", () => {
    const seen = listen();
    noteInkSpend("/api/live/recognize", "GET", new Response("{}", { status: 200 }));
    noteInkSpend("/api/config/status", "POST", new Response("{}", { status: 200 }));
    noteInkSpend("/api/live/check", "POST", new Response("{}", { status: 502 }));
    expect(seen).toEqual([]);
  });
});
