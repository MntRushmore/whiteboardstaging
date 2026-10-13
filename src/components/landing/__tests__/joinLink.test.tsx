/**
 * Every Join Agathon on the landing page is a `JoinLink`: plain /start in the server's HTML (the page
 * stays static), and in the browser /start with the address's `?ref` and `utm_*`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const client = vi.hoisted(() => ({ on: false }));

// In the browser, useSyncExternalStore reads the client snapshot; the server render reads the server one.
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    useSyncExternalStore: <T,>(subscribe: () => () => void, get: () => T, server?: () => T) => (client.on ? get() : real.useSyncExternalStore(subscribe, get, server)),
  };
});

const { JoinLink } = await import("../JoinLink");

afterEach(() => {
  client.on = false;
  vi.unstubAllGlobals();
});

describe("JoinLink", () => {
  it("the server's HTML: plain /start", () => {
    const html = renderToStaticMarkup(<JoinLink className="pill">Join Agathon</JoinLink>);
    expect(html).toBe('<a class="pill" href="/start">Join Agathon</a>');
  });

  it("in the browser: /start with the page's ?ref and utm_* only", () => {
    vi.stubGlobal("window", { location: { search: "?ref=ABC234&utm_source=tiktok&mode=signup&code=x" } });
    client.on = true;
    const el = JoinLink({ className: "pill", children: "Join Agathon" }) as ReactElement<{ href: string; className: string }>;
    expect(el.props.href).toBe("/start?ref=ABC234&utm_source=tiktok");
    expect(el.props.className).toBe("pill");
  });
});
