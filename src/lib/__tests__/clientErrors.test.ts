/**
 * The browser's error reporter (src/lib/clientErrors.ts): what one page load sends to
 * POST /api/client-errors. Each distinct error once, at most MAX_REPORTS, no noise, and never a
 * query string or hash, from the path or from any URL in the message or stack. The delivery
 * (beacon signed out, keepalive fetch with the token signed in) runs against stubbed globals.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_KIND } from "@/lib/admin/contracts";
import {
  boardIdFromPath,
  createReporter,
  createUserReporter,
  isNoise,
  MAX_MESSAGE,
  MAX_REPORTS,
  MAX_STACK,
  MAX_USER_MESSAGE,
  MAX_USER_REPORTS,
  stripUrlQueries,
  USER_REPORT_WINDOW_MS,
  userErrorCode,
  userErrorLevel,
  userErrorMessage,
  type ClientErrorReport,
  type UserErrorInput,
  type UserErrorKind,
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

  it("Safari's words for a lifted pen are noise; its other NotFoundErrors are not", () => {
    // the stack WebKit gives tldraw's setPointerCapture throwing (seen in WebKit 26.6)
    const message = "NotFoundError: The object can not be found here.";
    expect(isNoise(message, "setPointerCapture@[native code]\nsetPointerCapture@https://app.test/_next/static/chunks/a.js:1:2\nonPointerDown@https://app.test/_next/static/chunks/a.js:3:4")).toBe(true);
    // the same words from removeChild (a translation extension rewriting the DOM React owns) are a real crash
    expect(isNoise(message, "removeChild@[native code]\ncommitDeletion@https://app.test/_next/static/chunks/b.js:1:2")).toBe(false);
    expect(isNoise(message)).toBe(false);
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

// ------------------------------------------------------------------ errors a student saw

/** Every kind a surface reports (UserErrorKind): each must pass the contract's EVENT_KIND, or the route refuses the report. */
const USER_KINDS: UserErrorKind[] = [
  "live.recognize",
  "live.check",
  "live.solve",
  "live.capabilities",
  "live.chat",
  "live.lecture",
  "live.save",
  "live.load",
  "live.practice",
  "live.progress",
  "live.ink",
  "live.account",
  "live.boards",
  "live.image",
  "live.pdf",
  "live.report",
  "live.auth",
  "live.settings",
];

function userReporter(path = `/board/${BOARD}`, opts: { max?: number; windowMs?: number } = {}) {
  const sent: ClientErrorReport[] = [];
  let now = 1_000_000;
  const report = createUserReporter((r) => sent.push(r), () => ({ path, userAgent: "UA/1.0" }), { ...opts, now: () => now });
  return { sent, report, advance: (ms: number) => (now += ms) };
}

const SOLVE_ERR: UserErrorInput = { kind: "live.solve", code: "upstream", message: "Couldn't work this out" };

