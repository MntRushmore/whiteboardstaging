-- =============================================================================
-- The try board's funnel step (2026-10-13). Idempotent; additive. Needs
-- 20261012020000_funnel_steps.sql.
--
-- "Try it free" (/try, src/lib/try/contracts.ts) lets anyone write a line and see the tutor check
-- it before making an account. The device remembers the try; once the visitor has an account the
-- app records it as the funnel step `try_board` (meta: { checked, solved }), so the admin Funnel
-- can tell how many tried the free board first and how many of them started a trial.
--
--   funnel_steps.step   + 'try_board' (src/lib/funnel/steps.ts FUNNEL_STEPS)
-- =============================================================================

alter table public.funnel_steps drop constraint if exists funnel_steps_step_known;
alter table public.funnel_steps add constraint funnel_steps_step_known check (step in (
  'try_board',
  'welcome_shown', 'welcome_skipped', 'welcome_started',
  'tour_problem', 'tour_checked', 'tour_unread', 'tour_helped', 'tour_asked', 'tour_skipped', 'tour_done',
  'plan_shown', 'checkout_opened', 'checkout_returned'
));
