import { describe, expect, it, vi } from "vitest";
import { READ_ALOUD_EVENT, READ_ALOUD_KEY, readAloudKey } from "../contracts";
import { adoptDeviceChoice, createReadAloudResolver, parseChoice, readAloudOn, storeChoice, storedChoice, type ChoiceStorage } from "../setting";

function memoryStorage(initial: Record<string, string> = {}): ChoiceStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

describe("read aloud's switch", () => {
  it("parseChoice / storedChoice: on, off, or no choice, per user", () => {
    expect(parseChoice("on")).toBe("on");
    expect(parseChoice("off")).toBe("off");
    expect(parseChoice("yes")).toBeNull();
    expect(parseChoice(null)).toBeNull();
    expect(readAloudKey("kid")).toBe(`${READ_ALOUD_KEY}.kid`);
    expect(storedChoice(memoryStorage({ [readAloudKey("kid")]: "off" }), "kid")).toBe("off");
    expect(storedChoice(memoryStorage({ [readAloudKey("kid")]: "off" }), "brother")).toBeNull();
    expect(storedChoice(memoryStorage(), "kid")).toBeNull();
    expect(storedChoice(null, "kid")).toBeNull();
    const throwing: ChoiceStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    };
    expect(storedChoice(throwing, "kid")).toBeNull();
  });

  it("readAloudOn: the user's choice wins; without one, on for K-2 only", () => {
    expect(readAloudOn("on", 8)).toBe(true);
    expect(readAloudOn("off", 0)).toBe(false);
    expect(readAloudOn(null, 0)).toBe(true);
    expect(readAloudOn(null, 2)).toBe(true);
    expect(readAloudOn(null, 3)).toBe(false);
    expect(readAloudOn(null, null)).toBe(false);
  });

  it("storeChoice: stored for this user only, and announced to this tab", () => {
    const storage = memoryStorage();
    const target = { dispatchEvent: vi.fn<(event: Event) => boolean>(() => true) };
    storeChoice(storage, "kid", true, target);
    expect(storage.data).toEqual({ [readAloudKey("kid")]: "on" });
    const event = target.dispatchEvent.mock.calls[0][0] as unknown as CustomEvent<string>;
    expect(event.type).toBe(READ_ALOUD_EVENT);
    expect(event.detail).toBe("on");
    storeChoice(storage, "kid", false, null);
    expect(storage.data[readAloudKey("kid")]).toBe("off");
  });

  it("adoptDeviceChoice: the old device-wide choice moves to the first user, once", () => {
    const storage = memoryStorage({ [READ_ALOUD_KEY]: "off" });
    adoptDeviceChoice(storage, "kid");
    expect(storage.data).toEqual({ [readAloudKey("kid")]: "off" });
    adoptDeviceChoice(storage, "brother");
    expect(storedChoice(storage, "brother")).toBeNull();

    // a user with a choice of their own keeps it; junk is just removed
    const own = memoryStorage({ [READ_ALOUD_KEY]: "on", [readAloudKey("kid")]: "off" });
    adoptDeviceChoice(own, "kid");
    expect(own.data).toEqual({ [readAloudKey("kid")]: "off" });
    const junk = memoryStorage({ [READ_ALOUD_KEY]: "maybe" });
    adoptDeviceChoice(junk, "kid");
    expect(junk.data).toEqual({});
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

    storage.data[readAloudKey("older")] = "on";
    await expect(resolve()).resolves.toBe(true);
    expect(grade).toHaveBeenCalledTimes(2);
  });

  it("siblings on one tablet: one's choice never decides for the other", async () => {
    const storage = memoryStorage();
    let user = "seventhGrader";
    const resolve = createReadAloudResolver(() => storage, { userId: async () => user, grade: async (id) => (id === "kindergartner" ? 0 : 7) });

    // the 7th grader ticks it on for herself; her little brother's default (on) stays his
    storeChoice(storage, "seventhGrader", true, null);
    await expect(resolve()).resolves.toBe(true);
    user = "kindergartner";
    await expect(resolve()).resolves.toBe(true);

    // he unticks it; she still hears hers
    storeChoice(storage, "kindergartner", false, null);
    await expect(resolve()).resolves.toBe(false);
    user = "seventhGrader";
    await expect(resolve()).resolves.toBe(true);
  });

  it("the resolver takes over a device-wide choice from before, for the first student only", async () => {
    const storage = memoryStorage({ [READ_ALOUD_KEY]: "off" });
    let user = "kid";
    const resolve = createReadAloudResolver(() => storage, { userId: async () => user, grade: async () => 1 });
    await expect(resolve()).resolves.toBe(false);
    user = "sister";
    await expect(resolve()).resolves.toBe(true);
    expect(storage.data[READ_ALOUD_KEY]).toBeUndefined();
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
