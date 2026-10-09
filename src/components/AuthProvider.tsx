"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { RefreshCw, WifiOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { installClientLogCapture } from "@/lib/logger";
import { reportUserError } from "@/lib/reportAppError";
import { classifyAuthLoadError } from "@/lib/authState";
import { watchAuthUser } from "@/lib/authUserChange";
import { Button } from "@/components/ui/button";

if (typeof window !== "undefined") {
  installClientLogCapture();
}

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  /** True until the first getSession() attempt settles (success or failure). */
  loading: boolean;
  /**
   * Set when getSession() could not reach the sign-in service (offline, DNS,
   * 5xx, clock skew). Null on the happy path and when the user is merely
   * signed out. Pages render <AuthErrorBanner /> instead of redirecting.
   */
  authError: string | null;
  /** Re-runs the session lookup. No-op while a lookup is in flight. */
  retryAuth: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  authError: null,
  retryAuth: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // Bumped by retryAuth(); the effect below re-subscribes and re-reads.
  const [attempt, setAttempt] = useState(0);

  const retryAuth = useCallback(() => {
    setLoading(true);
    setAuthError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Another tab switched profile (or someone else signed in): this page belongs to the user it
    // loaded as, so it leaves for a fresh home as the new one, never showing or saving the old
    // user's things as them (src/lib/authUserChange.ts). The board's device backup is written on
    // pagehide, so unsaved strokes survive the trip.
    const watch = watchAuthUser({ leave: () => window.location.replace("/") });

    function settle(err: unknown) {
      const outcome = classifyAuthLoadError(err);
      setSession(null);
      if (outcome.kind === "error") {
        console.error("Failed to reach the auth service:", err);
        setAuthError(outcome.message);
        // the banner's heading and the status (a 429 or 5xx from Auth, or none: offline, DNS)
        const status = (err as { status?: unknown } | null)?.status;
        reportUserError({ kind: "live.auth", code: typeof status === "number" ? `unreachable_${status}` : "unreachable", message: AUTH_BANNER_TITLE });
      } else {
        // Stored session is simply not valid any more: behave as signed out.
        console.warn("Auth session not restored:", err);
        setAuthError(null);
      }
    }

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          settle(error);
        } else {
          watch.settle(data.session);
          setSession(data.session);
          setAuthError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        settle(err);
      })
      .finally(() => {
        // Always resolve the loading gate, even if getSession rejects, so the
        // app never sticks on the spinner; pages show the banner instead.
        if (!cancelled) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (cancelled) return;
      // false: another user's session arrived from another tab, and this page is leaving
      if (!watch.change(event, s)) return;
      if (event === "SIGNED_OUT") {
        setSession(null);
        setLoading(false);
        return;
      }
      setSession(s);
      if (s) setAuthError(null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [attempt]);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        authError,
        retryAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export const AUTH_BANNER_TITLE = "Can't reach the sign-in service";

/**
 * Small banner pages render when `authError` is set. Keeps the page usable
 * (no infinite spinner) and offers a Retry that re-runs getSession().
 */
export function AuthErrorBanner({ className = "" }: { className?: string }) {
  const { authError, loading, retryAuth } = useAuth();
  if (!authError) return null;
  return (
    <div
      role="alert"
      data-state="auth-error"
      className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${className}`}
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{AUTH_BANNER_TITLE}</p>
        <p className="opacity-80">{authError}</p>
      </div>
      <Button variant="outline" size="sm" onClick={retryAuth} disabled={loading}>
        <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
        Retry
      </Button>
    </div>
  );
}
