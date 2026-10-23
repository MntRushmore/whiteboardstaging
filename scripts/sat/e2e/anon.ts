/**
 * SAT v2 end to end, the NO-ACCOUNT path (docs/SAT-MODE.md "POST /api/sat/anon"), against a LOCAL dev
 * server started with SAT_ANON_TUTOR_PER_DAY=2 and a local stack with anonymous sign-ins on:
 *
 *  1. POST /api/sat/anon through the app's App Attest Debug path (`X-Agathon-App-Debug`), the session;
 *  2. a set: opening uses no pass, the first ink takes one, the cap at 2 (the third question's live call
 *     is a 402 sat_tutor); a miss goes into the deck;
 *  3. the lockdown: the anonymous token gets 403 on non-SAT routes, PostgREST refuses its writes to
 *     non-SAT tables (and lets its SAT writes through);
 *  4. the upgrade, as the app does it (AuthService.upgradeAnonymous): terms first, then email + password:
 *     the SAME user id, its attempts and its review deck carried over, and a free account's cap (20).
 *
 * Prints PASS/FAIL per check, and the user ids it made (anon.ts --cleanup removes them is NOT done here:
 * cleanup.ts removes every sat-e2e user).
 *   E2E_FETCH_LOG=… node scripts/sat/e2e/bundle.mjs scripts/sat/e2e/anon.ts
 */
import { randomUUID } from "node:crypto";
import { BASE, CLEAN, ENV, SUPABASE_URL, call, payloadOf, writeLine, type Account } from "./lib";

