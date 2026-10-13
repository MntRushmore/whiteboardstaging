/**
 * The try board's store (src/components/try/tryModel.ts) with `fetch` stubbed and fake timers: the
 * pen's strokes become a contract-valid request (TryCheckRequestSchema), a quiet pause or the button
 * sends it, more ink supersedes a pending read, each verdict lands on its line, "Show me a step"
 * puts the tutor's line on the page and into `work`, every error answer is read by its JSON code,
 * the Join link keeps `?ref` / `utm_*`, and the first verdict writes the device's try marker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRY_API, TRY_MARKER_KEY, TRY_MAX_LINES, TRY_VERDICTS, TryCheckRequestSchema, TryHelpRequestSchema, type TryInk } from "@/lib/try/contracts";
import { SIGN_UP_HREF } from "@/lib/landing/links";
import { errorNotice, joinHref, MAX_POINTS, QUIET_MS, TryStore, VERDICTS, workOf, type TryBoardProblem, type TryState } from "../tryModel";

const PROBLEMS: TryBoardProblem[] = [
  { id: "g35-6", band: "g35", hint: "Try writing both fractions in sixths.", oneStep: false },
  { id: "g35-7", band: "g35", hint: "Multiply the tops, then the bottoms.", oneStep: false },
  { id: "k2-0", band: "k2", hint: "Hold up 3 fingers, then 4 more.", oneStep: true },
];

const INK: TryInk = {
  strokes: [
    { d: "M 0 0 L 10 10", weight: 1, atMs: 0, forMs: 120 },
    { d: "M 10 0 L 0 10", weight: 1, atMs: 180, forMs: 120 },
  ],
  width: 60,
  height: 25,
  baseline: 23,
  durationMs: 300,
};

type Answer = { status?: number; body: unknown } | "network" | "hang";

function memory() {
  const items = new Map<string, string>();
  return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
}

/** A store over a fake fetch that answers from `answers` in turn (the last one repeats). */
function setup(answers: Answer[] = [], initial: Partial<TryState> = {}, online = true) {
  const storage = memory();
  const queue = answers.slice();
  const calls: Array<{ url: string; body: unknown; signal: AbortSignal }> = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal as AbortSignal });
    const answer = queue.length > 1 ? queue.shift()! : queue[0];
    if (!answer || answer === "hang") return new Promise<Response>(() => undefined);
    if (answer === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  const world = { online };
  const store = new TryStore(PROBLEMS, { fetch, storage: () => storage, now: () => Date.now(), online: () => world.online, api: TRY_API, maxLines: TRY_MAX_LINES }, "g35", initial);
  return { store, calls, storage, world };
}

/** Write a stroke from (x0, y0) to (x1, y1) on the open line. */
function stroke(store: TryStore, x0: number, y0: number, x1: number, y1: number) {
  expect(store.penDown(x0, y0)).toBe(true);
  const steps = 8;
  store.penMove(Array.from({ length: steps }, (_, i) => ({ x: x0 + ((x1 - x0) * (i + 1)) / steps, y: y0 + ((y1 - y0) * (i + 1)) / steps })));
  store.penUp();
}

