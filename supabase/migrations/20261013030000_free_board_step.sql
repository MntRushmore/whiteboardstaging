-- =============================================================================
-- The free board's funnel step (2026-10-13). Idempotent; additive. Needs
-- 20261012020000_funnel_steps.sql (and keeps 20261013000000_try_board_step.sql's try_board).
--
-- An account without a plan gets one free board (docs/START-FLOW.md, "The free board";
-- src/lib/billing/freeBoard.ts): it ends after 5 problems done on it or when the starter ink runs
-- out, whichever comes first, and the plan screen follows. The app records that end once per
-- account as the funnel step `free_board_done` (meta: { reason: "problems" | "ink" }), so the admin
-- Funnel can tell how many used the free board up and how many of them started a trial.
--
--   funnel_steps.step   + 'free_board_done' (src/lib/funnel/steps.ts FUNNEL_STEPS)
-- =============================================================================

alter table public.funnel_steps drop constraint if exists funnel_steps_step_known;
alter table public.funnel_steps add constraint funnel_steps_step_known check (step in (
  'try_board',
  'welcome_shown', 'welcome_skipped', 'welcome_started',
  'tour_problem', 'tour_checked', 'tour_unread', 'tour_helped', 'tour_asked', 'tour_skipped', 'tour_done',
  'plan_shown', 'checkout_opened', 'checkout_returned',
  'free_board_done'
));