const TZ = "America/New_York";
const rows: [string, boolean, string][] = [];
const ok = (name: string, pass: boolean, detail: unknown) => {
  rows.push([name, pass, JSON.stringify(detail)]);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail).slice(0, 400)}`);
};
const anonKey = ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function rest(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text: text.slice(0, 300) };
}

async function authUser(token: string, body?: unknown) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: body ? "PUT" : "GET",
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

async function main() {
  // 1. the session, as the simulator's Debug build asks for it
  const device = randomUUID();
  const anonRes = await fetch(`${BASE}/api/sat/anon`, { method: "POST", headers: { "Content-Type": "application/json", "X-Agathon-App-Debug": device }, body: "{}" });
  const anon = (await anonRes.json()) as any;
  ok("POST /api/sat/anon (X-Agathon-App-Debug) mints a session", anonRes.status === 200 && Boolean(anon.access_token && anon.refresh_token && anon.user_id), { status: anonRes.status, user_id: anon.user_id, expires_at: anon.expires_at });
  const noHeaders = await fetch(`${BASE}/api/sat/anon`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  ok("…and without the app's headers it is refused (403 attest_required)", noHeaders.status === 403 && ((await noHeaders.json()) as any).reason === "attest_required", { status: noHeaders.status });
  const me = await authUser(anon.access_token);
  ok("the session is anonymous", me.status === 200 && me.json?.is_anonymous === true && me.json?.id === anon.user_id, { is_anonymous: me.json?.is_anonymous });
  const acct: Account = { email: "(anonymous)", userId: anon.user_id, token: anon.access_token };
  console.log(`anonymous user ${anon.user_id}`);

  // 2. a set, the passes, the cap at 2, a miss into the deck
  const next = await call(acct, "GET", `/api/sat/next?count=3&tz=${encodeURIComponent(TZ)}`);
  const qs = ((next.json as any)?.questions ?? []) as any[];
  ok("GET /api/sat/next serves a set", next.status === 200 && qs.length === 3, { status: next.status, ids: qs.map((q) => q.id) });
  const p0 = await call(acct, "GET", `/api/sat/progress?tz=${encodeURIComponent(TZ)}`);
  ok("opening uses no pass; the anonymous cap is 2", (p0.json as any)?.today?.tutor_used === 0 && (p0.json as any)?.today?.cap === 2, (p0.json as any)?.today);
  const strokes = writeLine("2x=8", { x: 140, y: 620 }, CLEAN, "anon");
  const { payload } = payloadOf(strokes, "ln_anon");
  const body = (id: string, line: string) => ({ boardId: "sat-e2e-anon", lineId: line, strokes: { x: payload.x, y: payload.y }, bounds: { w: payload.w, h: payload.h }, sat_question_id: id });
  const early = await call(acct, "POST", "/api/live/recognize", body(qs[0].id, "ln_a0"));
  ok("a live call before the first ink's pass: 402 sat_tutor", early.status === 402 && (early.json as any)?.reason === "sat_tutor", { status: early.status, sat: (early.json as any)?.sat });
  for (let i = 0; i < 3; i++) {
    const t = await call(acct, "POST", "/api/sat/tutor", { question_id: qs[i].id, tz: TZ });
    const tj = t.json as any;
    const live = await call(acct, "POST", "/api/live/recognize", body(qs[i].id, `ln_a${i + 1}`));
    if (i < 2) {
      ok(`question ${i + 1}: the first ink takes pass ${i + 1} of 2, its live read goes through`, tj?.allowed === true && tj?.used_today === i + 1 && tj?.cap === 2 && live.status === 200, { tutor: tj, live: live.status });
    } else {
      ok("question 3: refused at 2 of 2, its live call is a 402 sat_tutor", tj?.allowed === false && tj?.used_today === 2 && live.status === 402 && (live.json as any)?.reason === "sat_tutor", { tutor: tj, live: live.status });
    }
  }
  // a miss on question 1 (a wrong choice / grid-in), a right answer on question 2
  const wrongOf = (q: any) => (q.format === "mcq" ? (q.choices as any[]).find((c) => c.key !== q.answer.key).key : "99999");
  const rightOf = (q: any) => (q.format === "mcq" ? q.answer.key : q.answer.accepted[0]);
  const miss = await call(acct, "POST", "/api/sat/attempts", { question_id: qs[0].id, chosen: wrongOf(qs[0]), correct: false, seconds: 40, used_tutor: true, tz: TZ });
  const hit = await call(acct, "POST", "/api/sat/attempts", { question_id: qs[1].id, chosen: rightOf(qs[1]), correct: true, seconds: 30, used_tutor: true, tz: TZ });
  ok("answers are saved (a miss, a right one)", miss.status === 200 && (miss.json as any)?.correct === false && hit.status === 200 && (hit.json as any)?.correct === true, { miss: miss.json, hit: hit.json });
  const deck = await rest(acct.token, "GET", `sat_reviews?select=question_id,step,due_on`);
  ok("the miss is in the anonymous user's deck (step 1, tomorrow)", deck.status === 200 && deck.text.includes(qs[0].id) && deck.text.includes('"step":1'), deck);

  // 3. the lockdown
  const blocked: [string, "GET" | "POST", string, unknown?][] = [
    ["boards list (GET /api/credits, the ink meter)", "GET", "/api/credits"],
    ["family", "GET", "/api/family"],
    ["billing (Apple transaction)", "POST", "/api/billing/apple/transaction", { signedTransaction: "x" }],
    ["ask (its history, no SAT question)", "GET", "/api/live/ask/history?boardId=b"],
    ["a live check with no SAT question", "POST", "/api/live/check", { boardId: "b", mode: "suggest", region: { x: 0, y: 0, w: 10, h: 10 }, lines: [{ id: "a", latex: "1=1", bbox: [0, 0, 1, 1], local: { kind: "equation", verdict: "ok" } }] }],
    ["the board drawer", "POST", "/api/board/draw", { prompt: "a cat" }],
    ["the bug reporter", "POST", "/api/bug-reports/00000000-0000-0000-0000-000000000000/messages", { body: "x" }],
  ];
  for (const [name, method, route, b] of blocked) {
    const r = await call(acct, method, route, b);
    ok(`403 for an anonymous token: ${name}`, r.status === 403, { status: r.status, body: r.text.slice(0, 160) });
  }
  const writes: [string, string, unknown][] = [
    ["profiles", "profiles", { user_id: anon.user_id, display_name: "x" }],
    ["learning_attempts", "learning_attempts", { user_id: anon.user_id }],
    ["app_events", "app_events", { kind: "x" }],
    ["ask_messages", "ask_messages", { user_id: anon.user_id, board_id: "b", role: "user", body: "x" }],
    ["sat_tutor_passes (only through the RPC)", "sat_tutor_passes", { profile_id: anon.user_id, question_id: qs[2].id, day: new Date().toISOString().slice(0, 10) }],
  ];
  for (const [name, table, b] of writes) {
    const r = await rest(acct.token, "POST", table, b);
    ok(`PostgREST refuses an anonymous write to ${name}`, r.status === 403 || r.status === 401, r);
  }
  const allowed = await rest(acct.token, "POST", "user_settings", { user_id: anon.user_id });
  ok("…and lets its SAT-mode writes through (user_settings)", allowed.status < 300 || allowed.status === 409, allowed);

  // 4. the upgrade, as AuthService.upgradeAnonymous does it: the terms first, then email + password
  const email = `sat-e2e-anon-upgrade-${Date.now()}@example.com`;
  const noTerms = await authUser(acct.token, { email, password: "sat-practice-2026" });
  ok("becoming permanent WITHOUT the terms is refused", noTerms.status >= 400, { status: noTerms.status, msg: noTerms.json?.msg ?? noTerms.json?.message });
  const terms = await authUser(acct.token, { data: { terms_version: "2026-10-11" } });
  const up = await authUser(acct.token, { email, password: "sat-practice-2026" });
  ok("terms, then email + password: the same user id", terms.status === 200 && up.status === 200 && up.json?.id === anon.user_id, { terms: terms.status, up: up.status, id: up.json?.id, is_anonymous: up.json?.is_anonymous, email: up.json?.email, new_email: up.json?.new_email });
  // the local stack confirms addresses by itself (or the address waits for its link): sign in with it
  const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "sat-practice-2026" }) });
  const s = (await signIn.json()) as any;
  ok("the upgraded account signs in with its email: same id, not anonymous", signIn.status === 200 && s.user?.id === anon.user_id && s.user?.is_anonymous === false, { status: signIn.status, id: s.user?.id, is_anonymous: s.user?.is_anonymous });
  if (signIn.status === 200) {
    const real: Account = { email, userId: s.user.id, token: s.access_token };
    const att = await rest(real.token, "GET", "sat_attempts?select=question_id,correct");
    const rev = await rest(real.token, "GET", "sat_reviews?select=question_id,step,due_on");
    ok("its attempts carried over", att.status === 200 && att.text.includes(qs[0].id) && att.text.includes(qs[1].id), att);
    ok("its review deck carried over", rev.status === 200 && rev.text.includes(qs[0].id), rev);
    const p1 = await call(real, "GET", `/api/sat/progress?tz=${encodeURIComponent(TZ)}`);
    ok("now a free account: cap 20, today's 2 passes kept", (p1.json as any)?.today?.cap === 20 && (p1.json as any)?.today?.tutor_used === 2, (p1.json as any)?.today);
    const fam = await call(real, "GET", "/api/family");
    ok("…and the rest of the app opens (GET /api/family 200)", fam.status === 200, { status: fam.status });
  }
  console.log(`\n${rows.filter((r) => r[1]).length}/${rows.length} pass; anonymous → ${email} (${anon.user_id})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
