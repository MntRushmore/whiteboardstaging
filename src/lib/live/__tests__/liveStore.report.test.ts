/**
 * Every Live error a student sees is reported for the admin page (src/lib/reportAppError.ts):
 * once per error (each `setLiveError` is a new id), as `live.<kind>` with its code and the words the
 * student was shown — nothing else of the error (its line, its detail, what it would retry).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const reported = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/reportAppError", () => ({
  reportUserError: (input: unknown) => reported.push(input),
  reportAppError: () => {},
}));

import { classifyLiveFailure } from "@/components/live/errorView";
import { ApiError } from "@/lib/api-client";
import { clearLiveError, liveStore, resetLiveStore, retryLiveError, setLiveError, type LiveErrorCode, type LiveErrorKind } from "../liveStore";

beforeEach(() => {
  resetLiveStore();
  reported.length = 0;
});

describe("setLiveError reports what the student saw", () => {
  it("once per error: live.<kind>, its code and its message, nothing else", () => {
    const err = setLiveError({ kind: "solve", code: "upstream", message: "Couldn't work this out", lineId: "l1", detail: "Drawn help is paused", userAsked: true, asked: "solve" });
    expect(liveStore.lastError.get()?.id).toBe(err.id);
    expect(reported).toEqual([{ kind: "live.solve", code: "upstream", message: "Couldn't work this out" }]);
  });

  it("each error shown is one report; clearing, retrying or reading it again is none", () => {
    setLiveError({ kind: "check", code: "timeout", message: "The tutor took too long to answer" });
    liveStore.lastError.get();
    retryLiveError();
    clearLiveError();
    expect(reported).toHaveLength(1);
    // the same failure shown again is a new error (the reporter's own dedupe holds it to one a minute)
    setLiveError({ kind: "check", code: "timeout", message: "The tutor took too long to answer" });
    expect(reported).toHaveLength(2);
  });

  it("maps every kind to live.<kind> and keeps every code", () => {
    const kinds: LiveErrorKind[] = ["capabilities", "recognize", "check", "solve"];
    const codes: LiveErrorCode[] = ["network", "unauthorized", "rate_limited", "ink", "upstream", "timeout", "unknown"];
    for (const kind of kinds) for (const code of codes) setLiveError({ kind, code, message: "m" });
    expect(reported).toHaveLength(kinds.length * codes.length);
    expect(new Set((reported as Array<{ kind: string }>).map((r) => r.kind))).toEqual(new Set(["live.capabilities", "live.recognize", "live.check", "live.solve"]));
    expect(new Set((reported as Array<{ code: string }>).map((r) => r.code))).toEqual(new Set(codes));
  });

  it("out of ink and a rate limit go with their code (ink, rate_limited), so they are reported at a lower level", () => {
    const ink = classifyLiveFailure(Object.assign(new ApiError("You're out of ink", 402, "ink_empty"), { body: { cost: 10 } }), { kind: "solve", online: true, userAsked: true });
    const limited = classifyLiveFailure(new ApiError("Too many", 429, "rate_limited", undefined, 12_000), { kind: "check", online: true });
    setLiveError(ink!);
    setLiveError(limited!);
    expect(reported).toEqual([
      { kind: "live.solve", code: "ink", message: "You're out of ink" },
      { kind: "live.check", code: "rate_limited", message: limited!.message },
    ]);
  });
});
