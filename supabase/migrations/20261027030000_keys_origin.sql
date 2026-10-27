-- Agathon Keys (docs/KEYS.md, 2026-10-27): a new attempt origin, `keys`.
--
-- Keys is keyboard-first practice on a laptop or Chromebook (/keys): the kid types each step of a
-- problem into cells instead of writing it on a board. Each problem is one `learning_attempts` row,
-- written by the same store (src/lib/learning/store.ts) with the student's own JWT, origin `keys`
-- (ATTEMPT_ORIGINS in src/lib/learning/contracts.ts). `board_id` is null: Keys has no board.
--
-- This replaces learning_attempts_origin_known (20261004000000_learning.sql) with the code's list
-- plus `keys`. Nothing else changes. Idempotent.
--
-- Deploy order: BEFORE the code that writes `keys` (the Keys page behind its feature flag). Until
-- then a Keys attempt is refused (23514) and the store reports it as "invalid"; the page still works,
-- it just records nothing. Reading is unaffected either way: the store, the Progress page and the
-- reports skip an origin they do not know, and every one of them knows `keys` with this code.
--
-- The check is added NOT VALID and then validated, so the table is not locked against writes while
-- the existing rows (all of them already in the old, smaller list) are checked.

alter table public.learning_attempts drop constraint if exists learning_attempts_origin_known;
alter table public.learning_attempts
  add constraint learning_attempts_origin_known
    check (origin in ('student', 'tutor_problem', 'starter', 'now_you_try', 'practice', 'teach', 'keys')) not valid;
alter table public.learning_attempts validate constraint learning_attempts_origin_known;
