/** /api/live/check on typed lines (no Mathpix): would the model, with the bank's question, ring a setup slip the engine cannot judge, and leave true lines alone? */
import { call, engine, judgeColumn, makeFreeAccount, problemLines, sse, SUPABASE_URL, ENV } from "./lib";
const cases: { id: string; lines: string[]; expect: ("ring" | "no ring")[] }[] = [
  { id: "advanced_math-nonlinear-functions-0002", lines: ["f(x)=a(x-1)^{2}+9", "0=a(4-1)^{2}+9"], expect: ["no ring", "no ring"] },
  { id: "advanced_math-nonlinear-functions-0002", lines: ["f(x)=a(x-1)^{2}+9", "0=a(4-1)^{2}-9"], expect: ["no ring", "ring"] },
  { id: "algebra-linear-functions-0001", lines: ["m=\\frac{3}{2}", "f(x)=\\frac{3}{2}x-2"], expect: ["no ring", "no ring"] },
  { id: "algebra-linear-functions-0001", lines: ["m=\\frac{3}{2}", "f(x)=\\frac{3}{2}x+2"], expect: ["no ring", "ring"] },
  { id: "advanced_math-nonlinear-equations-0147", lines: ["w(w+3)=54"], expect: ["no ring"] },
  { id: "advanced_math-nonlinear-equations-0147", lines: ["w(w-3)=54"], expect: ["ring"] },
  { id: "algebra-linear-one-var-0111", lines: ["6+3m=51"], expect: ["no ring"] },
  { id: "algebra-linear-one-var-0111", lines: ["3+6m=51"], expect: ["ring"] },
  { id: "psda-probability-0001", lines: ["P=\\frac{16}{28}"], expect: ["no ring"] },
  { id: "psda-probability-0001", lines: ["P=\\frac{16}{30}"], expect: ["ring"] },
];
async function main() {
  const acct = await makeFreeAccount("check");
  const q = await fetch(`${SUPABASE_URL}/rest/v1/sat_questions?select=id,stem&id=in.(${[...new Set(cases.map((c) => c.id))].join(",")})`, { headers: { apikey: ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${acct.token}` } });
  const stems = new Map(((await q.json()) as any[]).map((r) => [r.id, r.stem]));
  let pass = 0;
  for (const c of cases) {
    await call(acct, "POST", "/api/sat/tutor", { question_id: c.id, tz: "America/New_York" });
    const head = problemLines(stems.get(c.id));
    const judged = judgeColumn(head, c.lines, c.lines.map(() => 1));
    const heads = head.length ? engine.analyzeColumnOf({ lines: head, mode: "suggest" }) : [];
    const lines = [
      ...head.map((l, i) => ({ id: `chat-problem-sat-${i}`, latex: l, bbox: [0, 0, 1, 0.2], local: { kind: heads[i]?.kind ?? "unknown", verdict: heads[i]?.verdict ?? "none" } })),
      ...c.lines.map((l, i) => ({ id: `ln_${i}`, latex: l, bbox: [0, 0.3 + i * 0.2, 0.6, 0.45 + i * 0.2], local: { kind: judged[i].analysis.kind, verdict: judged[i].analysis.verdict } })),
    ];
    const res = await sse(acct, "/api/live/check", { boardId: "sat-e2e-checkprobe", mode: "suggest", region: { x: 100, y: 80, w: 900, h: 600 }, lines, focusLineId: `ln_${c.lines.length - 1}`, userAsked: false, sat_question_id: c.id });
    const ann = res.events.filter((e) => e.event === "annotation").map((e) => e.data);
    const got = c.lines.map((_, i) => (ann.some((a: any) => a.lineId === `ln_${i}` && a.verdict === "warn") ? "ring" : "no ring"));
    const ok = got.every((g, i) => g === c.expect[i]);
    if (ok) pass++;
    console.log(`${ok ? "PASS" : "FAIL"} ${c.id} ${JSON.stringify(c.lines)} engine[${judged.map((j) => `${j.analysis.kind}/${j.analysis.verdict}`).join(",")}] → ${got.join(",")} (want ${c.expect.join(",")}) ${res.status} ${res.ms}ms ${JSON.stringify(ann.map((a: any) => `${a.lineId}:${a.verdict}:${a.kind}:${a.message}`))}`);
  }
  console.log(`${pass}/${cases.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
