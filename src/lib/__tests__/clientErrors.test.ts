/**
 * The browser's error reporter (src/lib/clientErrors.ts): what one page load sends to
 * POST /api/client-errors. Each distinct error once, at most MAX_REPORTS, no noise, and never a
 * query string or hash, from the path or from any URL in the message or stack. The delivery
 * (beacon signed out, keepalive fetch with the token signed in) runs against stubbed globals.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boardIdFromPath,
  createReporter,
  isNoise,
  MAX_MESSAGE,
  MAX_REPORTS,
  MAX_STACK,
  stripUrlQueries,
  type ClientErrorReport,
} from "../clientErrors";

const BOARD = "0b6f8a52-3c1d-4e2f-9a7b-1c2d3e4f5a6b";

function reporter(path = "/", max?: number) {
  const sent: ClientErrorReport[] = [];
  const report = createReporter((r) => sent.push(r), () => ({ path, userAgent: "UA/1.0" }), max);
  return { sent, report };
}

/** An Error with a fixed stack, so dedupe is about content and not where the test threw it. */
function err(message: string, stack = `Error: ${message}\n    at f (https://app.test/_next/static/chunks/a.js:1:2)`, name = "Error"): Error {
  const e = new Error(message);
  e.name = name;
  e.stack = stack;
  return e;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("stripUrlQueries", () => {
  it("drops a URL's query string and hash and keeps a stack frame's :line:col", () => {
    expect(stripUrlQueries("at https://app.test/login?email=a%40b.com&password=hunter2:1:23")).toBe("at https://app.test/login:1:23");
    expect(stripUrlQueries("at f (https://app.test/_next/static/chunks/a.js?dpl=dpl_123:4:56)")).toBe("at f (https://app.test/_next/static/chunks/a.js:4:56)");
    expect(stripUrlQueries("f@https://app.test/reset-password#access_token=eyJ.x.y:9:10")).toBe("f@https://app.test/reset-password:9:10");
    expect(stripUrlQueries("Failed to fetch RSC payload for /board/x?_rsc=1abc. Falling back")).toBe("Failed to fetch RSC payload for /board/x Falling back");
  });

  it("leaves text without a URL query alone", () => {
    const stack = "TypeError: x is undefined\n    at g (https://app.test/_next/static/chunks/b.js:10:20)";
    expect(stripUrlQueries(stack)).toBe(stack);
    expect(stripUrlQueries("Why is this undefined?")).toBe("Why is this undefined?");
  });
});

describe("isNoise", () => {
  it.each([
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded",
    "Script error.",
    "AbortError: The user aborted a request.",
    "AbortError: signal is aborted without reason",
    "The operation was aborted.",
    "NotFoundError: Failed to execute 'setPointerCapture' on 'Element': No active pointer with the given id is found.",
    "",
  ])("%j is noise", (message) => {
    expect(isNoise(message)).toBe(true);
  });

  it("drops errors thrown from browser extensions", () => {
    expect(isNoise("TypeError: x", "at chrome-extension://abcdef/content.js:1:1")).toBe(true);
    expect(isNoise("TypeError: x", "at moz-extension://abcdef/content.js:1:1")).toBe(true);
    expect(isNoise("TypeError: x", "f@webkit-masked-url://hidden/:1:1")).toBe(true);
  });

  it("keeps real errors", () => {
    expect(isNoise("TypeError: Cannot read properties of undefined (reading 'id')", "at https://app.test/a.js:1:1")).toBe(false);
    expect(isNoise("TypeError: Failed to fetch")).toBe(false);
  });
});

describe("boardIdFromPath", () => {
  it("reads the board id from /board/<uuid> only", () => {
    expect(boardIdFromPath(`/board/${BOARD}`)).toBe(BOARD);
    expect(boardIdFromPath(`/board/${BOARD}/`)).toBe(BOARD);
    expect(boardIdFromPath("/board/not-a-board")).toBeUndefined();
    expect(boardIdFromPath(`/account`)).toBeUndefined();
  });
});

describe("createReporter", () => {
  it("sends one normalized report: name, path, board id, release, digest", () => {
    // release: NEXT_PUBLIC_RELEASE is inlined by next.config.ts; outside a Next build it is "dev".
    const { sent, report } = reporter(`/board/${BOARD}`);
    report("boundary", err("x is not a function", "TypeError: x is not a function\n    at h (https://app.test/c.js:3:4)", "TypeError"), "1234567890");
    expect(sent).toEqual([
      {
        source: "boundary",
        message: "TypeError: x is not a function",
        stack: "TypeError: x is not a function\n    at h (https://app.test/c.js:3:4)",
        path: `/board/${BOARD}`,
        boardId: BOARD,
        userAgent: "UA/1.0",
        release: "dev",
        digest: "1234567890",
      },
    ]);
  });

  it("never sends a query string or hash, in the path or in the message and stack", () => {
    const { sent, report } = reporter("/login?email=a%40b.com&password=hunter2#x");
    report("error", err("Failed https://app.test/login?password=hunter2", "Error\n    at https://app.test/login?email=a%40b.com&password=hunter2:1:23"));
    expect(sent[0].path).toBe("/login");
    expect(JSON.stringify(sent[0])).not.toMatch(/hunter2|a%40b\.com/);
    expect(sent[0].stack).toBe("Error\n    at https://app.test/login:1:23");
  });

  it("sends each distinct error once per page load", () => {
    const { sent, report } = reporter();
    report("error", err("boom"));
    report("error", err("boom"));
    report("boundary", err("boom")); // the same crash seen by a boundary and the window
    report("error", err("boom", "Error: boom\n    at other (https://app.test/d.js:5:6)"));
    report("rejection", err("bang"));
    expect(sent.map((r) => r.message)).toEqual(["boom", "boom", "bang"]);
    expect(sent.map((r) => r.source)).toEqual(["error", "error", "rejection"]);
  });

  it(`stops after ${MAX_REPORTS} reports`, () => {
    const { sent, report } = reporter();
    for (let i = 0; i < 25; i++) report("error", err(`error ${i}`));
    expect(sent).toHaveLength(MAX_REPORTS);
    expect(sent.at(-1)?.message).toBe(`error ${MAX_REPORTS - 1}`);
  });

  it("drops noise without spending the cap on it", () => {
    const { sent, report } = reporter("/", 2);
    const abort = new Error("The user aborted a request.");
    abort.name = "AbortError";
    report("rejection", abort);
    report("error", err("ResizeObserver loop completed with undelivered notifications."));
    report("error", err("TypeError: x", "TypeError: x\n    at chrome-extension://abc/c.js:1:1"));
    report("error", err("one"));
    report("error", err("two"));
    report("error", err("three"));
    expect(sent.map((r) => r.message)).toEqual(["one", "two"]);
  });

  it("reports whatever was thrown or rejected, not only Errors", () => {
    const { sent, report } = reporter();
    report("rejection", "plain string");
    report("rejection", undefined);
    report("rejection", { message: "an object with a message", details: "not sent" });
    expect(sent.map((r) => r.message)).toEqual(["plain string", "undefined", "an object with a message"]);
    expect(sent.every((r) => r.stack === undefined)).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("not sent");
  });

  it("truncates the message and the stack", () => {
    const { sent, report } = reporter();
    report("error", err("m".repeat(5000), "s".repeat(20_000)));
    expect(sent[0].message).toHaveLength(MAX_MESSAGE);
    expect(sent[0].stack).toHaveLength(MAX_STACK);
  });

  it("never throws, even when sending does", () => {
    const report = createReporter(() => {
      throw new Error("send failed");
    }, () => ({ path: "/", userAgent: "UA" }));
    expect(() => report("error", err("boom"))).not.toThrow();
  });
});

describe("reportClientError delivery", () => {
  type Fresh = typeof import("../clientErrors");
  async function fresh(): Promise<Fresh> {
    vi.resetModules();
    return import("../clientErrors");
  }

  function stubBrowser({ beacon = true, token }: { beacon?: boolean; token?: string } = {}) {
    const sendBeacon = vi.fn(() => beacon);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const store: Record<string, string> = token ? { "sb-abcdefgh-auth-token": JSON.stringify({ access_token: token }) } : {};
    const localStorage = Object.assign(Object.create({ getItem: (k: string) => store[k] ?? null }), store);
    vi.stubGlobal("location", { pathname: `/board/${BOARD}` });
    vi.stubGlobal("navigator", { userAgent: "UA/2.0", sendBeacon });
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("fetch", fetchMock);
    return { sendBeacon, fetchMock };
  }

  it("signed out: one beacon with the JSON report, no fetch", async () => {
    const { sendBeacon, fetchMock } = stubBrowser();
    const { reportClientError, CLIENT_ERRORS_PATH } = await fresh();
    reportClientError("error", err("boom"));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, body] = sendBeacon.mock.calls[0] as unknown as [string, string];
    expect(url).toBe(CLIENT_ERRORS_PATH);
    expect(JSON.parse(body)).toMatchObject({ source: "error", message: "boom", path: `/board/${BOARD}`, boardId: BOARD, userAgent: "UA/2.0" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to a keepalive fetch when the beacon is refused", async () => {
    const { fetchMock } = stubBrowser({ beacon: false });
    const { reportClientError, CLIENT_ERRORS_PATH } = await fresh();
    reportClientError("error", err("boom"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CLIENT_ERRORS_PATH);
    expect(init).toMatchObject({ method: "POST", keepalive: true, headers: {} });
  });

  it("signed in: a keepalive fetch carrying the session's token (a beacon cannot)", async () => {
    const { sendBeacon, fetchMock } = stubBrowser({ token: "aaa.bbb.ccc" });
    const { reportClientError } = await fresh();
    reportClientError("rejection", err("boom"));
    expect(sendBeacon).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ Authorization: "Bearer aaa.bbb.ccc" });
    expect(String(init.body)).not.toContain("aaa.bbb.ccc");
  });
});
