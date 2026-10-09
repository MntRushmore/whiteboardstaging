/**
 * The bug inbox (src/lib/server/adminConsole/bugs.ts): reports without their screenshots, logs
 * without noise, triage (resolvedAt follows the status), and screenshots decoded to image bytes
 * (never an SVG), each look logged first.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AdminBugListSchema, AdminBugSchema } from "@/lib/admin/contracts";
import { bugLogs, bugScreenshot, buildBugList, decodeImageDataUrl, MAX_LOGS, patchBug, THREAD_BATCH, threadsFor, toAdminBug, type BugViewRow } from "@/lib/server/adminConsole/bugs";
import { reporterAddress } from "@/lib/server/adminConsole/bugReplies";
import { resetConsoleCaches, restClient } from "@/lib/server/adminConsole/rest";
import { ADMIN, B1, BUG, BUG2, consoleFake, consoleTables, deps, iso, MAYA, NOW, PNG_BASE64, SAM, uid, USERS } from "./fixtures/consoleTables";
import type { Row } from "./fixtures/fakeSupabase";

const HOUR = 3_600_000;
const MIN = 60_000;

beforeEach(() => resetConsoleCaches());

describe("bugLogs", () => {
  it("joins each line's args, drops noise, keeps the newest MAX_LOGS", () => {
    expect(bugLogs([{ level: "log", time: "t1", args: ["a", "b"] }, { level: "error", time: "t2", args: ["ResizeObserver loop limit exceeded"] }, { time: 0, args: [{ x: 1 }, 2] }, "junk", null])).toEqual([
      { level: "log", time: "t1", text: "a b" },
      { level: "log", time: "1970-01-01T00:00:00.000Z", text: '{"x":1} 2' },
    ]);
    const many = Array.from({ length: 250 }, (_, i) => ({ level: "log", time: String(i), args: [`line ${i}`] }));
    const kept = bugLogs(many);
    expect(kept).toHaveLength(MAX_LOGS);
    expect(kept[0].text).toBe("line 50");
    expect(kept.at(-1)!.text).toBe("line 249");
    expect(bugLogs("not a list")).toEqual([]);
  });
});

describe("decodeImageDataUrl", () => {
  it("decodes PNG, JPEG, WebP, GIF; refuses SVG, other types and garbage", () => {
    const png = decodeImageDataUrl(`data:image/png;base64,${PNG_BASE64}`)!;
    expect(png.contentType).toBe("image/png");
    expect([...png.bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(decodeImageDataUrl("data:image/jpeg;base64,/9j/4AAQ")!.contentType).toBe("image/jpeg");
    expect(decodeImageDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBeNull();
    expect(decodeImageDataUrl("data:text/html;base64,PGgxPg==")).toBeNull();
    expect(decodeImageDataUrl("data:image/png,raw")).toBeNull();
    expect(decodeImageDataUrl("https://example.com/x.png")).toBeNull();
    expect(decodeImageDataUrl("data:image/png;base64,")).toBeNull();
  });
});

describe("buildBugList", () => {
  it("newest first, in the contract's shape, without the screenshots", async () => {
    const db = consoleFake();
    const list = await buildBugList(deps(db));
    const parsed = AdminBugListSchema.safeParse(list);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(list.generatedAt).toBe(new Date(NOW).toISOString());
    expect(list.bugs.map((b) => b.id)).toEqual([BUG, BUG2]);
    expect(list.bugs[0]).toEqual({
      id: BUG,
      at: iso(HOUR),
      userId: MAYA,
      email: "maya@example.com",
      boardId: B1,
      message: "The tutor froze",
      path: `/board/${B1}`,
      status: "new",
      note: null,
      resolvedAt: null,
      hasScreenshot: true,
      diagnostics: { url: `https://agathon.app/board/${B1}?x=1`, viewport: "1280x800" },
      logs: [
        { level: "log", time: "2026-10-08T11:00:00.000Z", text: "saved v12" },
        { level: "warn", time: new Date(1791460000000).toISOString(), text: 'slow {"ms":900}' },
      ],
      thread: [],
      waiting: false,
      reporterSeenAt: null,
    });
    expect(list.bugs[1]).toMatchObject({ message: "", hasScreenshot: false, status: "seen", note: "asked for more", path: null });
    const read = db.calls.find((c) => c.table === "admin_bug_rows")!;
    expect(read.params.get("select")).not.toContain("screenshot,");
    expect(read.params.get("limit")).toBe("200");
  });
});

describe("patchBug", () => {
  it("status and note: the report as it now stands, resolvedAt following the status, the change logged", async () => {
    const db = consoleFake();
    const fixed = await patchBug(deps(db), BUG, { status: "fixed", note: "Fixed in 7fde5a4" }, ADMIN);
    expect(AdminBugSchema.safeParse(fixed).success).toBe(true);
    expect(fixed).toMatchObject({ id: BUG, status: "fixed", note: "Fixed in 7fde5a4", resolvedAt: new Date(NOW).toISOString() });
    expect(db.tables.admin_audit.at(-1)).toMatchObject({ admin_id: ADMIN, action: "bug.update", target_kind: "bug", target_id: BUG, meta: { status: "fixed", note: "set" } });
    // only the note: the status stays; an empty note clears it
    const noted = await patchBug(deps(db), BUG, { note: "  " }, ADMIN);
    expect(noted).toMatchObject({ status: "fixed", note: null });
    expect(db.tables.admin_audit.at(-1)!.meta).toEqual({ note: "cleared" });
    // back to seen: no longer resolved
    expect(await patchBug(deps(db), BUG, { status: "seen" }, ADMIN)).toMatchObject({ status: "seen", resolvedAt: null });
    const patch = db.calls.find((c) => c.method === "PATCH")!;
    expect(patch.table).toBe("bug_reports");
    expect(patch.body).toEqual({ status: "fixed", admin_note: "Fixed in 7fde5a4" });
  });

  it("no such report: null, nothing logged", async () => {
    const db = consoleFake();
    expect(await patchBug(deps(db), "f0000000-0000-4000-8000-0000000000ff", { status: "seen" }, ADMIN)).toBeNull();
    expect(db.tables.admin_audit).toEqual([]);
  });

  it("the change is made even when its log line cannot be written", async () => {
    const db = consoleFake(consoleTables(), { fail: { admin_audit: 500 } });
    expect(await patchBug(deps(db), BUG, { status: "wontfix" }, ADMIN)).toMatchObject({ status: "wontfix" });
  });
});

describe("bugScreenshot", () => {
  it("the image's bytes and type, the look logged first", async () => {
    const db = consoleFake();
    const shot = await bugScreenshot(deps(db), BUG, ADMIN);
    expect(shot.kind).toBe("image");
    if (shot.kind !== "image") return;
    expect(shot.contentType).toBe("image/png");
    expect(Buffer.from(shot.bytes).toString("base64")).toBe(PNG_BASE64);
    expect(db.tables.admin_audit).toEqual([expect.objectContaining({ action: "bug.screenshot", target_kind: "bug", target_id: BUG, meta: { bytes: shot.bytes.byteLength, ownerId: MAYA } })]);
  });

  it("no report, no screenshot, a screenshot that is not an image: nothing logged", async () => {
    const tables = consoleTables();
    tables.bug_reports.push({ ...(tables.bug_reports[0] as Row), id: "f0000000-0000-4000-8000-0000000000b3", screenshot: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" });
    const db = consoleFake(tables);
    expect(await bugScreenshot(deps(db), "f0000000-0000-4000-8000-0000000000ff", ADMIN)).toEqual({ kind: "missing" });
    expect(await bugScreenshot(deps(db), BUG2, ADMIN)).toEqual({ kind: "none" });
    expect(await bugScreenshot(deps(db), "f0000000-0000-4000-8000-0000000000b3", ADMIN)).toEqual({ kind: "invalid" });
    expect(db.tables.admin_audit).toEqual([]);
  });

  it("the look cannot be logged: no bytes", async () => {
    await expect(bugScreenshot(deps(consoleFake(consoleTables(), { fail: { admin_audit: 500 } })), BUG, ADMIN)).rejects.toMatchObject({ name: "AuditError" });
  });
});

describe("a report's thread (bug_report_messages)", () => {
  const row: BugViewRow = { id: BUG, created_at: iso(HOUR), user_id: MAYA, user_email: "maya@example.com", board_id: null, message: "x", diagnostics: {}, logs: [], status: "seen", admin_note: null, resolved_at: null, has_screenshot: false, reporter_seen_at: iso(30_000) };
  const said = (id: string, author: "admin" | "reporter", minAgo: number) => ({ id, author, body: `${author} ${id}`, at: iso(minAgo * 60_000) });

  it("oldest first; waiting when the reporter wrote last; when they last read their replies", () => {
    const bug = toAdminBug(row, [said("m3", "reporter", 1), said("m1", "admin", 50), said("m2", "reporter", 20)]);
    expect(bug.thread.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(bug.waiting).toBe(true);
    expect(bug.reporterSeenAt).toBe(iso(30_000));
    expect(toAdminBug(row, [said("m2", "reporter", 20), said("m4", "admin", 2)]).waiting).toBe(false);
    expect(toAdminBug(row)).toMatchObject({ thread: [], waiting: false });
  });

  it("every listed report's messages in one read per THREAD_BATCH reports, never one per report", async () => {
    const tables = consoleTables();
    tables.bug_report_messages.push(
      { id: "r1", report_id: BUG2, author: "reporter", author_id: SAM, body: "still broken", created_at: iso(2 * MIN) },
      { id: "a1", report_id: BUG2, author: "admin", author_id: ADMIN, body: "Which device?", created_at: iso(10 * MIN) },
      { id: "x1", report_id: BUG2, author: "robot", author_id: null, body: "unknown author: left out", created_at: iso(MIN) },
    );
    const db = consoleFake(tables);
    const list = await buildBugList(deps(db));
    expect(AdminBugListSchema.safeParse(list).success).toBe(true);
    const sam = list.bugs.find((b) => b.id === BUG2)!;
    expect(sam.thread.map((m) => [m.author, m.body])).toEqual([
      ["admin", "Which device?"],
      ["reporter", "still broken"],
    ]);
    expect(sam.waiting).toBe(true);
    expect(list.bugs.find((b) => b.id === BUG)!.thread).toEqual([]);
    const reads = db.calls.filter((c) => c.table === "bug_report_messages");
    expect(reads).toHaveLength(1);
    expect(reads[0].params.get("report_id")).toBe(`in.(${BUG},${BUG2})`);

    // a page of 250 reports: three reads
    const many = Array.from({ length: 250 }, (_, i) => `f0000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const db2 = consoleFake(consoleTables());
    await threadsFor(restClient(deps(db2)), many);
    expect(db2.calls.filter((c) => c.table === "bug_report_messages")).toHaveLength(Math.ceil(250 / THREAD_BATCH));
    // none: no read at all
    const db3 = consoleFake(consoleTables());
    expect((await threadsFor(restClient(deps(db3)), [])).size).toBe(0);
    expect(db3.calls).toEqual([]);
  });
});

describe("reporterAddress (where a reply's email goes)", () => {
  const KID = uid(5);
  const PARENT = uid(6);
  const kidEmail = `kid-${KID}@kids.agathon.app`;
  const setup = (name: string | null, family = true) => {
    const tables = consoleTables();
    tables.profiles.push({ user_id: KID, display_name: name });
    if (family) tables.family_members.push({ child_id: KID, parent_id: PARENT });
    return restClient(deps(consoleFake(tables, { users: { ...USERS, [KID]: kidEmail, [PARENT]: "parent@example.com" } })));
  };

  it("the reporter's account address (the auth API's, else the one on the report)", async () => {
    expect(await reporterAddress(setup(null), { userId: MAYA, email: "old@example.com" })).toEqual({ email: "maya@example.com", to: "reporter", kidName: null });
    expect(await reporterAddress(setup(null), { userId: uid(77), email: "stamped@example.com" })).toEqual({ email: "stamped@example.com", to: "reporter", kidName: null });
    expect(await reporterAddress(setup(null), { userId: null, email: "x@example.com" })).toEqual({ skip: "no_reporter" });
    expect(await reporterAddress(setup(null), { userId: uid(77), email: null })).toEqual({ skip: "no_email" });
  });

  it("a kid profile: their grown-up, with the kid's first name made safe; never the kid", async () => {
    expect(await reporterAddress(setup("Maya Lee"), { userId: KID, email: kidEmail })).toEqual({ email: "parent@example.com", to: "grown_up", kidName: "Maya" });
    expect(await reporterAddress(setup("visit evil.example"), { userId: KID, email: kidEmail })).toEqual({ email: "parent@example.com", to: "grown_up", kidName: "visit" });
    expect(await reporterAddress(setup("http://x"), { userId: KID, email: kidEmail })).toEqual({ email: "parent@example.com", to: "grown_up", kidName: null });
    expect(await reporterAddress(setup("Maya", false), { userId: KID, email: kidEmail })).toEqual({ skip: "no_grown_up" });
  });
});
