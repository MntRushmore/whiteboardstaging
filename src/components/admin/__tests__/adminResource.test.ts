import { beforeEach, describe, expect, it, vi } from "vitest";

const readAdmin = vi.fn();
const patchAdmin = vi.fn();
vi.mock("../adminData", () => ({ readAdmin: (...a: unknown[]) => readAdmin(...a), patchAdmin: (...a: unknown[]) => patchAdmin(...a) }));

import { ADMIN_API, AdminBugListSchema, AdminIssueListSchema, type AdminBugList, type AdminIssueList } from "@/lib/admin/contracts";
import { buildWorld } from "@/lib/admin/fixtures/consoleFixtures";
import { issuesUrl } from "@/lib/admin/issuesView";
import { updateBug, updateIssue } from "../adminActions";
import { loadResource, mutateResources, peekResource, reloadResource, resetResources } from "../useAdminResource";

const NOW = Date.parse("2026-10-08T19:00:00Z");
const world = buildWorld(NOW);
const bugList = (): AdminBugList => ({ generatedAt: new Date(NOW).toISOString(), bugs: structuredClone(world.bugs) });
const issueList = (days: number): AdminIssueList => ({ generatedAt: new Date(NOW).toISOString(), days, issues: structuredClone(world.issuesFor(days)) });

