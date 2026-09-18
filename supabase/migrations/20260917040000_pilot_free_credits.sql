-- Pilot allowance: raise the free plan while there is no way to pay.
--
-- Checkout is not wired up yet (the billing webhook stays dormant until a provider is chosen),
-- so a student who runs out of credits has no upgrade path and simply stops getting help. 300
-- credits is roughly three homework sessions; that ends a classroom pilot early for no good
-- reason. Metering itself stays ON: usage_events still records every call, and the cap still
-- protects the operator's provider balance from a runaway loop.
--
-- What a credit buys (src/lib/server/billing.ts ROUTE_COSTS): handwriting recognition 1,
-- hint check 3, worked solution 10, drawn help 25, worksheet 20. A typical homework session is
-- 50-100 credits, so 1000/month is ~10-20 sessions per student.
--
-- To change it, edit the number here (or run the UPDATE against the project) and re-apply:
--   update public.plans set monthly_credits = 2000,
--          features = '["2,000 credits / month", "All AI tutor modes"]'::jsonb
--    where id = 'free';
-- Balances are computed per calendar month from the plan, so a change takes effect immediately
-- for everyone; nothing is stored per user. Revisit when paid plans go live.

update public.plans
   set monthly_credits = 1000,
       features = '["1,000 credits / month", "All AI tutor modes", "Realtime math checking"]'::jsonb
 where id = 'free'
   and monthly_credits < 1000;
