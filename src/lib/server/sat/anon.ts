/**
 * An anonymous Supabase session for SAT mode (POST /api/sat/anon, docs/SAT-MODE.md). The server
 * signs in anonymously with the anon key, exactly as a client would, and hands the session to the
 * app, so only the attested app (never a script with the anon key and a browser) is supposed to
 * make one. What an anonymous user may then do is limited everywhere else (requireUser, the Live
 * preamble, and 20261022010000_sat_anonymous.sql).
 *
 * `satAnonDeps` is the seam the tests replace.
 */
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import type { SatAnonResponse } from "@/lib/sat/contracts";

export type AnonSignIn = { ok: true; session: SatAnonResponse } | { ok: false; disabled: boolean; message: string };

async function signInAnonymously(): Promise<AnonSignIn> {
  const env = getServerEnv();
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data?.session || !data.user) {
      const message = error?.message ?? "no session";
      return { ok: false, disabled: /anonymous sign-ins are disabled|anonymous.*disabled/i.test(message), message };
    }
    const s = data.session;
    return {
      ok: true,
      session: {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600),
        user_id: data.user.id,
      },
    };
  } catch (err) {
    return { ok: false, disabled: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export const satAnonDeps = { signIn: signInAnonymously };
