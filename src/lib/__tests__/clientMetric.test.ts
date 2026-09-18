/**
 * clientMetric() must stay silent on production consoles yet always land in the bug-report
 * ring buffer; debug output is gated by NEXT_PUBLIC_LOG_LEVEL or window.__agathonDebug.
 * The module keeps state (buffer, console hook), so every case loads a fresh copy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type LoggerModule = typeof import("../logger");

async function freshLogger(): Promise<LoggerModule> {
  vi.resetModules();
  return import("../logger");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isClientDebugEnabled", () => {
  it("is off by default", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "info");
    const { isClientDebugEnabled } = await freshLogger();
    expect(isClientDebugEnabled()).toBe(false);
  });

  it.each(["debug", "trace"])("is on when NEXT_PUBLIC_LOG_LEVEL=%s", async (level) => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", level);
    const { isClientDebugEnabled } = await freshLogger();
    expect(isClientDebugEnabled()).toBe(true);
  });

  it("is on when window.__agathonDebug === true, and only then", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "info");
    const win: { __agathonDebug?: unknown; addEventListener: () => void } = { addEventListener: () => {} };
    vi.stubGlobal("window", win);
    const { isClientDebugEnabled } = await freshLogger();
    expect(isClientDebugEnabled()).toBe(false);
    win.__agathonDebug = "yes";
    expect(isClientDebugEnabled()).toBe(false);
    win.__agathonDebug = true;
    expect(isClientDebugEnabled()).toBe(true);
  });
});

describe("clientMetric", () => {
  it("records to the ring buffer without touching the console when debug is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "info");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { clientMetric, getClientLogs, CLIENT_METRIC_PREFIX } = await freshLogger();

    clientMetric("live.echo.total.ms", { ms: 42, provider: "mathpix", lineId: "l1" });

    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    const logs = getClientLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: "debug", args: [`${CLIENT_METRIC_PREFIX} live.echo.total.ms`, JSON.stringify({ ms: 42, provider: "mathpix", lineId: "l1" })] });
    expect(logs[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("echoes to console.debug when debug is on, recording exactly once without the console hook", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "debug");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { clientMetric, getClientLogs, CLIENT_METRIC_PREFIX } = await freshLogger();

    clientMetric("live.check.ttfa.ms", { ms: 7 });

    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(`${CLIENT_METRIC_PREFIX} live.check.ttfa.ms`, { ms: 7 });
    expect(getClientLogs()).toHaveLength(1);
  });

  it("records exactly once when the console hook is installed and debug is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "debug");
    const listeners: string[] = [];
    vi.stubGlobal("window", { addEventListener: (name: string) => listeners.push(name) });
    const original = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { clientMetric, getClientLogs, installClientLogCapture } = await freshLogger();
    installClientLogCapture();
    expect(listeners).toEqual(["error", "unhandledrejection"]);

    clientMetric("live.echo.total.ms", { ms: 1 });

    expect(original).toHaveBeenCalledTimes(1); // the hook forwards to the original console.debug
    const metrics = getClientLogs().filter((l) => l.args[0]?.includes("live.echo.total.ms"));
    expect(metrics).toHaveLength(1);
  });

  it("defaults fields to an empty object and caps the buffer at 200 entries", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "info");
    const { clientMetric, getClientLogs } = await freshLogger();
    for (let i = 0; i < 250; i++) clientMetric(`m${i}`);
    const logs = getClientLogs();
    expect(logs).toHaveLength(200);
    expect(logs[0].args).toEqual(["[metric] m50", "{}"]);
    expect(logs[199].args[0]).toBe("[metric] m249");
  });

  it("stringifies unserialisable fields instead of throwing", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "info");
    const { clientMetric, getClientLogs } = await freshLogger();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => clientMetric("cyclic", cyclic)).not.toThrow();
    expect(getClientLogs()[0].args[1]).toBe("[object Object]");
  });
});
