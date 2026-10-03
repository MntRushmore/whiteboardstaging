import { beforeEach, describe, expect, it } from "vitest";
import { clearLiveError, liveStore, resetLiveStore, setLiveError } from "../liveStore";

describe("liveStore.clearLiveError", () => {
  beforeEach(() => resetLiveStore());

  it("clears any error, or with a code only an error of that code (the board drops 'ink' once ink is back)", () => {
    setLiveError({ kind: "recognize", code: "ink", message: "You're out of ink" });
    clearLiveError("upstream");
    expect(liveStore.lastError.get()?.code).toBe("ink");
    clearLiveError("ink");
    expect(liveStore.lastError.get()).toBeNull();
    setLiveError({ kind: "check", code: "upstream", message: "m" });
    clearLiveError();
    expect(liveStore.lastError.get()).toBeNull();
  });
});

describe("liveStore.setLiveError", () => {
  beforeEach(() => resetLiveStore());

  it("keeps the optional second line (detail) and stamps id/at", () => {
    const err = setLiveError({ kind: "recognize", code: "upstream", message: "m", detail: "second line", at: 5 });
    expect(err).toMatchObject({ kind: "recognize", code: "upstream", message: "m", detail: "second line", at: 5 });
    expect(err.id).toMatch(/^e_\d+$/);
    expect(liveStore.lastError.get()).toBe(err);
    const plain = setLiveError({ kind: "check", code: "unknown", message: "m" });
    expect(plain.detail).toBeUndefined();
  });
});

describe("liveStore (no image pipeline)", () => {
  it("carries no burst bookkeeping: nothing downstream waits on an idle timer any more", () => {
    expect(Object.keys(liveStore)).not.toContain("lastBurst");
  });
});
