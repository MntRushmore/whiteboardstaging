/**
 * SAT mode's database half against the LOCAL Supabase stack (20261022000000_sat_mode.sql,
 * 20261022010000_sat_anonymous.sql and v2's 20261023000000_sat_reviews.sql). Opt-in, local only (it inserts into auth.users with psql and
 * signs its own JWTs with the stack's secret):
 *
 *   RUN_DB_TESTS=1 npx vitest run src/__tests__/db-sat.integration.test.ts
 *
 * The local stack runs with anonymous sign-ins off, so an anonymous user is made the way GoTrue
 * makes one (an auth.users row with is_anonymous) and given a token with its claims.
 *
 *  1. An anonymous user gets no profile and no starter ink, and the self-heal does not make them.
 *  2. Through PostgREST its token may read, and write only SAT mode's things: sat_attempts, its own
 *     whiteboards, the SAT RPCs; ink_summary, consume_credits, save_onboarding, learning_attempts,
 *     bug_reports and the rest are 403. A real account's token is untouched by the guard.
 *  3. RLS: live questions only; its own attempts and passes only.
 *  4. At most 10 boards without an account.
 *  5. Becoming permanent: refused without terms_version; with it, the same id gets its profile (the
 *     acceptance stamped), its starter ink, and keeps its SAT attempts, passes and boards; its token
 *     then passes the guard.
 *  6. v2, the mistake deck: an anonymous token may insert, update and delete its own sat_reviews
 *     through the guard; RLS keeps each student to their own rows; the owner and question of a row
 *     cannot be changed; the step is 1 or 2. The bank's new columns: a nudge of at most 120
 *     characters, common_wrong on a grid-in only.
 */
import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isLoopbackUrl, readLocalSupabaseStatus, TERMS_VERSION } from "../../scripts/lib/supabaseHttp.mjs";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const title = enabled ? "SAT mode database (local Supabase)" : "SAT mode database — skipped: set RUN_DB_TESTS=1 with the local stack running";