/** A read that answers when told to. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  resetResources();
  readAdmin.mockReset();
  patchAdmin.mockReset();
});

describe("the shared read", () => {
  it("one read at a time per address; a second ask joins it", async () => {
    const d = deferred<unknown>();
    readAdmin.mockReturnValueOnce(d.promise);
    const a = loadResource(ADMIN_API.bugs, AdminBugListSchema);
    const b = loadResource(ADMIN_API.bugs, AdminBugListSchema);
    expect(a).toBe(b);
    expect(peekResource(ADMIN_API.bugs).loading).toBe(true);
    d.resolve({ kind: "data", data: bugList() });
    await a;
    expect(readAdmin).toHaveBeenCalledTimes(1);
    const s = peekResource<AdminBugList>(ADMIN_API.bugs);
    expect([s.loading, s.error, s.data?.bugs.length]).toEqual([false, null, 12]);
    expect(s.readAt).not.toBeNull();
  });

  it("a failed refresh keeps the last answer and says so; 404 and 401 are remembered as such", async () => {
    readAdmin.mockResolvedValueOnce({ kind: "data", data: bugList() }).mockResolvedValueOnce({ kind: "error", error: "status 503" });
    await loadResource(ADMIN_API.bugs, AdminBugListSchema);
    await loadResource(ADMIN_API.bugs, AdminBugListSchema);
    const s = peekResource<AdminBugList>(ADMIN_API.bugs);
    expect([s.error, s.data?.bugs.length]).toEqual(["status 503", 12]);
    readAdmin.mockResolvedValueOnce({ kind: "notFound" });
    await loadResource(ADMIN_API.users, AdminBugListSchema);
    expect(peekResource(ADMIN_API.users).notFound).toBe(true);
    readAdmin.mockResolvedValueOnce({ kind: "signedOut" });
    await loadResource(ADMIN_API.boards, AdminBugListSchema);
    expect(peekResource(ADMIN_API.boards).signedOut).toBe(true);
  });

  it("a read already out when a change is made here does not overwrite it", async () => {
    readAdmin.mockResolvedValueOnce({ kind: "data", data: bugList() });
    await loadResource(ADMIN_API.bugs, AdminBugListSchema);
    const d = deferred<unknown>();
    readAdmin.mockReturnValueOnce(d.promise);
    const out = loadResource(ADMIN_API.bugs, AdminBugListSchema);
    mutateResources<AdminBugList>((u) => u === ADMIN_API.bugs, (l) => ({ ...l, bugs: l.bugs.map((b) => (b.id === "bug_001" ? { ...b, status: "fixed" } : b)) }));
    d.resolve({ kind: "data", data: bugList() });
    await out;
    expect(peekResource<AdminBugList>(ADMIN_API.bugs).data?.bugs.find((b) => b.id === "bug_001")?.status).toBe("fixed");
    // and the next read is believed again
    readAdmin.mockResolvedValueOnce({ kind: "data", data: bugList() });
    await reloadResource(ADMIN_API.bugs, AdminBugListSchema);
    expect(peekResource<AdminBugList>(ADMIN_API.bugs).data?.bugs.find((b) => b.id === "bug_001")?.status).toBe("new");
  });
});

describe("triage, optimistic", () => {
  it("a bug's status shows at once, takes the server's copy, and goes back when the PATCH fails", async () => {
    readAdmin.mockResolvedValueOnce({ kind: "data", data: bugList() });
    await loadResource(ADMIN_API.bugs, AdminBugListSchema);
    const before = world.bugs[0];

    const d = deferred<unknown>();
    patchAdmin.mockReturnValueOnce(d.promise);
    const done = updateBug(before, { status: "seen", note: "looking" });
    const shown = peekResource<AdminBugList>(ADMIN_API.bugs).data!.bugs[0];
    expect([shown.status, shown.note]).toEqual(["seen", "looking"]);
    expect(patchAdmin).toHaveBeenCalledWith(ADMIN_API.bug(before.id), { status: "seen", note: "looking" });
    d.resolve({ ok: true, body: { bug: { ...before, status: "seen", note: "looking (server)" } } });
    expect(await done).toEqual({ ok: true });
    expect(peekResource<AdminBugList>(ADMIN_API.bugs).data!.bugs[0].note).toBe("looking (server)");

    patchAdmin.mockResolvedValueOnce({ ok: false, error: "status 500" });
    const current = peekResource<AdminBugList>(ADMIN_API.bugs).data!.bugs[0];
    expect(await updateBug(current, { status: "fixed" })).toEqual({ ok: false, error: "status 500" });
    expect(peekResource<AdminBugList>(ADMIN_API.bugs).data!.bugs[0].status).toBe("seen");
  });

  it("an issue changes in every window's list at once, and goes back on failure", async () => {
    readAdmin.mockResolvedValueOnce({ kind: "data", data: issueList(7) }).mockResolvedValueOnce({ kind: "data", data: issueList(30) });
    await loadResource(issuesUrl(7), AdminIssueListSchema);
    await loadResource(issuesUrl(30), AdminIssueListSchema);
    const solve = world.issues.find((i) => i.kind === "live.solve")!;
    const status = (url: string) => peekResource<AdminIssueList>(url).data!.issues.find((i) => i.fingerprint === solve.fingerprint)!;

    patchAdmin.mockResolvedValueOnce({ ok: true, body: { ok: true } });
    await updateIssue(solve, "muted", "upstream's problem");
    expect([status(issuesUrl(7)).status, status(issuesUrl(30)).status, status(issuesUrl(30)).note]).toEqual(["muted", "muted", "upstream's problem"]);
    expect(patchAdmin).toHaveBeenCalledWith(ADMIN_API.issues, { fingerprint: solve.fingerprint, status: "muted", note: "upstream's problem" });
    // each window keeps its own per-day series
    expect(status(issuesUrl(30)).perDay).toHaveLength(30);

    patchAdmin.mockResolvedValueOnce({ ok: false, error: "nope" });
    const regressed = world.issues.find((i) => i.regressed)!;
    expect(await updateIssue(regressed, "fixed")).toEqual({ ok: false, error: "nope" });
    const back = peekResource<AdminIssueList>(issuesUrl(7)).data!.issues.find((i) => i.fingerprint === regressed.fingerprint)!;
    expect([back.status, back.regressed, back.fixedAt]).toEqual([regressed.status, true, regressed.fixedAt]);
  });
});
