-- The App Store screenshots' demo family (scripts/ios-appstore-shots.sh), LOCAL database only:
-- four weeks of a 7th grader's practice before today, so Progress, the streak and the skills look
-- like a family that has used Agathon for a month. Run with psql -v email=<the grown-up's email>.
-- Deterministic (no random()): the same family looks the same every run.
\set ON_ERROR_STOP on
select set_config('demo.email', :'email', false);

do $$
declare
  parent uuid := (select id from auth.users where email = current_setting('demo.email'));
  kid uuid;
  d int;
  n int;
  i int;
  skills text[] := array['two_step_equations','negative_numbers','proportions','two_step_equations','inequalities','area_perimeter','negative_numbers','two_step_equations'];
  problems text[] := array['4x - 7 = 21','-8 + 13','\frac{3}{5} = \frac{x}{20}','6x + 5 = 41','2x + 3 > 11','A = 9 \times 6','-4 \times -6','\frac{x}{3} + 2 = 9'];
  outcomes text[] := array['first_try','first_try','self_corrected','first_try','with_help','first_try','self_corrected','first_try','first_try','with_help'];
  k int;
  started timestamptz;
begin
  if parent is null then raise exception 'no grown-up with that email'; end if;
  select child_id into kid from public.family_members where parent_id = parent order by created_at limit 1;
  if kid is null then raise exception 'the grown-up has no kid yet'; end if;

  -- the grown-up's ink for the run (the tests read, check, hint and ask: real local calls)
  update public.profiles set ink_balance = greatest(ink_balance, 1500) where user_id = parent;

  -- again on a re-run: the seeded days replaced, today's real work kept
  delete from public.learning_attempts where user_id = kid and origin = 'practice' and started_at < date_trunc('day', now());
  -- 27 days back to yesterday; a school-night rhythm (most days, a couple off a week), the last ten in a row
  for d in 1..27 loop
    continue when d > 10 and (d % 7 = 3 or d % 7 = 6);
    n := 2 + (d % 4);
    for i in 1..n loop
      k := 1 + ((d * 3 + i) % array_length(skills, 1));
      started := date_trunc('day', now()) - make_interval(days => d) + make_interval(hours => 16 + (i % 3), mins => 7 * i);
      insert into public.learning_attempts
        (id, user_id, problem_latex, skill, origin, outcome, lines_written, lines_right, lines_ringed, hints,
         active_ms, started_at, finished_at, updated_at, created_at)
      values
        (gen_random_uuid(), kid, problems[k], skills[k], 'practice', outcomes[1 + ((d + i) % array_length(outcomes, 1))],
         3, 3 - ((d + i) % 2), (d + i) % 2, case when outcomes[1 + ((d + i) % array_length(outcomes, 1))] = 'with_help' then 1 else 0 end,
         (120 + ((d * 37 + i * 53) % 180)) * 1000, started, started + interval '4 minutes', started + interval '4 minutes', started);
    end loop;
    insert into public.daily_practice (user_id, day, goal, done, stars, completed_at)
    values (kid, (date_trunc('day', now()) - make_interval(days => d))::date, 5, 5, 3, date_trunc('day', now()) - make_interval(days => d) + interval '17 hours')
    on conflict (user_id, day) do nothing;
  end loop;
  raise notice 'seeded % attempts for the kid %', (select count(*) from public.learning_attempts where user_id = kid), kid;
end $$;
