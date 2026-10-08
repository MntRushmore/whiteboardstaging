import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureMode } from "../devFixtures";

/** A browser just big enough for the switch: an address and a session store. */
function fakeWindow(search: string) {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { search },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  });
  vi.stubGlobal("document", { documentElement: { dataset: {} as Record<string, string> } });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the dev-only fixtures switch", () => {
  it("is off in production, whatever the address says", () => {
    vi.stubEnv("NODE_ENV", "production");
    fakeWindow("?fixtures=1");
    expect(fixtureMode()).toBeNull();
  });

  it("is off on the server", () => {
    expect(fixtureMode()).toBeNull();
  });

  it("in development: on with ?fixtures=1 (or empty / error), remembered for the tab, off with ?fixtures=0", () => {
    vi.stubEnv("NODE_ENV", "development");
    const store = fakeWindow("?fixtures=1");
    expect(fixtureMode()).toBe("1");
    (window.location as { search: string }).search = "";
    expect(fixtureMode()).toBe("1");
    (window.location as { search: string }).search = "?fixtures=empty";
    expect(fixtureMode()).toBe("empty");
    (window.location as { search: string }).search = "?fixtures=0";
    expect(fixtureMode()).toBeNull();
    expect(store.size).toBe(0);
  });

  it("…and dark mode with &theme=dark", () => {
    vi.stubEnv("NODE_ENV", "development");
    fakeWindow("?fixtures=1&theme=dark");
    expect(fixtureMode()).toBe("1");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
