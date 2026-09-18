import { describe, expect, it } from "vitest";
import {
  canFetchSettings,
  featureLabsReducer,
  type FeatureLabsState,
} from "../featureLabsState";

type K = "stickers" | "worksheetGen";

const initial: FeatureLabsState<K> = {
  features: { stickers: false, worksheetGen: false },
  saving: null,
  failure: null,
};

describe("featureLabsReducer", () => {
  it("applies an optimistic toggle and marks it saving", () => {
    const s = featureLabsReducer(initial, { type: "toggle", key: "stickers", enabled: true });
    expect(s.features.stickers).toBe(true);
    expect(s.saving).toBe("stickers");
    expect(s.failure).toBeNull();
  });

  it("clears saving on success", () => {
    const s1 = featureLabsReducer(initial, { type: "toggle", key: "stickers", enabled: true });
    const s2 = featureLabsReducer(s1, { type: "persisted", key: "stickers" });
    expect(s2.saving).toBeNull();
    expect(s2.features.stickers).toBe(true);
  });

  it("reverts the toggle and records a retryable failure on persist error", () => {
    const s1 = featureLabsReducer(initial, { type: "toggle", key: "stickers", enabled: true });
    const s2 = featureLabsReducer(s1, {
      type: "persistFailed",
      key: "stickers",
      wanted: true,
      previous: false,
      message: "Couldn't save this setting",
    });
    expect(s2.features.stickers).toBe(false);
    expect(s2.saving).toBeNull();
    expect(s2.failure).toEqual({ key: "stickers", wanted: true, message: "Couldn't save this setting" });
  });

  it("a retry (toggle with the wanted value) clears the failure", () => {
    const failed: FeatureLabsState<K> = {
      ...initial,
      failure: { key: "stickers", wanted: true, message: "x" },
    };
    const s = featureLabsReducer(failed, { type: "toggle", key: "stickers", enabled: true });
    expect(s.failure).toBeNull();
    expect(s.features.stickers).toBe(true);
  });

  it("ignores a stale 'persisted' for a different key and merges loaded settings", () => {
    const s1 = featureLabsReducer(initial, { type: "toggle", key: "stickers", enabled: true });
    expect(featureLabsReducer(s1, { type: "persisted", key: "worksheetGen" })).toBe(s1);
    const loaded = featureLabsReducer(initial, { type: "loaded", features: { worksheetGen: true } });
    expect(loaded.features).toEqual({ stickers: false, worksheetGen: true });
    expect(featureLabsReducer(initial, { type: "dismissFailure" })).toBe(initial);
  });
});

describe("canFetchSettings", () => {
  it("only allows the user_settings request once a bearer token exists", () => {
    expect(canFetchSettings(null)).toBe(false);
    expect(canFetchSettings(undefined)).toBe(false);
    expect(canFetchSettings({ access_token: "", user: { id: "u1" } })).toBe(false);
    expect(canFetchSettings({ access_token: "tok", user: null })).toBe(false);
    expect(canFetchSettings({ access_token: "tok", user: { id: "u1" } })).toBe(true);
  });
});