describe("createUserReporter", () => {
  it("sends source live, the kind, code, level and our words, with the path, board, browser and release", () => {
    const { sent, report } = userReporter();
    report(SOLVE_ERR);
    expect(sent).toEqual([
      {
        source: "live",
        kind: "live.solve",
        code: "upstream",
        level: "error",
        message: "Couldn't work this out",
        path: `/board/${BOARD}`,
        boardId: BOARD,
        userAgent: "UA/1.0",
        release: "dev",
      },
    ]);
  });

  it("every kind a surface reports passes the contract's EVENT_KIND", () => {
    for (const kind of USER_KINDS) expect(kind).toMatch(EVENT_KIND);
    const { sent, report } = userReporter("/", { max: 100 });
    for (const kind of USER_KINDS) report({ kind, code: "unknown", message: "m" });
    expect(sent.map((r) => r.kind)).toEqual(USER_KINDS);
  });

  it("refuses a kind that is not live.<what> (the route would refuse the whole report)", () => {
    const { sent, report } = userReporter();
    report({ ...SOLVE_ERR, kind: "client.error" as UserErrorKind });
    report({ ...SOLVE_ERR, kind: "live.Solve" as UserErrorKind });
    report({ ...SOLVE_ERR, kind: "live." as UserErrorKind });
    expect(sent).toEqual([]);
  });

  it(`sends the same kind + code + message once per ${USER_REPORT_WINDOW_MS / 1000} s, then again`, () => {
    const { sent, report, advance } = userReporter();
    report(SOLVE_ERR);
    report(SOLVE_ERR);
    advance(USER_REPORT_WINDOW_MS - 1);
    report(SOLVE_ERR);
    expect(sent).toHaveLength(1);
    advance(1);
    report(SOLVE_ERR);
    expect(sent).toHaveLength(2);
  });

  it("a different kind, code or message is a different error", () => {
    const { sent, report } = userReporter();
    report(SOLVE_ERR);
    report({ ...SOLVE_ERR, kind: "live.check" });
    report({ ...SOLVE_ERR, code: "timeout" });
    report({ ...SOLVE_ERR, message: "The tutor took too long to answer" });
    expect(sent).toHaveLength(4);
  });

  it("a countdown or an attempt count is one error, not one per number", () => {
    const { sent, report } = userReporter();
    report({ kind: "live.check", code: "rate_limited", message: "Slowing down — try again in 12 seconds" });
    report({ kind: "live.check", code: "rate_limited", message: "Slowing down — try again in 9 seconds" });
    report({ kind: "live.check", code: "upstream", message: "The tutor service had a hiccup — tried 2 times" });
    report({ kind: "live.check", code: "upstream", message: "The tutor service had a hiccup — tried 3 times" });
    expect(sent.map((r) => r.message)).toEqual(["Slowing down — try again in # seconds", "The tutor service had a hiccup — tried # times"]);
  });

  it(`stops after ${MAX_USER_REPORTS} reports, a budget apart from the crashes'`, () => {
    const { sent, report } = userReporter();
    for (let i = 0; i < 30; i++) report({ kind: "live.chat", code: `code_${String.fromCharCode(97 + i)}`, message: "Something went wrong. Try again." });
    expect(sent).toHaveLength(MAX_USER_REPORTS);
    expect(MAX_USER_REPORTS).toBeGreaterThan(MAX_REPORTS);
    // the crash reporter's own budget is untouched by them
    const crashes: ClientErrorReport[] = [];
    const crash = createReporter((r) => crashes.push(r), () => ({ path: "/", userAgent: "UA" }));
    for (let i = 0; i < 3; i++) crash("error", err(`crash ${i}`));
    expect(crashes).toHaveLength(3);
  });

  it("a repeat held back by the dedupe does not spend the budget", () => {
    const { sent, report } = userReporter("/", { max: 2 });
    for (let i = 0; i < 10; i++) report(SOLVE_ERR);
    report({ ...SOLVE_ERR, code: "timeout" });
    expect(sent.map((r) => r.code)).toEqual(["upstream", "timeout"]);
  });

  it("out of ink is info and a rate limit warn; a level passed overrides; anything else is an error", () => {
    const { sent, report } = userReporter();
    report({ kind: "live.solve", code: "ink", message: "You're out of ink" });
    report({ kind: "live.chat", code: "rate_limited", message: "That's a lot of requests." });
    report({ kind: "live.image", code: "inline_fallback", message: "Couldn't upload this image", level: "warn" });
    report({ kind: "live.save", code: "save_failed", message: "Couldn't save" });
    expect(sent.map((r) => [r.code, r.level])).toEqual([
      ["ink", "info"],
      ["rate_limited", "warn"],
      ["inline_fallback", "warn"],
      ["save_failed", "error"],
    ]);
  });

  it("never sends anything but the report's own fields: no stack, no detail, nothing the student typed", () => {
    const { sent, report } = userReporter(`/board/${BOARD}?q=hunter2#frag`);
    const typed = "solve 2x + 5 = 17 for my homework";
    report({ ...SOLVE_ERR, detail: typed, text: typed, stack: "Error\n at x", problem: typed } as unknown as UserErrorInput);
    expect(Object.keys(sent[0]).sort()).toEqual(["boardId", "code", "kind", "level", "message", "path", "release", "source", "userAgent"]);
    const body = JSON.stringify(sent[0]);
    expect(body).not.toContain("homework");
    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("frag");
    expect(sent[0].stack).toBeUndefined();
  });

  it("takes a board id that is a uuid, else the one in the path, else none", () => {
    const other = "11111111-2222-4333-8444-555555555555";
    const onBoard = userReporter();
    onBoard.report({ ...SOLVE_ERR, boardId: other });
    onBoard.report({ ...SOLVE_ERR, code: "x", boardId: "b1" });
    expect(onBoard.sent.map((r) => r.boardId)).toEqual([other, BOARD]);
    const home = userReporter("/account");
    home.report({ ...SOLVE_ERR, boardId: "not-a-board" });
    expect(home.sent[0]).not.toHaveProperty("boardId");
  });

  it("codes and messages the route accepts: a clean code, one line of words, cut to length, never empty", () => {
    const { sent, report } = userReporter();
    report({ kind: "live.save", code: "PG_PGRST301 (JWT)", message: "  Couldn't\n save  " });
    report({ kind: "live.save", code: "", message: "" });
    report({ kind: "live.save", code: "x".repeat(80), message: "m".repeat(2000) });
    expect(sent[0]).toMatchObject({ code: "pg_pgrst301_jwt", message: "Couldn't save" });
    expect(sent[1]).toMatchObject({ code: "unknown", message: "live.save" });
    expect(sent[2].code).toHaveLength(40);
    expect(sent[2].message).toHaveLength(MAX_USER_MESSAGE);
  });

  it("never throws: not on a bad input, not when sending does, not without a page", () => {
    const report = createUserReporter(() => {
      throw new Error("send failed");
    }, () => ({ path: "/", userAgent: "UA" }));
    expect(() => report(SOLVE_ERR)).not.toThrow();
    expect(() => report(null as unknown as UserErrorInput)).not.toThrow();
    const noPage = createUserReporter(() => {}, () => {
      throw new ReferenceError("location is not defined");
    });
    expect(() => noPage(SOLVE_ERR)).not.toThrow();
  });
});

