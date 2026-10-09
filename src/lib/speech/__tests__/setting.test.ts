import { describe, expect, it, vi } from "vitest";
import { READ_ALOUD_EVENT, READ_ALOUD_KEY } from "../contracts";
import { createReadAloudResolver, parseChoice, readAloudOn, storeChoice, storedChoice, type ChoiceStorage } from "../setting";

function memoryStorage(initial: Record<string, string> = {}): ChoiceStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("read aloud's switch", () => {
  it("parseChoice / storedChoice: on, off, or no choice", () => {
    expect(parseChoice("on")).toBe("on");
    expect(parseChoice("off")).toBe("off");
    expect(parseChoice("yes")).toBeNull();
    expect(parseChoice(null)).toBeNull();
    expect(storedChoice(memoryStorage({ [READ_ALOUD_KEY]: "off" }))).toBe("off");
    expect(storedChoice(memoryStorage())).toBeNull();
    expect(storedChoice(null)).toBeNull();
    const throwing: ChoiceStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    };
    expect(storedChoice(throwing)).toBeNull();
  });

  it("readAloudOn: the device's choice wins; without one, on for K-2 only", () => {
    expect(readAloudOn("on", 8)).toBe(true);
    expect(readAloudOn("off", 0)).toBe(false);
    expect(readAloudOn(null, 0)).toBe(true);
    expect(readAloudOn(null, 2)).toBe(true);
    expect(readAloudOn(null, 3)).toBe(false);
    expect(readAloudOn(null, null)).toBe(false);
  });

  it("storeChoice: stored, and announced to this tab", () => {
    const storage = memoryStorage();
    const target = { dispatchEvent: vi.fn(() => true) };
    storeChoice(storage, true, target);
    expect(storage.data[READ_ALOUD_KEY]).toBe("on");
    const event = target.dispatchEvent.mock.calls[0][0] as unknown as CustomEvent<string>;
    expect(event.type).toBe(READ_ALOUD_EVENT);
    expect(event.detail).toBe("on");
    storeChoice(storage, false, null);
    expect(storage.data[READ_ALOUD_KEY]).toBe("off");
  });

  it("the resolver: the stored choice without a profile read; else the grade, read once per student", async () => {
    const storage = memoryStorage();
    const grade = vi.fn(async (userId: string) => (userId === "kid" ? 1 : 6));
    let user: string | null = "kid";
    const resolve = createReadAloudResolver(() => storage, { userId: async () => user, grade });

    await expect(resolve()).resolves.toBe(true);
    await expect(resolve()).resolves.toBe(true);
    expect(grade).toHaveBeenCalledTimes(1);

    user = "older";
    await expect(resolve()).resolves.toBe(false);
    expect(grade).toHaveBeenCalledTimes(2);

    storage.data[READ_ALOUD_KEY] = "on";
    await expect(resolve()).resolves.toBe(true);
    expect(grade).toHaveBeenCalledTimes(2);
  });

  it("the resolver: signed out, or a profile that cannot be read, is off", async () => {
    const none = createReadAloudResolver(() => null, { userId: async () => null, grade: async () => 0 });
    await expect(none()).resolves.toBe(false);
    const failing = createReadAloudResolver(() => null, {
      userId: async () => "kid",
      grade: async () => {
        throw new Error("offline");
      },
    });
    await expect(failing()).resolves.toBe(false);
    const throwingSession = createReadAloudResolver(() => null, {
      userId: async () => {
        throw new Error("no session");
      },
      grade: async () => 0,
    });
    await expect(throwingSession()).resolves.toBe(false);
  });
});
