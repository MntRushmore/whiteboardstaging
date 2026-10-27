import { describe, expect, it } from "vitest";
import { AdminRunListSchema } from "@/lib/admin/contracts";
import type { Query, Rest } from "@/lib/server/adminConsole/rest";
import { pictureRuns, RUNS_MAX } from "@/lib/server/adminConsole/runs";

function fakeRest(rows: Record<string, unknown>[]) {
  const seen: Query[] = [];
  const rest = {
    now: Date.parse("2026-10-27T14:00:00Z"),
    async rows<T>(q: Query) { seen.push(q); return rows as T[]; },
    async emails(ids: (string | null)[]) { return new Map(ids.filter((x): x is string => !!x).map((id) => [id, `${id}@example.com`])); },
  } as unknown as Rest;
  return { rest, seen };
}

const run = { id: 7, at: "2026-10-27T13:38:18Z", source: "server", level: "info", kind: "board_draw", code: "done", message: "Picture tutor run r: done",
  route: "/api/board/draw", user_id: "u1", board_id: "03405c4b-282a-405a-9c15-2c9979761151", request_id: "q",
  meta: { mode: "answer", alignScore: 0.31, misaligned: true, costUsd: 0.07 }, release: "0d6a6eb" };

describe("the picture tutor's runs (iPad admin console)", () => {
  it("reads board_draw and board_draw_outcome, newest first, as AdminEvents", async () => {
    const { rest, seen } = fakeRest([run]);
    const list = await pictureRuns(rest);
    expect(seen[0].params.kind).toBe("in.(board_draw,board_draw_outcome)");
    expect(seen[0].params.order).toBe("at.desc,id.desc");
    expect(AdminRunListSchema.parse(list).runs[0]).toMatchObject({ kind: "board_draw", code: "done", userEmail: "u1@example.com", meta: { misaligned: true } });
  });

  it("filters by board and caps the count", async () => {
    const { rest, seen } = fakeRest([]);
    await pictureRuns(rest, { boardId: "03405c4b-282a-405a-9c15-2c9979761151", limit: 10_000 });
    expect(seen[0].params.board_id).toBe("eq.03405c4b-282a-405a-9c15-2c9979761151");
    expect(seen[0].params.limit).toBe(String(RUNS_MAX));
  });
});
