/**
 * POST /api/board/draw and /api/board/draw/outcome through the real handlers, with fakes for
 * supabase-js (token verification), the `admins` lookup and OpenRouter (fetch; no paid call is ever
 * made), and the app events:
 *
 *  - admins only: 401 signed out, 404 for a signed-in non-admin (and no model is called);
 *  - the stream: `status` reading → `status` drawing → `done` with the overlay, the picture at the
 *    board's size, the reveal's strokes, timings and the cost OpenRouter reported; the bodies sent
 *    are the measured run's (the tutor's params, Reed's painter body), each with the caller's signal;
 *  - a pen-lift the tutor says needs no help is `none` and paints nothing; a voice request paints
 *    anyway; given instructions skip the tutor;
 *  - a painter reply with no picture is `{"type":"error","message":"no picture","retryable":true}`;
 *  - the client's abort reaches the upstream fetch, and the stream ends without `done`;
 *  - 413 for a picture over 1600 px, 400 for one that is not a picture, 429 past the bucket;
 *  - one `board_draw` app event a run, with no kid content in it.
 */
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  ADMIN_TOKEN: "admin.token.sig",
  STUDENT_TOKEN: "student.token.sig",
  ADMIN_ID: "11111111-2222-4333-8444-555555555555",
  STUDENT_ID: "99999999-2222-4333-8444-555555555555",
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const user =
          token === fake.ADMIN_TOKEN ? { id: fake.ADMIN_ID, email: "owner@example.com" } : token === fake.STUDENT_TOKEN ? { id: fake.STUDENT_ID, email: "student@example.com" } : null;
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid token" } };
      },
    },
    rpc: async () => ({ data: null, error: { message: "no rpc in this test" } }),
  }),
}));
vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));

import { resetServerEnvCache } from "@/lib/env";
import { logger } from "@/lib/logger";
import { BOARD_DRAW_MODELS, type BoardDrawEvent } from "@/lib/server/boardDraw/contracts";
import { recordEvent } from "@/lib/server/events";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { POST as draw } from "@/app/api/board/draw/route";
import { POST as outcome } from "@/app/api/board/draw/outcome/route";

const ENV_VARS = ["SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

const W = 360;
const H = 240;
const KID = `<g fill="none" stroke="#222" stroke-width="4" stroke-linecap="round"><path d="M40 60 L80 60 M60 40 L60 80"/><path d="M100 50 L130 50 M100 70 L130 70"/><path d="M150 40 L150 80"/></g>`;
const CIRCLE = `<circle cx="270" cy="150" r="40" fill="none" stroke="#e02020" stroke-width="5"/>`;
const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
const pngUrl = async (w: number, h: number, body: string) => `data:image/png;base64,${(await sharp(Buffer.from(svg(w, h, body))).png().toBuffer()).toString("base64")}`;

let BOARD = "";
let PAINTED = "";
const INSTRUCTIONS = "Circle the answer area at the right in red.";

type Upstream = { url: string; body: Record<string, unknown>; signal: AbortSignal | null };
let upstream: Upstream[] = [];
/** OpenRouter's replies, in order: a JSON body, or a function of the request (for the abort test). */
let replies: Array<Record<string, unknown> | ((signal: AbortSignal | null) => Promise<Response>)> = [];
/**
 * The fast tutor (asked alongside the main one, used when the main one is late or fails) has its
 * own queue and is NOT recorded in `upstream`. Unqueued, it never answers until it is stopped, so
 * the main tutor's answer is the one used, as when it answers inside TUTOR_PREFER_MS.
 */
let fastReplies: Array<Record<string, unknown> | ((signal: AbortSignal | null) => Promise<Response>)> = [];
let fastAsked = 0;
const neverAnswers = (signal: AbortSignal | null) =>
  new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("aborted", "AbortError")), { once: true }));

