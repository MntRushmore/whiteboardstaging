/**
 * The viewer's Ask tab (src/lib/server/adminConsole/askChat.ts): a board's chat, oldest first, read
 * with the service role only once admin_audit has the look ('board.ask'); nothing shown when the look
 * cannot be logged; a deleted board or none is missing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AdminAskChatSchema } from "@/lib/admin/contracts";
import { askTurnRows } from "@/components/adminBoard/view";
import { readBoardAsk } from "@/lib/server/adminConsole/askChat";
import { resetConsoleCaches } from "@/lib/server/adminConsole/rest";
import { ADMIN, B1, B2, consoleFake, consoleTables, deps, iso, MAYA, NOW } from "./fixtures/consoleTables";

const MIN = 60_000;

function tables() {
  const t = consoleTables();
  t.ask_messages = [
    { id: "t2", seq: 2, board_id: B1, user_id: MAYA, role: "tutor", body: "Try 7 x 4 first, then double it.", notes: ["1 problem couldn't be checked."], wrote: ["write_problems"], client_id: "m1:tutor", created_at: iso(9 * MIN) },
    { id: "t1", seq: 1, board_id: B1, user_id: MAYA, role: "user", body: "what is 7 x 8", notes: [], wrote: [], client_id: "m1", created_at: iso(9 * MIN) },
    { id: "t3", seq: 3, board_id: B2, user_id: MAYA, role: "user", body: "another board", notes: [], wrote: [], client_id: null, created_at: iso(5 * MIN) },
  ];
  return t;
}

beforeEach(() => resetConsoleCaches());

describe("readBoardAsk", () => {
  it("the board's chat, oldest first, in the contract's shape, the look logged first", async () => {
    const db = consoleFake(tables());
    const chat = await readBoardAsk(deps(db), B1, ADMIN);
    expect(AdminAskChatSchema.safeParse(chat).success).toBe(true);
    expect(chat).toEqual({
      generatedAt: new Date(NOW).toISOString(),
      boardId: B1,
      turns: [
        { id: "t1", role: "user", text: "what is 7 x 8", notes: [], wrote: [], at: iso(9 * MIN) },
        { id: "t2", role: "tutor", text: "Try 7 x 4 first, then double it.", notes: ["1 problem couldn't be checked."], wrote: ["write_problems"], at: iso(9 * MIN) },
      ],
    });
    expect(db.tables.admin_audit).toEqual([expect.objectContaining({ admin_id: ADMIN, action: "board.ask", target_kind: "board", target_id: B1, meta: { ownerId: MAYA } })]);
    const audit = db.calls.findIndex((c) => c.table === "admin_audit");
    const read = db.calls.findIndex((c) => c.table === "ask_messages");
    expect(audit).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(audit);
    expect(db.calls[read].params.get("order")).toBe("seq.asc");
  });

  it("missing for no such board and a deleted one, with nothing logged", async () => {
    const t = tables();
    t.whiteboards[1].deleted_at = iso(MIN);
    const db = consoleFake(t);
    expect(await readBoardAsk(deps(db), "c0000000-0000-4000-8000-000000000000", ADMIN)).toBeNull();
    expect(await readBoardAsk(deps(db), B2, ADMIN)).toBeNull();
    expect(db.tables.admin_audit ?? []).toEqual([]);
  });

  it("nothing is read when the look cannot be logged", async () => {
    const db = consoleFake(tables(), { fail: { admin_audit: 503 } });
    await expect(readBoardAsk(deps(db), B1, ADMIN)).rejects.toMatchObject({ name: "AuditError" });
    expect(db.calls.some((c) => c.table === "ask_messages")).toBe(false);
  });

  it("without the table, the error names Ask's migration", async () => {
    const t = tables();
    delete t.ask_messages;
    await expect(readBoardAsk(deps(consoleFake(t)), B1, ADMIN)).rejects.toMatchObject({ name: "ConsoleQueryError", what: "ask_messages", message: expect.stringContaining("20261011000000_ask_v2.sql") });
  });
});

describe("askTurnRows (the tab's rows)", () => {
  it("who said it, the text, the tutor's notes and the kinds of action it wrote", () => {
    const rows = askTurnRows(
      [
        { id: "t1", role: "user", text: "what is 7 x 8", notes: [], wrote: [], at: "2026-10-08T17:00:00Z" },
        { id: "t2", role: "tutor", text: "Double 7 x 4!", notes: ["note"], wrote: ["write_problems", "graph"], at: "2026-10-08T17:00:05Z" },
      ],
      { now: NOW, timeZone: "America/New_York" },
    );
    expect(rows[0]).toMatchObject({ who: "Student", text: "what is 7 x 8", notes: [], wrote: null });
    expect(rows[1]).toMatchObject({ who: "Tutor", notes: ["note"], wrote: "Wrote on the board: write problems, graph" });
    expect(rows[1].when).toBeTruthy();
  });
});
