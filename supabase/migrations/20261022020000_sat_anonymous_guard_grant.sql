-- The pre-request guard (public.anonymous_request_guard, 20261022010000_sat_anonymous) runs as the
-- request's role and calls public.jwt_is_anonymous(). That migration granted the helper to
-- authenticated and service_role only, so every PostgREST request made with the anon key failed
-- with "permission denied for function jwt_is_anonymous". Applied to production by hand on
-- 2026-10-22 right after the SAT migrations.
grant execute on function public.jwt_is_anonymous() to anon;

notify pgrst, 'reload config';