const tutorReply = (needsHelp: boolean, instructions = INSTRUCTIONS) => ({
  choices: [{ message: { role: "assistant", content: JSON.stringify({ needsHelp, instructions: needsHelp ? instructions : "" }) } }],
  usage: { cost: 0.0012 },
});
const painterReply = (url: string | null) => ({
  choices: [{ message: { role: "assistant", content: url ? "" : "No help needed: https://i.imgur.com/removed.png", ...(url ? { images: [{ type: "image_url", image_url: { url } }] } : {}) } }],
  usage: { cost: 0.0345 },
});

function post(path: string, body: unknown, token: string | null = fake.ADMIN_TOKEN, signal?: AbortSignal): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
}

async function lines(res: Response): Promise<BoardDrawEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as BoardDrawEvent);
}

const drawEvents = () => vi.mocked(recordEvent).mock.calls.map(([e]) => e).filter((e) => e.kind === "board_draw");

beforeEach(async () => {
  for (const name of ENV_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.RATE_LIMIT_BACKEND = "memory";
  resetServerEnvCache();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  vi.mocked(recordEvent).mockReset();
  BOARD ||= await pngUrl(W, H, KID);
  PAINTED ||= await pngUrl(W, H, KID + CIRCLE);
  upstream = [];
  replies = [];
  fastReplies = [];
  fastAsked = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rest/v1/admins")) return Response.json(url.includes(fake.ADMIN_ID) ? [{ user_id: fake.ADMIN_ID }] : []);
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        const signal = init?.signal ?? null;
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (body.model === BOARD_DRAW_MODELS.tutorFast) {
          fastAsked++;
          const fastNext = fastReplies.shift() ?? neverAnswers;
          return typeof fastNext === "function" ? fastNext(signal) : Response.json(fastNext);
        }
        upstream.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown>, signal });
        const next = replies.shift();
        if (!next) throw new Error("no OpenRouter reply queued");
        return typeof next === "function" ? next(signal) : Response.json(next);
      }
      throw new Error(`unexpected fetch in this test: ${url}`);
    }),
  );
  logger.level = "silent";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
  logger.level = process.env.LOG_LEVEL || "info";
});

const RUN = () => ({ image: BOARD, mode: "feedback", source: "auto", clientRunId: "client-run-1", boardId: "33333333-2222-4333-8444-555555555555" });

describe("POST /api/board/draw: who may", () => {
  it("401 signed out, 404 for a signed-in student; no model is called", async () => {
    expect((await draw(post("/api/board/draw", RUN(), null))).status).toBe(401);
    const res = await draw(post("/api/board/draw", RUN(), fake.STUDENT_TOKEN));
    expect(res.status).toBe(404);
    expect(upstream).toHaveLength(0);
  });
});

