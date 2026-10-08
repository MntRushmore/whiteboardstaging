/**
 * The console's boards (src/lib/server/adminConsole/boards.ts): the board list (pages, live, one
 * user's), and one board's document with its snapshot spliced in as PostgREST sent it (never parsed),
 * the look logged before anything is answered.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_LIMITS, AdminBoardDocSchema, AdminBoardListSchema } from "@/lib/admin/contracts";
import { buildBoardList, openBoardDoc, type BoardDocResult } from "@/lib/server/adminConsole/boards";
import { resetConsoleCaches } from "@/lib/server/adminConsole/rest";
import { ADMIN, B1, B2, B3, consoleFake, consoleTables, deps, iso, MAYA, NOW, SAM, SNAPSHOT_B1 } from "./fixtures/consoleTables";
import type { Row } from "./fixtures/fakeSupabase";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

beforeEach(() => resetConsoleCaches());

async function text(doc: BoardDocResult): Promise<string> {
  if (doc.kind !== "doc") throw new Error(`expected a document, got ${doc.kind}`);
  return new Response(doc.body).text();
}

describe("buildBoardList", () => {
  it("every board, newest first, in the contract's shape, the look logged", async () => {
    const db = consoleFake();
    const list = await buildBoardList(deps(db), {}, ADMIN);
    const parsed = AdminBoardListSchema.safeParse(list);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(list.boards.map((b) => b.id)).toEqual([B1, B2, B3]);
    expect(list.nextBefore).toBeNull();
    expect(list.boards[0]).toEqual({
      id: B1,
      userId: MAYA,
      ownerEmail: "maya@example.com",
      ownerName: "Maya",
      title: "Solving linear equations",
      createdAt: iso(5 * DAY),
      updatedAt: iso(2 * MIN),
      preview: "data:image/png;base64,AAAA",
      version: 12,
      sizeKb: Math.round(JSON.stringify(SNAPSHOT_B1).length / 1024),
      attempts: 3,
      // two Solve errors this week; the extension's crash is noise
      errors7d: 2,
    });
    // an empty preview is none
    expect(list.boards[1].preview).toBeNull();
    expect(list.boards[2]).toMatchObject({ ownerEmail: "sam@example.com", ownerName: null, errors7d: 0 });
    expect(db.tables.admin_audit).toEqual([expect.objectContaining({ admin_id: ADMIN, action: "boards.list", target_kind: null, target_id: null, meta: { boards: 3 } })]);
    // the rows come from the view (no data), one past the page
    const read = db.calls.find((c) => c.table === "admin_board_rows")!;
    expect(read.params.get("select")).not.toContain("data");
    expect(read.params.get("limit")).toBe(String(ADMIN_LIMITS.boardsPage + 1));
    expect(read.params.get("deleted_at")).toBe("is.null");
  });

  it("live: boards saved in the last few minutes; userId: one user's (logged against them)", async () => {
    const db = consoleFake();
    expect((await buildBoardList(deps(db), { live: true }, ADMIN)).boards.map((b) => b.id)).toEqual([B1]);
    expect((await buildBoardList(deps(db), { userId: SAM }, ADMIN)).boards.map((b) => b.id)).toEqual([B3]);
    expect(db.tables.admin_audit.at(-1)).toMatchObject({ target_kind: "user", target_id: SAM });
    const live = db.calls.find((c) => c.table === "admin_board_rows")!;
    expect(live.params.getAll("updated_at")).toEqual([`gte.${iso(ADMIN_LIMITS.liveWindowMin * MIN)}`]);
  });

  it("pages: nextBefore is the last row's updatedAt, and ?before= reads the next page", async () => {
    const tables = consoleTables();
    for (let i = 0; i < 60; i++) {
      tables.whiteboards.push({ id: `c0000000-0000-4000-8000-${String(i).padStart(12, "0")}`, user_id: SAM, title: `b${i}`, data: {}, preview: null, created_at: iso(20 * DAY), updated_at: iso(DAY + i * MIN), version: 1, deleted_at: null });
    }
    const db = consoleFake(tables);
    const first = await buildBoardList(deps(db), {}, ADMIN);
    expect(first.boards).toHaveLength(ADMIN_LIMITS.boardsPage);
    expect(first.nextBefore).toBe(first.boards.at(-1)!.updatedAt);
    const second = await buildBoardList(deps(db), { before: first.nextBefore! }, ADMIN);
    expect(second.boards).toHaveLength(63 - ADMIN_LIMITS.boardsPage);
    expect(second.nextBefore).toBeNull();
    expect(new Set([...first.boards, ...second.boards].map((b) => b.id)).size).toBe(63);
    // live and before together are two filters on updated_at
    await buildBoardList(deps(db), { live: true, before: iso(MIN) }, ADMIN);
    expect(db.calls.filter((c) => c.table === "admin_board_rows").at(-1)!.params.getAll("updated_at")).toEqual([`gte.${iso(5 * MIN)}`, `lt.${iso(MIN)}`]);
  });

  it("the look cannot be logged: nothing is answered", async () => {
    await expect(buildBoardList(deps(consoleFake(consoleTables(), { fail: { admin_audit: 503 } })), {}, ADMIN)).rejects.toMatchObject({ name: "AuditError" });
  });
});

describe("openBoardDoc", () => {
  it("the document in the contract's shape: the snapshot as stored, events, attempts, history", async () => {
    const db = consoleFake();
    const body = JSON.parse(await text(await openBoardDoc(deps(db), B1, { adminId: ADMIN })));
    const parsed = AdminBoardDocSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(body.generatedAt).toBe(new Date(NOW).toISOString());
    expect(body.snapshot).toEqual(SNAPSHOT_B1);
    expect(body.board).toMatchObject({ id: B1, version: 12, errors7d: 2, ownerEmail: "maya@example.com" });
    expect(body.events.map((e: { kind: string; noise: boolean }) => [e.kind, e.noise])).toEqual([
      ["live.solve", false],
      ["client.error", true],
      ["live.solve", false],
    ]);
    expect(body.attempts.map((a: { id: string }) => a.id)).toEqual(["a4", "a1", "a2"]);
    expect(body.history).toEqual([
      { id: 8, at: iso(5 * MIN), version: 12, reason: "pre_drop" },
      { id: 7, at: iso(30 * MIN), version: 11, reason: "interval" },
    ]);
    expect(db.tables.admin_audit).toEqual([expect.objectContaining({ admin_id: ADMIN, action: "board.view", target_kind: "board", target_id: B1, meta: { version: 12, ownerId: MAYA } })]);
    // the data is asked for as one object, never in the row read
    const snap = db.calls.find((c) => c.table === "whiteboards")!;
    expect(snap.params.get("select")).toBe("snapshot:data");
    expect(snap.headers.get("accept")).toBe("application/vnd.pgrst.object+json");
  });

  it("?since= the board's version: { unchanged } with nothing else read or logged", async () => {
    const db = consoleFake();
    expect(await openBoardDoc(deps(db), B1, { since: 12, adminId: ADMIN })).toEqual({ kind: "unchanged", version: 12 });
    expect(db.calls.map((c) => c.table)).toEqual(["admin_board_rows"]);
    expect(db.tables.admin_audit).toEqual([]);
    // an older version: the whole document
    expect((await openBoardDoc(deps(db), B1, { since: 11, adminId: ADMIN })).kind).toBe("doc");
  });

  it("no such board, or a deleted one: missing, nothing logged", async () => {
    const tables = consoleTables();
    (tables.whiteboards.find((w) => w.id === B2) as Row).deleted_at = iso(MIN);
    const db = consoleFake(tables);
    expect(await openBoardDoc(deps(db), "b9000000-0000-4000-8000-000000000009", { adminId: ADMIN })).toEqual({ kind: "missing" });
    expect(await openBoardDoc(deps(db), B2, { adminId: ADMIN })).toEqual({ kind: "missing" });
    expect(db.tables.admin_audit).toEqual([]);
  });

  it("the snapshot's bytes are spliced in as PostgREST sent them, chunk by chunk (never parsed)", async () => {
    const db = consoleFake();
    // PostgREST's own spacing (jsonb's text form), sent in small pieces after some whitespace
    const upstream = ' \n{"snapshot" : {"document": {"store": {"shape:a": {"x": 1.50}}}, "session": {"version": 0}}}';
    const chunks = upstream.match(/[\s\S]{1,7}/g)!;
    const f: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/rest/v1/whiteboards?")) {
        const enc = new TextEncoder();
        return new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }), { status: 200, headers: { "content-type": "application/vnd.pgrst.object+json" } });
      }
      return db.fetch(input, init);
    };
    const out = await text(await openBoardDoc({ ...deps(db), fetch: f }, B1, { adminId: ADMIN }));
    expect(out.endsWith(`,"snapshot" : {"document": {"store": {"shape:a": {"x": 1.50}}}, "session": {"version": 0}}}`)).toBe(true);
    expect(AdminBoardDocSchema.safeParse(JSON.parse(out)).success).toBe(true);
  });

  it("a large board streams through", async () => {
    const tables = consoleTables();
    const big = { document: { store: Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`shape:${i}`, { id: `shape:${i}`, type: "draw", props: { segments: [{ points: [{ x: i, y: i * 2, z: 0.5 }] }] } }])) } };
    (tables.whiteboards.find((w) => w.id === B1) as Row).data = big;
    const out = await text(await openBoardDoc(deps(consoleFake(tables)), B1, { adminId: ADMIN }));
    expect(out.length).toBeGreaterThan(1_000_000);
    expect(JSON.parse(out).snapshot).toEqual(big);
  });

  it("the look cannot be logged: nothing is answered", async () => {
    await expect(openBoardDoc(deps(consoleFake(consoleTables(), { fail: { admin_audit: 500 } })), B1, { adminId: ADMIN })).rejects.toMatchObject({ name: "AuditError" });
  });

  it("a read that fails names its table", async () => {
    await expect(openBoardDoc(deps(consoleFake(consoleTables(), { fail: { whiteboard_snapshots: 500 } })), B1, { adminId: ADMIN })).rejects.toMatchObject({ name: "ConsoleQueryError", what: "whiteboard_snapshots" });
    await expect(openBoardDoc(deps(consoleFake(consoleTables(), { fail: { whiteboards: 500 } })), B1, { adminId: ADMIN })).rejects.toMatchObject({ name: "ConsoleQueryError", what: "whiteboards" });
  });
});
