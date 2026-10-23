/**
 * SAT v2 end to end: the free tutor's cap, with a dev server started with SAT_FREE_TUTOR_PER_DAY=2.
 * A new free account opens a set (no pass is used), writes on question 1 (the first ink claims a
 * pass, then the live read goes through), then question 2, then question 3: the third pass is refused
 * and question 3's live call is a 402 with reason sat_tutor.
 *
 *   E2E_FETCH_LOG=… node scripts/sat/e2e/bundle.mjs scripts/sat/e2e/cap.ts
 */
import { CLEAN, call, makeFreeAccount, payloadOf, writeLine } from "./lib";

const TZ = "America/New_York";

async function main() {
  const acct = await makeFreeAccount("cap");
  const rows: [string, boolean, string][] = [];
  const ok = (name: string, pass: boolean, detail: unknown) => {
    rows.push([name, pass, JSON.stringify(detail)]);
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail)}`);
  };
  // open a set: three questions, no ink
  const next = await call(acct, "GET", `/api/sat/next?count=3&tz=${encodeURIComponent(TZ)}`);
  const qs = ((next.json as any)?.questions ?? []).map((q: any) => q.id) as string[];
  ok("open a set (GET /api/sat/next)", next.status === 200 && qs.length === 3, { status: next.status, ids: qs });
  const p0 = await call(acct, "GET", `/api/sat/progress?tz=${encodeURIComponent(TZ)}`);
  ok("opening uses no pass (progress.today.tutor_used = 0)", (p0.json as any)?.today?.tutor_used === 0 && (p0.json as any)?.today?.cap === 2, (p0.json as any)?.today);
  // a live call before the first ink's pass: refused
  const strokes = writeLine("2x=8", { x: 140, y: 620 }, CLEAN, "cap0");
  const { payload } = payloadOf(strokes, "ln_cap0");
  const body = (id: string, line: string) => ({ boardId: "sat-e2e-cap", lineId: line, strokes: { x: payload.x, y: payload.y }, bounds: { w: payload.w, h: payload.h }, sat_question_id: id });
  const early = await call(acct, "POST", "/api/live/recognize", body(qs[0], "ln_cap0"));
  ok("a live call with no pass is a 402 sat_tutor (no_pass)", early.status === 402 && (early.json as any)?.reason === "sat_tutor" && (early.json as any)?.sat === "no_pass", { status: early.status, body: early.json });
  for (let i = 0; i < 3; i++) {
    const t = await call(acct, "POST", "/api/sat/tutor", { question_id: qs[i], tz: TZ });
    const tj = t.json as any;
    const live = await call(acct, "POST", "/api/live/recognize", body(qs[i], `ln_cap${i + 1}`));
    if (i < 2) {
      ok(`question ${i + 1}: first ink takes pass ${i + 1} of 2`, t.status === 200 && tj?.allowed === true && tj?.used_today === i + 1 && tj?.cap === 2, tj);
      ok(`question ${i + 1}: its live read goes through`, live.status === 200, { status: live.status, latex: (live.json as any)?.latex });
    } else {
      ok("question 3: the pass is refused (allowed false, 2 of 2)", t.status === 200 && tj?.allowed === false && tj?.used_today === 2, tj);
      ok("question 3: its live call is a 402 sat_tutor", live.status === 402 && (live.json as any)?.reason === "sat_tutor", { status: live.status, body: live.json });
    }
  }
  // asking again for question 1 the same day: no second pass, still allowed
  const again = await call(acct, "POST", "/api/sat/tutor", { question_id: qs[0], tz: TZ });
  ok("question 1 again the same day: allowed, no new pass", (again.json as any)?.allowed === true && (again.json as any)?.used_today === 2, again.json);
  const p1 = await call(acct, "GET", `/api/sat/progress?tz=${encodeURIComponent(TZ)}`);
  ok("progress.today.tutor_used = 2", (p1.json as any)?.today?.tutor_used === 2, (p1.json as any)?.today);
  console.log(`\n${rows.filter((r) => r[1]).length}/${rows.length} pass; account ${acct.email}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