describe("POST /api/board/draw: a run", () => {
  it("streams reading → drawing → done, with the overlay, the picture at the board's size and the reveal's strokes", async () => {
    replies = [tutorReply(true), painterReply(PAINTED)];
    const res = await draw(post("/api/board/draw", RUN()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/x-ndjson/);
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const ev = await lines(res);
    expect(ev.map((e) => e.type)).toEqual(["status", "status", "done"]);
    expect(ev[0]).toEqual({ type: "status", stage: "reading", runId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(ev[1]).toEqual({ type: "status", stage: "drawing", instructions: INSTRUCTIONS });
    const done = ev[2] as Extract<BoardDrawEvent, { type: "done" }>;
    expect([done.width, done.height]).toEqual([W, H]);
    expect(done.instructions).toBe(INSTRUCTIONS);
    expect(done.costUsd).toBeCloseTo(0.0357, 6);
    expect(Object.keys(done.timings).sort()).toEqual(["diffMs", "paintMs", "totalMs", "traceMs", "tutorMs"]);
    expect(done.timings.totalMs).toBeGreaterThanOrEqual(done.timings.diffMs + done.timings.traceMs);
    for (const key of ["overlay", "picture"] as const) {
      expect(done[key]).toMatch(/^data:image\/png;base64,/);
      const meta = await sharp(Buffer.from(done[key].split(",")[1], "base64")).metadata();
      expect([meta.width, meta.height], key).toEqual([W, H]);
    }
    expect((await sharp(Buffer.from(done.overlay.split(",")[1], "base64")).metadata()).hasAlpha).toBe(true);
    // the red circle, traced: a stroke or a few around (270, 150), in the overlay's pixels
    expect(done.strokes.length).toBeGreaterThanOrEqual(1);
    const xs = done.strokes.flatMap((s) => s.points.filter((_, i) => i % 2 === 0));
    expect(Math.min(...xs)).toBeGreaterThan(220);
    expect(Math.max(...xs)).toBeLessThan(320);
  });

  it("sends the measured run's bodies: the tutor's params, then Reed's painter body with the instructions, each with the caller's signal", async () => {
    replies = [tutorReply(true), painterReply(PAINTED)];
    await lines(await draw(post("/api/board/draw", { ...RUN(), mode: "suggest" })));
    expect(upstream).toHaveLength(2);
    const [tutor, painter] = upstream;
    expect(tutor.body).toMatchObject({
      model: BOARD_DRAW_MODELS.tutor,
      temperature: 0,
      max_tokens: 1500,
      reasoning: { effort: "minimal" },
      provider: { sort: "latency", data_collection: "deny", zdr: true },
      usage: { include: true },
    });
    const tutorUser = (tutor.body.messages as Array<{ role: string; content: Array<{ type: string; text?: string }> }>)[1];
    expect(tutorUser.content[0].type).toBe("image_url");
    expect(tutorUser.content[1].text).toContain('The board\'s assistance mode is "suggest".');
    expect(painter.body).toMatchObject({
      model: BOARD_DRAW_MODELS.painter,
      modalities: ["image", "text"],
      reasoning_effort: "minimal",
      provider: { sort: "latency", data_collection: "deny", zdr: true },
      usage: { include: true },
    });
    const painterParts = (painter.body.messages as Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }>)[0].content;
    expect(painterParts[0]).toEqual({ type: "image_url", image_url: { url: BOARD } });
    expect(painterParts[1].text).toContain("- ALWAYS generate an updated image of the canvas");
    expect(painterParts[1].text?.endsWith(`Additional drawing instructions from the tutor:\n${INSTRUCTIONS}`)).toBe(true);
    for (const call of upstream) expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it("logs one board_draw event: the numbers, never the kid's content", async () => {
    replies = [tutorReply(true), painterReply(PAINTED)];
    await lines(await draw(post("/api/board/draw", RUN())));
    const events = drawEvents();
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e).toMatchObject({ source: "server", level: "info", kind: "board_draw", code: "done", route: "/api/board/draw", userId: fake.ADMIN_ID, boardId: "33333333-2222-4333-8444-555555555555" });
    expect(e.meta).toMatchObject({ mode: "feedback", source: "auto", ok: true, result: "done", needsHelp: true, tutorSkipped: false, costUsd: 0.0357, tutorModel: BOARD_DRAW_MODELS.tutor, painterModel: BOARD_DRAW_MODELS.painter, instructionsChars: INSTRUCTIONS.length });
    for (const key of ["tutorMs", "paintMs", "diffMs", "traceMs", "totalMs"]) expect(typeof e.meta?.[key], key).toBe("number");
    const all = JSON.stringify(e);
    expect(all).not.toContain(INSTRUCTIONS);
    expect(all).not.toContain("data:image");
  });

  it("a pen-lift that needs no help is `none`, and nothing is painted", async () => {
    replies = [tutorReply(false)];
    const ev = await lines(await draw(post("/api/board/draw", RUN())));
    expect(ev.map((e) => e.type)).toEqual(["status", "none"]);
    expect(upstream).toHaveLength(1);
    expect(drawEvents()[0]).toMatchObject({ level: "info", code: "none" });
    expect(drawEvents()[0].meta).toMatchObject({ needsHelp: false, result: "none" });
  });

  it("asks the fast tutor alongside, and paints its instructions when the main tutor fails", async () => {
    const FAST = "Arrow to the 25 from the right: what is 20 - 5?";
    replies = [{ error: { code: 502, message: "busy" } }, painterReply(PAINTED)];
    fastReplies = [tutorReply(true, FAST)];
    const ev = await lines(await draw(post("/api/board/draw", RUN())));
    expect(fastAsked).toBe(1);
    expect(ev.map((e) => e.type)).toEqual(["status", "status", "done"]);
    expect(ev[1]).toEqual({ type: "status", stage: "drawing", instructions: FAST });
    expect(drawEvents()[0].meta).toMatchObject({ result: "done", tutorModel: BOARD_DRAW_MODELS.tutorFast });
  });

  it("paints the fast tutor's instructions when the main tutor is late, and stops the main one", async () => {
    const FAST = "Write ÷2 to the right of 2x = 12.";
    replies = [
      (signal) =>
        new Promise<Response>((resolve, reject) => {
          const t = setTimeout(() => resolve(Response.json(tutorReply(true))), 8_000);
          signal?.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("aborted", "AbortError"))), { once: true });
        }),
      painterReply(PAINTED),
    ];
    fastReplies = [tutorReply(true, FAST)];
    const ev = await lines(await draw(post("/api/board/draw", RUN())));
    expect(ev[1]).toEqual({ type: "status", stage: "drawing", instructions: FAST });
    expect(upstream[0].signal?.aborted).toBe(true);
    expect(drawEvents()[0].meta).toMatchObject({ tutorModel: BOARD_DRAW_MODELS.tutorFast });
  }, 15_000);

  it("a voice request paints even when the tutor sees no need (Reed's prompt alone)", async () => {
    replies = [tutorReply(false), painterReply(PAINTED)];
    const ev = await lines(await draw(post("/api/board/draw", { ...RUN(), source: "voice" })));
    expect(ev.map((e) => e.type)).toEqual(["status", "status", "done"]);
    expect(ev[1]).toEqual({ type: "status", stage: "drawing", instructions: "" });
    const text = (upstream[1].body.messages as Array<{ content: Array<{ text?: string }> }>)[0].content[1].text ?? "";
    expect(text).not.toContain("Additional drawing instructions");
  });

  it("given instructions skip the tutor and are painted directly", async () => {
    replies = [painterReply(PAINTED)];
    const ev = await lines(await draw(post("/api/board/draw", { ...RUN(), source: "voice", instructions: "Write x = 4 under the last line." })));
    expect(ev.map((e) => e.type)).toEqual(["status", "status", "done"]);
    expect(ev[1]).toEqual({ type: "status", stage: "drawing", instructions: "Write x = 4 under the last line." });
    expect(upstream).toHaveLength(1);
    expect(upstream[0].body.model).toBe(BOARD_DRAW_MODELS.painter);
    expect((ev[2] as Extract<BoardDrawEvent, { type: "done" }>).timings.tutorMs).toBe(0);
    expect(drawEvents()[0].meta).toMatchObject({ tutorSkipped: true, needsHelp: null, tutorModel: null });
  });

  it("a painter reply with no picture is a retryable `no picture` error (a URL in its text is never used)", async () => {
    replies = [tutorReply(true), painterReply(null)];
    const ev = await lines(await draw(post("/api/board/draw", RUN())));
    expect(ev.at(-1)).toEqual({ type: "error", message: "no picture", retryable: true });
    expect(drawEvents()[0]).toMatchObject({ level: "error", code: "no_picture" });
  });

  it("an upstream failure is an error line: 5xx retryable, 4xx not", async () => {
    replies = [() => Promise.resolve(Response.json({ error: { message: "overloaded" } }, { status: 503 }))];
    fastReplies = [() => Promise.resolve(Response.json({ error: { message: "overloaded" } }, { status: 503 }))]; // both tutors down
    let ev = await lines(await draw(post("/api/board/draw", RUN())));
    expect(ev.at(-1)).toMatchObject({ type: "error", retryable: true });
    replies = [tutorReply(true), () => Promise.resolve(Response.json({ error: { message: "bad image" } }, { status: 400 }))];
    ev = await lines(await draw(post("/api/board/draw", RUN())));
    expect(ev.at(-1)).toMatchObject({ type: "error", retryable: false });
    expect(drawEvents().at(-1)).toMatchObject({ level: "error", code: "upstream" });
    expect(drawEvents().at(-1)?.meta).toMatchObject({ upstreamStatus: 400 });
  });

  it("the client's abort reaches the painter's fetch, and the stream ends without `done`", async () => {
    let painterSignal: AbortSignal | null = null;
    replies = [
      tutorReply(true),
      (signal) =>
        new Promise<Response>((_, reject) => {
          painterSignal = signal;
          signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("aborted", "AbortError")), { once: true });
        }),
    ];
    const client = new AbortController();
    const res = await draw(post("/api/board/draw", RUN(), fake.ADMIN_TOKEN, client.signal));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    while (!seen.includes('"stage":"drawing"')) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += decoder.decode(value);
    }
    await vi.waitFor(() => expect(painterSignal).not.toBeNull());
    client.abort();
    await vi.waitFor(() => expect(painterSignal?.aborted).toBe(true));
    await vi.waitFor(() => expect(drawEvents()).toHaveLength(1));
    expect(drawEvents()[0]).toMatchObject({ level: "info", code: "aborted" });
    expect(seen).not.toContain('"type":"done"');
    await reader.cancel().catch(() => undefined);
  });
});

