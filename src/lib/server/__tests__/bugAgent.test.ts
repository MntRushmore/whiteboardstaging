import { describe, expect, it } from "vitest";
import type { Query, Rest } from "@/lib/server/adminConsole/rest";
import { bugScreenshot, listBugs, updateBug } from "@/lib/server/bugAgent";

/** A Rest over one in-memory bug_reports table. */
function fakeRest(rows: Record<string, unknown>[]) {
  const seen: Query[] = [];
  const rest = {
    now: 0,
    async rows<T>(q: Query) { seen.push(q); return rows as T[]; },
    async one<T>(q: Query) { seen.push(q); const id = String(q.params.id).replace("eq.", ""); return (rows.find((r) => r.id === id) ?? null) as T | null; },
    async patch<T>(q: Query, body: Record<string, unknown>) { const id = String(q.params.id).replace("eq.", ""); const r = rows.find((x) => x.id === id); if (!r) return []; Object.assign(r, body); return [r] as T[]; },
  } as unknown as Rest;
  return { rest, seen };
}

const report = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", created_at: "2026-10-27T13:00:00Z", status: null, message: "it wrote over my text",
  board_id: "b1", diagnostics: { build: "1.0 (1515)" }, logs: Array.from({ length: 100 }, (_, i) => i), screenshot: "data:image/jpeg;base64,/9j/AA==",
  admin_note: null, user_email: "someone@example.com", user_id: "u1", ...over,
});

describe("the bug agent's door", () => {
  it("lists new reports (no status counts as new), oldest first, without the reporter's email or id", async () => {
    const { rest, seen } = fakeRest([report()]);
    const [bug] = await listBugs(rest, "new");
    expect(seen[0].params.or).toBe("(status.is.null,status.eq.new)");
    expect(seen[0].params.order).toBe("created_at.asc");
    expect(String(seen[0].params.select)).not.toMatch(/email|user_id/);
    expect(bug).toMatchObject({ status: "new", message: "it wrote over my text", hasScreenshot: true });
    expect(bug.logs).toHaveLength(60);
    expect(JSON.stringify(bug)).not.toMatch(/someone@example\.com/);
  });

  it("appends dated notes and sets a status (fixed/wontfix stamp resolved_at); refuses an unknown status", async () => {
    const rows: Record<string, unknown>[] = [report({ admin_note: "earlier" })];
    const { rest } = fakeRest(rows);
    const bug = await updateBug(rest, String(rows[0].id), { status: "seen", note: "Cause: misaligned picture." }, new Date("2026-10-27T14:05:00Z"));
    expect(bug?.status).toBe("seen");
    expect(bug?.note).toBe("earlier\n\n[agent 2026-10-27 14:05] Cause: misaligned picture.");
    await updateBug(rest, String(rows[0].id), { status: "fixed" }, new Date("2026-10-27T15:00:00Z"));
    expect(rows[0].resolved_at).toBe("2026-10-27T15:00:00.000Z");
    await expect(updateBug(rest, String(rows[0].id), { status: "done" }, new Date())).rejects.toThrow(TypeError);
    await expect(updateBug(rest, String(rows[0].id), {}, new Date())).rejects.toThrow(TypeError);
  });

  it("hands back the screenshot's bytes and type", async () => {
    const { rest } = fakeRest([report()]);
    const shot = await bugScreenshot(rest, report().id);
    expect(shot?.type).toBe("image/jpeg");
    expect(shot?.bytes.length).toBeGreaterThan(0);
  });
});