describe("userErrorLevel / userErrorCode / userErrorMessage", () => {
  it("maps every LiveErrorCode: ink info, rate_limited warn, the rest error; each code goes through unchanged", () => {
    const codes = ["network", "unauthorized", "rate_limited", "ink", "upstream", "timeout", "unknown"] as const;
    expect(Object.fromEntries(codes.map((c) => [c, userErrorLevel(c)]))).toEqual({
      network: "error",
      unauthorized: "error",
      rate_limited: "warn",
      ink: "info",
      upstream: "error",
      timeout: "error",
      unknown: "error",
    });
    for (const c of codes) expect(userErrorCode(c)).toBe(c);
    expect(userErrorLevel(undefined)).toBe("error");
  });

  it("strips URL query strings from the words, and numbers become #", () => {
    expect(userErrorMessage("Failed at https://app.test/x?token=abc")).toBe("Failed at https://app.test/x");
    expect(userErrorMessage("Couldn't draw 2 of the 3 panels.")).toBe("Couldn't draw # of the # panels.");
  });
});

describe("reportUserError delivery", () => {
  async function fresh(): Promise<typeof import("../clientErrors")> {
    vi.resetModules();
    return import("../clientErrors");
  }

  function stubBrowser(token?: string) {
    const sendBeacon = vi.fn(() => true);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const store: Record<string, string> = token ? { "sb-abcdefgh-auth-token": JSON.stringify({ access_token: token }) } : {};
    vi.stubGlobal("location", { pathname: `/board/${BOARD}` });
    vi.stubGlobal("navigator", { userAgent: "UA/2.0", sendBeacon });
    vi.stubGlobal("localStorage", Object.assign(Object.create({ getItem: (k: string) => store[k] ?? null }), store));
    vi.stubGlobal("fetch", fetchMock);
    return { sendBeacon, fetchMock };
  }

  it("signed in: a keepalive fetch with the session's token, so the server can name the student", async () => {
    const { sendBeacon, fetchMock } = stubBrowser("aaa.bbb.ccc");
    const { reportUserError, CLIENT_ERRORS_PATH } = await fresh();
    reportUserError({ kind: "live.chat", code: "timeout", message: "The tutor took too long to answer. Try again." });
    expect(sendBeacon).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CLIENT_ERRORS_PATH);
    expect(init).toMatchObject({ method: "POST", keepalive: true, headers: { Authorization: "Bearer aaa.bbb.ccc" } });
    expect(JSON.parse(String(init.body))).toMatchObject({ source: "live", kind: "live.chat", code: "timeout", level: "error", boardId: BOARD });
    expect(String(init.body)).not.toContain("aaa.bbb.ccc");
  });

  it("signed out: a beacon", async () => {
    const { sendBeacon, fetchMock } = stubBrowser();
    const { reportUserError } = await fresh();
    reportUserError({ kind: "live.auth", code: "signin_network", message: "Can't reach the sign-in service." });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
