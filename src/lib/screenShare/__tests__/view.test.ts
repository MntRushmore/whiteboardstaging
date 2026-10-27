import { describe, expect, it } from "vitest";
import { VIEWER_STALE_MS } from "../frames";
import { SHARE_COPY, shareStatus } from "../view";

describe("the share page's status", () => {
  it("says live only while the iPad has been heard from lately", () => {
    expect(shareStatus("idle", null, 0)).toBe(SHARE_COPY.idle);
    expect(shareStatus("sharing", null, 1000)).toBe(SHARE_COPY.waiting);
    expect(shareStatus("sharing", 1000, 2000)).toBe(SHARE_COPY.live);
    expect(shareStatus("sharing", 1000, 1000 + VIEWER_STALE_MS + 1)).toBe(SHARE_COPY.waiting);
    expect(shareStatus("error", null, 0, "nope")).toBe("nope");
    expect(shareStatus("error", null, 0)).toBe(SHARE_COPY.failed);
  });
});
