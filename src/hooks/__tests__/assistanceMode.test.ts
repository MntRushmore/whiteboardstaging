import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASSISTANCE_MODE,
  assistanceModeKey,
  isAssistanceMode,
  readAssistanceMode,
  writeAssistanceMode,
} from "../useAssistanceMode";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe("assistance mode persistence (B6)", () => {
  it("defaults new boards to feedback, not off", () => {
    expect(DEFAULT_ASSISTANCE_MODE).toBe("feedback");
    expect(readAssistanceMode("b1", memoryStorage())).toBe("feedback");
    expect(readAssistanceMode("b1", null)).toBe("feedback");
  });

  it("keys the value per board", () => {
    expect(assistanceModeKey("abc")).toBe("agathon.mode.abc");
    const storage = memoryStorage();
    writeAssistanceMode("abc", "answer", storage);
    expect(storage.map.get("agathon.mode.abc")).toBe("answer");
    expect(readAssistanceMode("abc", storage)).toBe("answer");
    expect(readAssistanceMode("other", storage)).toBe("feedback");
  });

  it("round-trips every mode including off", () => {
    const storage = memoryStorage();
    for (const mode of ["off", "feedback", "suggest", "answer"] as const) {
      writeAssistanceMode("b", mode, storage);
      expect(readAssistanceMode("b", storage)).toBe(mode);
    }
  });

  it("falls back to the default on garbage or throwing storage", () => {
    expect(readAssistanceMode("b", memoryStorage({ "agathon.mode.b": "loud" }))).toBe("feedback");
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readAssistanceMode("b", broken)).toBe("feedback");
    expect(() => writeAssistanceMode("b", "suggest", broken)).not.toThrow();
    expect(isAssistanceMode("suggest")).toBe(true);
    expect(isAssistanceMode(null)).toBe(false);
  });
});
