-- =============================================================================
-- No free plan (2026-10-05). Idempotent; one function changes.
--
-- Agathon is Agathon Unlimited: free for 7 days, then $25 a month (src/lib/billing/unlimited.ts).
-- A new student gets the guided first board and then the plan screen, which cannot be skipped; the
-- home, the boards and Progress send anyone without a plan back to it (src/lib/billing/planGate.ts).
-- Ink packs are no longer sold.
--
-- Starter ink is what pays for the guided first board, nothing more: 300 -> 100 for accounts made
-- from now on. The tour spends ~10-40 (a few line checks, a Help me, one Ask); 100 leaves room
-- for a student who writes a lot, and caps what anyone gets without a plan. Existing accounts keep
-- their starter grant (the ledger is append-only); without a plan the app is closed to them anyway.
--
-- Everything else is unchanged: the sign-up trigger and the self-heal (20261003010000_signup_consent.sql)
-- read ink_starter_amount(); while the plan is on, help spends no ink (consume_credits,
-- 20261003020000_unlimited.sql); a plan that spends ink (a second plan before its first charge, a
-- payment to fix) spends the balance as before.
--
-- Down: the same function with `select 300`.
-- =============================================================================

create or replace function public.ink_starter_amount()
returns integer
language sql
immutable
set search_path = public
as $$ select 100 $$;
revoke all on function public.ink_starter_amount() from public, anon, authenticated;
