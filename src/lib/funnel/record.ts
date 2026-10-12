/**
 * The browser's half of the funnel steps (`steps.ts`): one call to `record_funnel_step` as the
 * signed-in student, so the admin Funnel can see who got how far into the onboarding. Fire and
 * forget: the onboarding never waits on its own bookkeeping, so `recordFunnelStep` never throws or
 * rejects, and it resolves as soon as the request is handed to fetch (at once when there is nothing
 * to send: signed out, an unknown step, no Supabase). The request is `keepalive`, so a step sent
 * right before the page leaves (`checkout_opened`, then Stripe) still arrives.
 *
 * What the app records from a React effect (the welcome or the plan screen showing, the tour's
 * marks) goes at most once per account per page load: StrictMode runs effects twice in dev, and a
 * re-render is not the step happening again. The student's own actions (Skip, Start, opening
 * checkout) go every time; the server counts them (`times`), and how often someone opens checkout
 * again matters.
 *
 * Imported by the home, the plan screen and the guided board's lazy chunk, so it brings nothing
 * the page does not have already: the steps, and the app's Supabase client for the session's token.
 */
import { supabase } from "@/lib/supabase";
import { createSkewRetryFetch } from "@/lib/supabaseFetch";
import { cleanMeta, isFunnelStep, RECORD_FUNNEL_STEP, type FunnelStep } from "./steps";

/** The student's own actions: recorded each time. Every other step, once per account per page load. */
const EVERY_TIME: ReadonlySet<FunnelStep> = new Set<FunnelStep>(["welcome_skipped", "welcome_started", "tour_skipped", "checkout_opened"]);

/** The signed-in session, as much of it as a step needs. */
export interface FunnelSession {
  accessToken: string;
  userId: string;
}

export interface FunnelRecorderDeps {
  /** the project's URL (NEXT_PUBLIC_SUPABASE_URL); without it nothing is sent */
  url: string | undefined;
  /** NEXT_PUBLIC_SUPABASE_ANON_KEY */
  anonKey: string | undefined;
  /** the session now, or null when signed out */
  getSession: () => Promise<FunnelSession | null>;
  fetch: typeof fetch;
}

export type RecordFunnelStep = (step: FunnelStep, meta?: Record<string, unknown>) => Promise<void>;

export function createFunnelRecorder({ url, anonKey, getSession, fetch: send }: FunnelRecorderDeps): RecordFunnelStep {
  const endpoint = url ? `${url.replace(/\/+$/, "")}/rest/v1/rpc/${RECORD_FUNNEL_STEP}` : null;
  /** `<user>:<step>` of the once-a-load steps sent so far */
  const sent = new Set<string>();
  return async (step, meta) => {
    if (!endpoint || !anonKey || !isFunnelStep(step)) return;
    try {
      const session = await getSession();
      if (!session?.accessToken) return;
      if (!EVERY_TIME.has(step)) {
        const key = `${session.userId}:${step}`;
        if (sent.has(key)) return;
        sent.add(key);
      }
      void send(endpoint, {
        method: "POST",
        headers: { apikey: anonKey, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_step: step, p_meta: cleanMeta(meta) }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // no session to read, or no fetch: the step is not recorded, and nothing else changes
    }
  };
}

/**
 * The app's recorder: the session of the app's Supabase client, and its retry of a token "issued at
 * future" (supabaseFetch.ts), which the welcome's step, moments after sign-up, can meet.
 */
export const recordFunnelStep: RecordFunnelStep = createFunnelRecorder({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  getSession: async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    return session ? { accessToken: session.access_token, userId: session.user.id } : null;
  },
  fetch: createSkewRetryFetch(),
});