describe("POST /api/board/draw: what is refused", () => {
  it("413 for a picture longer than 1600 px; 400 for one that is not a picture, or a bad body", async () => {
    const big = await pngUrl(1700, 200, "");
    const res = await draw(post("/api/board/draw", { ...RUN(), image: big }));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { reason: string }).reason).toBe("image_too_large");
    expect((await draw(post("/api/board/draw", { ...RUN(), image: "data:image/png;base64,AAAAAAAA" }))).status).toBe(400);
    expect((await draw(post("/api/board/draw", { ...RUN(), mode: "off" }))).status).toBe(400);
    expect((await draw(post("/api/board/draw", { ...RUN(), instructions: "x".repeat(1001) }))).status).toBe(400);
    expect((await draw(post("/api/board/draw", { ...RUN(), clientRunId: undefined }))).status).toBe(400);
    expect(upstream).toHaveLength(0);
  });

  it("429 past 30 runs in 10 minutes", async () => {
    for (let i = 0; i < 30; i++) expect((await draw(post("/api/board/draw", {}))).status).toBe(400);
    const res = await draw(post("/api/board/draw", {}));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
  });
});

describe("POST /api/board/draw/outcome", () => {
  it("204 and a board_draw_outcome event for an admin; 404 for a student; 400 for a bad outcome", async () => {
    const res = await outcome(post("/api/board/draw/outcome", { runId: "run-1", outcome: "accepted" }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const e = vi.mocked(recordEvent).mock.calls.map(([ev]) => ev).find((ev) => ev.kind === "board_draw_outcome");
    expect(e).toMatchObject({ level: "info", code: "accepted", userId: fake.ADMIN_ID, meta: { runId: "run-1", outcome: "accepted" } });
    expect((await outcome(post("/api/board/draw/outcome", { runId: "run-1", outcome: "accepted" }, fake.STUDENT_TOKEN))).status).toBe(404);
    expect((await outcome(post("/api/board/draw/outcome", { runId: "run-1", outcome: "maybe" }))).status).toBe(400);
    expect((await outcome(post("/api/board/draw/outcome", { runId: "run-1", outcome: "shown" }, null))).status).toBe(401);
  });
});