suite(title, () => {
  let url = "";
  let anonKey = "";
  let dbUrl = "";
  let secret = "";
  const made: string[] = [];
  const questionId = "algebra-linear-one-var-9001";

  const sql = (q: string): string => {
    const r = spawnSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", q], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr.trim());
    return r.stdout.trim();
  };
  const b64 = (o: object | Buffer) => (Buffer.isBuffer(o) ? o : Buffer.from(JSON.stringify(o))).toString("base64url");
  const jwt = (sub: string, anonymous: boolean) => {
    const head = b64({ alg: "HS256", typ: "JWT" });
    const body = b64({ sub, role: "authenticated", aud: "authenticated", is_anonymous: anonymous, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000) });
    return `${head}.${body}.${b64(createHmac("sha256", secret).update(`${head}.${body}`).digest())}`;
  };
  const rest = (token: string, path: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(`${url}/rest/v1${path}`, {
      method: init.method ?? "GET",
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  /** A user as GoTrue makes one (anonymous, or a real sign-up with the terms). */
  const makeUser = (anonymous: boolean): string => {
    const id = randomUUID();
    const meta = anonymous ? "{}" : JSON.stringify({ terms_version: TERMS_VERSION });
    sql(`insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${anonymous ? "null" : `'sat-db-${id.slice(0, 8)}@example.com'`}, ${anonymous},
                 '{"provider":"${anonymous ? "anonymous" : "email"}"}', '${meta}', now(), now())`);
    made.push(id);
    return id;
  };

  beforeAll(() => {
    const status = readLocalSupabaseStatus();
    if (!status || !isLoopbackUrl(status.API_URL)) throw new Error("needs the local stack (`npx supabase start`)");
    url = status.API_URL;
    anonKey = status.ANON_KEY;
    dbUrl = status.DB_URL;
    secret = status.JWT_SECRET;
    sql(`insert into public.sat_questions (id, domain, skill, difficulty, format, stem, answer, solution, status)
         values ('${questionId}', 'algebra', 'linear equations in one variable', 1, 'spr', 'Solve $x + 1 = 2$.', '{"accepted":["1"]}',
                 '{"steps":[{"text":"a","math":null},{"text":"b","math":null}],"desmos_tip":null}', 'live')
         on conflict (id) do nothing`);
  });

  afterAll(() => {
    if (!dbUrl) return;
    for (const id of made) sql(`delete from auth.users where id = '${id}'`);
    sql(`delete from public.sat_questions where id = '${questionId}' and not exists (select 1 from public.sat_attempts where question_id = '${questionId}')`);
  });

  it("an anonymous user gets no profile and no ink, and the self-heal makes none", () => {
    const id = makeUser(true);
    expect(sql(`select count(*) from public.profiles where user_id = '${id}'`)).toBe("0");
    expect(sql(`select count(*) from public.ink_grants where user_id = '${id}'`)).toBe("0");
    sql(`select public.ensure_ink_account('${id}')`);
    expect(sql(`select count(*) from public.profiles where user_id = '${id}'`)).toBe("0");
    // a real sign-up still gets both
    const real = makeUser(false);
    expect(sql(`select count(*) from public.profiles where user_id = '${real}'`)).toBe("1");
    expect(sql(`select count(*) from public.ink_grants where user_id = '${real}' and kind = 'starter'`)).toBe("1");
  });

  it("through PostgREST an anonymous token reads, and writes only SAT mode's things", async () => {
    const id = makeUser(true);
    const t = jwt(id, true);
    expect((await rest(t, `/sat_questions?select=id&id=eq.${questionId}`)).status).toBe(200);
    expect((await rest(t, "/rpc/sat_tutor_access", { method: "POST", body: {} })).status).toBe(200);
    const attempt = await rest(t, "/sat_attempts", { method: "POST", body: { user_id: id, profile_id: id, question_id: questionId, chosen: "1", correct: true } });
    expect(attempt.status, await attempt.clone().text()).toBe(201);
    const board = await rest(t, "/whiteboards", { method: "POST", body: { user_id: id, title: "SAT practice", data: {} } });
    expect(board.status, await board.clone().text()).toBe(201);
    for (const [path, body] of [
      ["/rpc/ink_summary", {}],
      ["/rpc/consume_credits", { p_route: "live/check", p_units: 3 }],
      ["/rpc/save_onboarding", {}],
      ["/rpc/my_referral_code", {}],
      ["/learning_attempts", { id: randomUUID() }],
      ["/bug_reports", { message: "hi" }],
      ["/training_cases", {}],
    ] as const) {
      const res = await rest(t, path, { method: "POST", body });
      expect(res.status, path).toBe(403);
      expect((await res.json()).message, path).toMatch(/needs an account/);
    }
    // a real account's token is untouched
    const real = makeUser(false);
    expect((await rest(jwt(real, false), "/rpc/ink_summary", { method: "POST", body: {} })).status).toBe(200);
  });

  it("RLS: only live questions, and only its own attempts", async () => {
    const a = makeUser(true);
    const b = makeUser(true);
    sql(`insert into public.sat_attempts (user_id, profile_id, question_id, chosen, correct) values ('${a}', '${a}', '${questionId}', '1', true)`);
    sql(`update public.sat_questions set status = 'draft' where id = '${questionId}'`);
    try {
      expect(await (await rest(jwt(b, true), `/sat_questions?select=id&id=eq.${questionId}`)).json()).toEqual([]);
    } finally {
      sql(`update public.sat_questions set status = 'live' where id = '${questionId}'`);
    }
    expect(await (await rest(jwt(b, true), "/sat_attempts?select=user_id")).json()).toEqual([]);
    expect((await (await rest(jwt(a, true), "/sat_attempts?select=user_id")).json()).length).toBe(1);
    // writing as someone else is refused
    const forged = await rest(jwt(b, true), "/sat_attempts", { method: "POST", body: { user_id: a, profile_id: a, question_id: questionId, chosen: "1", correct: true } });
    expect(forged.status).toBe(403);
  });

  it("at most 10 boards without an account", async () => {
    const id = makeUser(true);
    const t = jwt(id, true);
    for (let i = 0; i < 10; i++) expect((await rest(t, "/whiteboards", { method: "POST", body: { user_id: id, title: `SAT ${i}`, data: {} } })).status).toBe(201);
    const eleventh = await rest(t, "/whiteboards", { method: "POST", body: { user_id: id, title: "SAT 11", data: {} } });
    expect(eleventh.status).toBe(400);
    expect(await eleventh.text()).toMatch(/too many boards/);
  });

  it("becoming permanent: refused without the terms; with them, the same id gets its profile and ink and keeps its SAT work", async () => {
    const id = makeUser(true);
    sql(`insert into public.sat_attempts (user_id, profile_id, question_id, chosen, correct) values ('${id}', '${id}', '${questionId}', '1', true)`);
    sql(`select public.sat_take_tutor_pass('${id}', '${questionId}', current_date, 5)`);
    expect(() => sql(`update auth.users set is_anonymous = false, email = 'sat-up-${id.slice(0, 8)}@example.com' where id = '${id}'`)).toThrow(/upgrade refused/);
    expect(sql(`select is_anonymous from auth.users where id = '${id}'`)).toBe("t");

    sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || '{"terms_version":"${TERMS_VERSION}"}'::jsonb where id = '${id}'`);
    sql(`update auth.users set is_anonymous = false, email = 'sat-up-${id.slice(0, 8)}@example.com' where id = '${id}'`);
    expect(sql(`select terms_version, accepted_terms_at is not null from public.profiles where user_id = '${id}'`)).toBe(`${TERMS_VERSION}|t`);
    expect(sql(`select count(*) from public.ink_grants where user_id = '${id}' and kind = 'starter'`)).toBe("1");
    expect(sql(`select count(*) from public.sat_attempts where user_id = '${id}'`)).toBe("1");
    expect(sql(`select count(*) from public.sat_tutor_passes where profile_id = '${id}'`)).toBe("1");
    // now a real account: the guard lets it through
    expect((await rest(jwt(id, false), "/rpc/ink_summary", { method: "POST", body: {} })).status).toBe(200);
  });

  it("v2: the mistake deck through PostgREST: an anonymous token writes its own reviews, only its own", async () => {
    const a = makeUser(true);
    const b = makeUser(true);
    const ta = jwt(a, true);
    const tb = jwt(b, true);
    const made = await rest(ta, "/sat_reviews", { method: "POST", body: { user_id: a, question_id: questionId, due_on: "2026-10-24", step: 1 } });
    expect(made.status, await made.clone().text()).toBe(201);
    const moved = await rest(ta, `/sat_reviews?user_id=eq.${a}&question_id=eq.${questionId}`, { method: "PATCH", body: { due_on: "2026-10-27", step: 2 } });
    expect(moved.status, await moved.clone().text()).toBe(200);
    expect(await moved.json()).toEqual([expect.objectContaining({ due_on: "2026-10-27", step: 2, cleared_at: null })]);
    expect(sql(`select updated_at >= created_at from public.sat_reviews where user_id = '${a}'`)).toBe("t");
    // the other student sees none of it and cannot write it
    expect(await (await rest(tb, "/sat_reviews?select=question_id")).json()).toEqual([]);
    const theirs = await rest(tb, `/sat_reviews?user_id=eq.${a}`, { method: "PATCH", body: { step: 1 } });
    expect(await theirs.json()).toEqual([]);
    expect(sql(`select step from public.sat_reviews where user_id = '${a}'`)).toBe("2");
    const forged = await rest(tb, "/sat_reviews", { method: "POST", body: { user_id: a, question_id: questionId, due_on: "2026-10-24", step: 1 } });
    expect(forged.status).toBe(403);
    // a row's owner and question never change; the step is 1 or 2
    const owner = await rest(ta, `/sat_reviews?user_id=eq.${a}`, { method: "PATCH", body: { user_id: b } });
    expect(owner.status).toBe(403); // no update grant on user_id
    const step3 = await rest(ta, `/sat_reviews?user_id=eq.${a}`, { method: "PATCH", body: { step: 3 } });
    expect(step3.status).toBe(400);
    // one row per question
    const twice = await rest(ta, "/sat_reviews", { method: "POST", body: { user_id: a, question_id: questionId, due_on: "2026-10-24", step: 1 } });
    expect(twice.status).toBe(409);
    const gone = await rest(ta, `/sat_reviews?user_id=eq.${a}`, { method: "DELETE" });
    expect(gone.status).toBe(200);
    expect(sql(`select count(*) from public.sat_reviews where user_id = '${a}'`)).toBe("0");
    // a real account's token too
    const real = makeUser(false);
    expect((await rest(jwt(real, false), "/sat_reviews", { method: "POST", body: { user_id: real, question_id: questionId, due_on: "2026-10-24", step: 1 } })).status).toBe(201);
    // the reviews go with the user
    sql(`delete from auth.users where id = '${real}'`);
    expect(sql(`select count(*) from public.sat_reviews where user_id = '${real}'`)).toBe("0");
  });

  it("v2: the bank's notes columns: a nudge of at most 120 characters; common_wrong on a grid-in only, at most 3", () => {
    sql(`update public.sat_questions set nudge = '${"x".repeat(120)}', common_wrong = '[{"answer":"2","why":"Added instead of subtracting."}]' where id = '${questionId}'`);
    expect(() => sql(`update public.sat_questions set nudge = '${"x".repeat(121)}' where id = '${questionId}'`)).toThrow(/sat_questions_nudge_len/);
    expect(() => sql(`update public.sat_questions set common_wrong = '[1,2,3,4]' where id = '${questionId}'`)).toThrow(/sat_questions_common_wrong_shape/);
    expect(() => sql(`update public.sat_questions set format = 'mcq', choices = '[{"key":"A","text":"1"},{"key":"B","text":"2"},{"key":"C","text":"3"},{"key":"D","text":"4"}]', answer = '{"key":"A"}' where id = '${questionId}'`)).toThrow(/sat_questions_common_wrong_shape/);
    sql(`update public.sat_questions set nudge = null, common_wrong = null where id = '${questionId}'`);
  });

  it("the free tutor's pass works for an anonymous user, at the cap the server passes", () => {
    const id = makeUser(true);
    const take = (q: string, cap: number) => JSON.parse(sql(`select public.sat_take_tutor_pass('${id}', '${q}', current_date, ${cap})`)) as { allowed: boolean; used_today: number; unlimited: boolean };
    expect(take(questionId, 5)).toMatchObject({ allowed: true, used_today: 1, unlimited: false });
    expect(take(questionId, 5)).toMatchObject({ allowed: true, used_today: 1 });
    expect(take(questionId, 0)).toMatchObject({ allowed: true }); // already has today's pass
  });
});
