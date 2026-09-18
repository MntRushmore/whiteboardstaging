import { describe, expect, it } from "vitest";
import { SNAPSHOT_LIMITS } from "../../../../scripts/lib/snapshotAssets.mjs";
import { decideSave, SNAPSHOT_TOO_LARGE_MESSAGE, type SaveAction, type SaveLevel } from "../savePolicy";

const { softBytes, hardBytes } = SNAPSHOT_LIMITS;

describe("decideSave", () => {
  it("uses the shared byte budgets", () => {
    expect(softBytes).toBe(1_500_000);
    expect(hardBytes).toBe(4_000_000);
  });

  it.each<[string, number, number, boolean, SaveAction, SaveLevel]>([
    // bytes <= soft always saves regardless of inline assets or an in-flight offload
    ["empty board", 0, 0, false, "save", "ok"],
    ["small board with inline assets", 10_000, 3, false, "save", "ok"],
    ["exactly soft limit", softBytes, 5, false, "save", "ok"],
    ["small board while offload in flight", 10_000, 3, true, "save", "ok"],
    // soft < bytes <= hard
    ["over soft, no inline assets", softBytes + 1, 0, false, "save", "warn"],
    ["over soft, inline assets", softBytes + 1, 1, false, "offload-then-save", "warn"],
    ["exactly hard, inline assets", hardBytes, 2, false, "offload-then-save", "warn"],
    ["over soft, inline assets, offload already running", softBytes + 1, 1, true, "save", "warn"],
    ["exactly hard, no inline assets", hardBytes, 0, false, "save", "warn"],
    // bytes > hard
    ["over hard, inline assets", hardBytes + 1, 1, false, "offload-then-save", "error"],
    ["over hard, no inline assets", hardBytes + 1, 0, false, "refuse", "error"],
    ["over hard, inline assets, offload already running", hardBytes + 1, 4, true, "refuse", "error"],
    ["way over hard", 50_000_000, 0, false, "refuse", "error"],
  ])("%s", (_label, bytes, inlineAssets, offloadInFlight, action, level) => {
    const decision = decideSave({ bytes, inlineAssets, offloadInFlight });
    expect(decision.action).toBe(action);
    expect(decision.level).toBe(level);
    expect(decision.reason).toBeTruthy();
  });

  it("uses the user-facing message as the reason when refusing", () => {
    const decision = decideSave({ bytes: hardBytes + 1, inlineAssets: 0, offloadInFlight: false });
    expect(decision).toEqual({ action: "refuse", level: "error", reason: SNAPSHOT_TOO_LARGE_MESSAGE });
    expect(SNAPSHOT_TOO_LARGE_MESSAGE).toBe("This board is too large to save. Remove some images.");
  });

  it("defaults offloadInFlight to false", () => {
    expect(decideSave({ bytes: softBytes + 1, inlineAssets: 1 }).action).toBe("offload-then-save");
  });

  it("treats invalid numbers defensively", () => {
    expect(decideSave({ bytes: Number.NaN, inlineAssets: 0, offloadInFlight: false }).action).toBe("save");
    expect(decideSave({ bytes: -5, inlineAssets: 0, offloadInFlight: false }).action).toBe("save");
    expect(decideSave({ bytes: Number.POSITIVE_INFINITY, inlineAssets: 0, offloadInFlight: false }).action).toBe("save");
    expect(decideSave({ bytes: hardBytes + 1, inlineAssets: Number.NaN, offloadInFlight: false }).action).toBe("refuse");
    expect(decideSave({ bytes: hardBytes + 1, inlineAssets: -1, offloadInFlight: false }).action).toBe("refuse");
    expect(decideSave({ bytes: hardBytes + 1, inlineAssets: 0.5, offloadInFlight: false }).action).toBe("refuse");
  });

  it("is pure", () => {
    const input = { bytes: softBytes + 10, inlineAssets: 2, offloadInFlight: false };
    const a = decideSave(input);
    const b = decideSave(input);
    expect(a).toEqual(b);
    expect(input).toEqual({ bytes: softBytes + 10, inlineAssets: 2, offloadInFlight: false });
  });
});
