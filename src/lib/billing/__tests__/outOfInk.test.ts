import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { classifyLiveFailure } from "@/components/live/errorView";
import { CHAT_COPY, chatErrorFor } from "@/components/chat/chatView";
import { LECTURE_COPY } from "@/components/lecture/lectureView";
import { BUY_INK_PATH, INK_EMPTY_MESSAGE } from "@/lib/server/billing";
import { OPEN_INK_DIALOG_EVENT, PEN_REST_MS, inkDialogWanted, openInkDialog, penIsResting } from "../inkDialog";
import { OUT_OF_INK_COPY, inkPanelMood } from "../outOfInk";

describe("the dialog's words", () => {
  it("say help needs the plan, what it costs, and that the board is safe", () => {
    expect(OUT_OF_INK_COPY.title).toBe("Help needs Agathon Unlimited");
    expect(OUT_OF_INK_COPY.offerBody).toBe("Help me, Solve and Ask come with Agathon Unlimited: free for 7 days, then $25 a month. Your board is saved.");
    expect(OUT_OF_INK_COPY.start).toBe("Start the free trial");
  });

  it("never offers ink packs: there are none to buy", () => {
    const words = Object.values(OUT_OF_INK_COPY).join(" ");
    expect(words).not.toMatch(/\bpacks?\b|get (more )?ink|buy/i);
  });

  it("the Ask and lecture panels use the same title (literals there keep the panel's module lazy)", () => {
    expect(CHAT_COPY.errors.ink).toBe(OUT_OF_INK_COPY.title);
    expect(LECTURE_COPY.errors.ink).toBe(OUT_OF_INK_COPY.title);
  });

  it("the server's 402 says the same thing in its own words, and sends the student to the plan screen", () => {
    expect(INK_EMPTY_MESSAGE).toBe("Help needs Agathon Unlimited. Start your free trial to keep going.");
    expect(BUY_INK_PATH).toBe("/welcome/plan");
  });
});

describe("inkPanelMood", () => {
  it("all set with the plan on; the free trial without a plan; the plan's own fix otherwise", () => {
    expect(inkPanelMood({ status: "trialing" })).toBe("unlimited");
    expect(inkPanelMood({ status: "active" })).toBe("unlimited");
    expect(inkPanelMood({ status: "none" })).toBe("offer");
    expect(inkPanelMood({ status: "canceled" })).toBe("offer");
    for (const status of ["repeat_trial", "past_due", "incomplete"] as const) expect(inkPanelMood({ status })).toBe("plan");
  });
});

describe("the 402 -> dialog mapping", () => {
  it("a Live 402 ink_empty becomes an 'ink' error, which asks for the dialog once", () => {
    const fields = classifyLiveFailure(new ApiError(INK_EMPTY_MESSAGE, 402, "ink_empty"), { kind: "recognize", online: true });
    expect(fields).toMatchObject({ code: "ink", message: INK_EMPTY_MESSAGE });
    expect(inkDialogWanted(fields, false)).toBe(true);
    expect(inkDialogWanted(fields, true)).toBe(false);
  });
  it("other Live failures never open it, including the provider's own outage (a 503)", () => {
    for (const err of [new ApiError("slow down", 429, "rate_limited"), new ApiError("x", 502, "upstream_error"), new ApiError("x", 503, "upstream_error"), new ApiError("x", 401, "unauthorized")]) {
      expect(inkDialogWanted(classifyLiveFailure(err, { kind: "check", online: true }), false)).toBe(false);
    }
    expect(inkDialogWanted(null, false)).toBe(false);
  });
  it("the Ask panel's 402 uses the dialog's words", () => {
    expect(chatErrorFor(new ApiError("x", 402, "ink_empty"))).toEqual({ kind: "ink", message: OUT_OF_INK_COPY.title, retry: false });
  });
});

describe("openInkDialog", () => {
  it("fires the event the board's watcher listens for", () => {
    const seen: string[] = [];
    vi.stubGlobal("window", { dispatchEvent: (e: Event) => seen.push(e.type) });
    try {
      openInkDialog();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen).toEqual([OPEN_INK_DIALOG_EVENT]);
  });
});

describe("penIsResting (never mid-stroke)", () => {
  it("waits while a pointer is down, and for a quiet moment after the last stroke", () => {
    expect(penIsResting({ pointerDown: true, lastPenAt: 0, now: 60_000 })).toBe(false);
    expect(penIsResting({ pointerDown: false, lastPenAt: 10_000, now: 10_000 + PEN_REST_MS - 1 })).toBe(false);
    expect(penIsResting({ pointerDown: false, lastPenAt: 10_000, now: 10_000 + PEN_REST_MS })).toBe(true);
  });
});