/** Let the store's awaited fetch and json settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T15:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the contract", () => {
  it("knows the contract's verdicts, and its api and line limit come from the page", () => {
    expect([...VERDICTS]).toEqual([...TRY_VERDICTS]);
    expect(MAX_POINTS).toBe(1000);
  });
});

describe("the pen and the read", () => {
  it("a line's strokes become a schema-valid request: moved to the ink's own corner, its box as bounds", async () => {
    const { store, calls } = setup([{ body: { latex: "\\frac{3}{6}", verdict: "check", note: null } }]);
    stroke(store, 40, 30, 60, 70);
    stroke(store, 70, 30, 90, 70);
    store.penDown(100, 50);
    store.penUp(); // a dot
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(calls).toHaveLength(1);
    const { url, body } = calls[0];
    expect(url).toBe(TRY_API.check);
    const parsed = TryCheckRequestSchema.parse(body);
    expect(parsed.problemId).toBe("g35-6");
    expect(parsed.work).toEqual([]);
    expect(parsed.strokes.x).toHaveLength(3);
    expect(parsed.strokes.x[0][0]).toBe(0);
    expect(parsed.strokes.y[0][0]).toBe(0);
    expect(parsed.strokes.x[2]).toEqual([60]);
    expect(parsed.bounds).toEqual({ w: 60, h: 40 });
    for (let i = 0; i < 3; i++) expect(parsed.strokes.x[i]).toHaveLength(parsed.strokes.y[i].length);
  });

  it("reads after a quiet pause, not before; new ink restarts the wait", async () => {
    const { store, calls } = setup([{ body: { latex: "7", verdict: "solved", note: null } }]);
    stroke(store, 10, 10, 30, 60);
    await vi.advanceTimersByTimeAsync(QUIET_MS - 100);
    expect(calls).toHaveLength(0);
    stroke(store, 40, 10, 50, 60);
    await vi.advanceTimersByTimeAsync(QUIET_MS - 100);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toHaveLength(1);
  });

  it("Check my line reads at once, without waiting", async () => {
    const { store, calls } = setup([{ body: { latex: "7", verdict: "solved", note: null } }]);
    stroke(store, 10, 10, 30, 60);
    void store.check();
    expect(calls).toHaveLength(1);
    await settle();
    expect(store.getState().solved).toBe("kid");
    // and the quiet pause's read never follows
    await vi.advanceTimersByTimeAsync(QUIET_MS * 2);
    expect(calls).toHaveLength(1);
  });

  it("more ink before the answer supersedes the read: its request is aborted and a late answer dropped", async () => {
    const { store, calls } = setup(["hang", { body: { latex: "\\frac{3}{6}+\\frac{2}{6}", verdict: "check", note: null } }]);
    stroke(store, 10, 10, 30, 60);
    void store.check();
    expect(store.getState().busy).toBe("reading");
    stroke(store, 40, 10, 50, 60);
    expect(calls[0].signal.aborted).toBe(true);
    expect(store.getState().busy).toBeNull();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(calls).toHaveLength(2);
    // the second read has both strokes
    expect((calls[1].body as { strokes: { x: number[][] } }).strokes.x).toHaveLength(2);
  });

  it("caps a stroke's points and skips points that do not move", () => {
    const { store } = setup();
    store.penDown(0, 0);
    store.penMove([{ x: 0.2, y: 0.2 }]);
    expect(store.getState().rows[0]).toMatchObject({ strokes: [{ x: [0], y: [0] }] });
    store.penMove(Array.from({ length: 1500 }, (_, i) => ({ x: i + 1, y: 0 })));
    const row = store.getState().rows[0];
    expect(row.kind === "kid" && row.strokes[0].x.length).toBe(MAX_POINTS);
  });
});

describe("the verdicts", () => {
  it("check: the line keeps its ink and verdict, the next line opens, the Join card opens, the marker is written", async () => {
    const { store, storage } = setup([{ body: { latex: "\\frac{3}{6}+\\frac{2}{6}", verdict: "check", note: null } }]);
    stroke(store, 10, 10, 30, 60);
    await store.check();
    const s = store.getState();
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]).toMatchObject({ kind: "kid", verdict: "check", latex: "\\frac{3}{6}+\\frac{2}{6}" });
    expect(s.rows[1]).toMatchObject({ kind: "kid", verdict: null, strokes: [] });
    expect(s.notice).toEqual({ kind: "check" });
    expect(s.joinOpen).toBe(true);
    expect(JSON.parse(storage.items.get(TRY_MARKER_KEY)!)).toEqual({ at: "2026-10-13T15:00:00.000Z", checked: true, solved: false });
    // the checked line is work for the next read
    expect(workOf(s.rows, TRY_MAX_LINES)).toEqual(["\\frac{3}{6}+\\frac{2}{6}"]);
  });

  it("solved: the finish, the Join card, and a solved marker", async () => {
    const { store, storage } = setup([{ body: { latex: "\\frac{5}{6}", verdict: "solved", note: null } }]);
    stroke(store, 10, 10, 30, 60);
    await store.check();
    expect(store.getState()).toMatchObject({ solved: "kid", joinOpen: true, notice: { kind: "solved" } });
    expect(JSON.parse(storage.items.get(TRY_MARKER_KEY)!)).toMatchObject({ checked: true, solved: true });
    // nothing more to write on
    expect(store.penDown(5, 5)).toBe(false);
  });

  it("ring: the engine's note as it is, else the problem's hint; the next pen down starts the line over", async () => {
    const note = "This follows from the circled line. Fix that one first.";
    const { store, storage } = setup([{ body: { latex: "\\frac{2}{5}", verdict: "ring", note } }, { body: { latex: "\\frac{2}{5}", verdict: "ring", note: null } }]);
    stroke(store, 10, 10, 30, 60);
    await store.check();
    expect(store.getState().notice).toEqual({ kind: "ring", nudge: note, note: true });
    expect(store.getState().rows[0]).toMatchObject({ verdict: "ring" });
    expect(store.getState().joinOpen).toBe(false);
    // the marker: tried, not checked right
    expect(JSON.parse(storage.items.get(TRY_MARKER_KEY)!)).toMatchObject({ checked: false, solved: false });
    // write again: the circled ink goes
    stroke(store, 50, 10, 70, 60);
    const row = store.getState().rows[0];
    expect(row.kind === "kid" && row.strokes).toHaveLength(1);
    expect(row).toMatchObject({ verdict: null });
    await store.check();
    expect(store.getState().notice).toEqual({ kind: "ring", nudge: PROBLEMS[0].hint, note: false });
  });

  it("Erase and try again empties the circled line", async () => {
    const { store } = setup([{ body: { latex: "\\frac{2}{5}", verdict: "ring", note: null } }]);
    stroke(store, 10, 10, 30, 60);
    await store.check();
    store.erase();
    expect(store.getState().rows[0]).toMatchObject({ strokes: [], verdict: null, ghost: null });
    expect(store.getState().notice).toBeNull();
  });

  it("unread: the ink is dropped (kept faint beside the question mark), the line is open for another go", async () => {
    const { store } = setup([{ body: { latex: "", verdict: "unread", note: null } }]);
    stroke(store, 10, 10, 30, 60);
    await store.check();
    const row = store.getState().rows[0];
    expect(row).toMatchObject({ verdict: "unread", strokes: [] });
    expect(row.kind === "kid" && row.ghost).toHaveLength(1);
    expect(store.getState().notice).toEqual({ kind: "unread" });
    stroke(store, 10, 10, 30, 60);
    expect(store.getState().rows[0]).toMatchObject({ ghost: null, verdict: null });
  });

  it("unjudged: no mark, the ink stays, and the next read takes the whole line", async () => {
    const { store, calls } = setup([{ body: { latex: "\\frac{3}{6}+", verdict: "unjudged", note: null } }]);
    stroke(store, 10, 10, 30, 60);
    await store.check();
    expect(store.getState().notice).toEqual({ kind: "unjudged" });
    expect(store.getState().rows[0]).toMatchObject({ verdict: null });
    stroke(store, 40, 10, 60, 60);
    await store.check();
    expect((calls[1].body as { strokes: { x: number[][] } }).strokes.x).toHaveLength(2);
  });

  it("the page fills up: after the last line is checked right, no new line opens", async () => {
    const { store } = setup([{ body: { latex: "x", verdict: "check", note: null } }]);
    for (let i = 0; i < TRY_MAX_LINES; i++) {
      stroke(store, 10, 10, 30, 60);
      await store.check();
    }
    expect(store.getState().rows).toHaveLength(TRY_MAX_LINES);
    expect(store.getState().notice).toEqual({ kind: "full" });
    expect(store.penDown(5, 5)).toBe(false);
  });
});

describe("Show me a step", () => {
  it("puts the tutor's line on the open line, opens the next, and its LaTeX joins the next read's work", async () => {
    const { store, calls } = setup([
      { body: { latex: "\\frac{3}{6}+\\frac{2}{6}", ink: INK, solves: false } },
      { body: { latex: "\\frac{5}{6}", verdict: "solved", note: null } },
    ]);
    await store.help();
    expect(calls[0].url).toBe(TRY_API.help);
    expect(TryHelpRequestSchema.parse(calls[0].body)).toEqual({ problemId: "g35-6", work: [] });
    const s = store.getState();
    expect(s.rows[0]).toMatchObject({ kind: "tutor", latex: "\\frac{3}{6}+\\frac{2}{6}", ink: INK });
    expect(s.rows[1]).toMatchObject({ kind: "kid", strokes: [] });
    expect(s.notice).toEqual({ kind: "helped", solves: false });
    stroke(store, 10, 10, 30, 60);
    await store.check();
    expect((calls[1].body as { work: string[] }).work).toEqual(["\\frac{3}{6}+\\frac{2}{6}"]);
  });

  it("a circled line stays above the tutor's step, as on paper", async () => {
    const { store } = setup([{ body: { latex: "\\frac{2}{5}", verdict: "ring", note: null } }, { body: { latex: "\\frac{3}{6}+\\frac{2}{6}", ink: INK, solves: false } }]);
    stroke(store, 10, 10, 30, 60);
    await store.check();
    await store.help();
    expect(store.getState().rows.map((r) => (r.kind === "kid" ? r.verdict : "tutor"))).toEqual(["ring", "tutor", null]);
    // the circled line is not work
    expect(workOf(store.getState().rows, TRY_MAX_LINES)).toEqual(["\\frac{3}{6}+\\frac{2}{6}"]);
  });

  it("a step that is the answer finishes the problem: the finish and the Join card", async () => {
    const { store } = setup([{ body: { latex: "= \\frac{5}{6}", ink: INK, solves: true } }]);
    await store.help();
    expect(store.getState()).toMatchObject({ solved: "tutor", joinOpen: true, notice: { kind: "helped", solves: true } });
    expect(store.getState().rows.at(-1)).toMatchObject({ kind: "tutor" });
  });

  it("no step: that's the answer", async () => {
    const { store } = setup([{ body: { latex: null, ink: null, solves: false } }]);
    await store.help();
    expect(store.getState().notice).toEqual({ kind: "noStep" });
    expect(store.getState().rows).toHaveLength(1);
  });
});

describe("errors, by their JSON code", () => {
  it("429 rate_limited: the breather, with its wait; reads pause until then, then come back", async () => {
    const { store, calls } = setup([{ status: 429, body: { error: "rate_limited", retryAfterMs: 120_000 } }, { body: { latex: "7", verdict: "check", note: null } }]);
    stroke(store, 10, 10, 30, 60);
    await store.check();
    expect(store.getState().notice).toEqual({ kind: "rate", retryAfterMs: 120_000 });
    // no read on a pause while paused, and the button says so again
    stroke(store, 40, 10, 50, 60);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(calls).toHaveLength(1);
    await store.check();
    expect(calls).toHaveLength(1);
    expect(store.getState().notice?.kind).toBe("rate");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(store.getState()).toMatchObject({ blockedUntil: 0, notice: null });
    await store.check();
    expect(calls).toHaveLength(2);
  });

  it("503 upstream_error (a failed read): try again, the board stays on and the line stays", async () => {
    const { store } = setup([{ status: 503, body: { error: "upstream_error" } }]);
    stroke(store, 10, 10, 30, 60);
    await store.check();
    expect(store.getState()).toMatchObject({ notice: { kind: "upstream" }, down: false, joinOpen: false });
    expect(store.getState().rows[0]).toMatchObject({ verdict: null });
  });

  it("503 unavailable: the tutor is taking a break, the Join card opens and pauses stop reading", async () => {
    const { store, calls } = setup([{ status: 503, body: { error: "unavailable" } }]);
    stroke(store, 10, 10, 30, 60);
    await store.check();
    expect(store.getState()).toMatchObject({ notice: { kind: "down" }, down: true, joinOpen: true });
    stroke(store, 40, 10, 50, 60);
    await vi.advanceTimersByTimeAsync(QUIET_MS * 2);
    expect(calls).toHaveLength(1);
    // the notice outlasts new ink
    expect(store.getState().notice).toEqual({ kind: "down" });
  });

  it("500 internal_error, an unknown code, no JSON: like a failed read; 400/403/413 invalid_request: a bug", () => {
    expect(errorNotice(500, { error: "internal_error" })).toEqual({ kind: "upstream" });
    expect(errorNotice(502, null)).toEqual({ kind: "upstream" });
    expect(errorNotice(503, { error: "something_new" })).toEqual({ kind: "upstream" });
    expect(errorNotice(400, { error: "invalid_request" })).toEqual({ kind: "invalid" });
    expect(errorNotice(403, { error: "invalid_request" })).toEqual({ kind: "invalid" });
    expect(errorNotice(413, null)).toEqual({ kind: "invalid" });
    expect(errorNotice(429, null)).toEqual({ kind: "rate", retryAfterMs: 60_000 });
    expect(errorNotice(503, { error: "unavailable" })).toEqual({ kind: "down" });
  });

  it("offline: says so without a request, and the line waits; back online, the notice goes", async () => {
    const { store, calls, world } = setup([{ body: { latex: "7", verdict: "check", note: null } }], {}, false);
    stroke(store, 10, 10, 30, 60);
    await store.check();
    expect(calls).toHaveLength(0);
    expect(store.getState().notice).toEqual({ kind: "offline" });
    world.online = true;
    store.online();
    expect(store.getState().notice).toBeNull();
  });

  it("a request that fails on the wire: offline when the browser says so, else a failed read", async () => {
    const { store, world } = setup(["network"]);
    stroke(store, 10, 10, 30, 60);
    await store.check();
    expect(store.getState().notice).toEqual({ kind: "upstream" });
    world.online = false;
    const { store: other, world: w2 } = setup(["network"]);
    stroke(other, 10, 10, 30, 60);
    const pending = other.check();
    w2.online = false;
    await pending;
    expect(other.getState().notice).toEqual({ kind: "offline" });
  });
});

describe("problems and bands", () => {
  it("starts on the band's first problem; another problem and another band start afresh, keeping the Join card", async () => {
    const { store } = setup([{ body: { latex: "x", verdict: "check", note: null } }]);
    expect(store.getState().problemId).toBe("g35-6");
    stroke(store, 10, 10, 30, 60);
    await store.check();
    store.nextProblem();
    expect(store.getState()).toMatchObject({ problemId: "g35-7", solved: null, joinOpen: true, checkedOnce: true, notice: null });
    expect(store.getState().rows).toHaveLength(1);
    store.nextProblem();
    expect(store.getState().problemId).toBe("g35-6"); // round again
    store.selectBand("k2");
    expect(store.getState()).toMatchObject({ band: "k2", problemId: "k2-0" });
  });
});

describe("joinHref", () => {
  it("is the sign-up page, with the visit's ?ref= and utm_* kept and nothing else", () => {
    expect(joinHref("")).toBe(SIGN_UP_HREF);
    const href = joinHref("?ref=BCDF2345&utm_source=tiktok&utm_medium=video&utm_campaign=launch&utm_content=a&utm_term=b&fbclid=xyz");
    const url = new URL(href, "https://agathon.app");
    expect(url.pathname + "?mode=signup").toBe(SIGN_UP_HREF.replace(/\?.*/, "") + "?mode=signup");
    expect(url.searchParams.get("mode")).toBe("signup");
    expect(Object.fromEntries(url.searchParams)).toEqual({ mode: "signup", ref: "BCDF2345", utm_source: "tiktok", utm_medium: "video", utm_campaign: "launch", utm_content: "a", utm_term: "b" });
  });

  it("drops a value that looks like an email address", () => {
    expect(joinHref("?utm_source=someone@example.com")).toBe(SIGN_UP_HREF);
  });
});
