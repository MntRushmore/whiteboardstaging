"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { installClientLogCapture } from "@/lib/logger";

if (typeof window !== "undefined") {
  installClientLogCapture();
}

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to read auth session:", error);
          setSession(null);
        } else {
          setSession(data.session);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("Failed to read auth session:", err);
        setSession(null);
      })
      .finally(() => {
        // Always resolve the loading gate, even if getSession rejects, so the
        // app never sticks on the spinner.
        if (!cancelled) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (cancelled) return;
      if (event === "SIGNED_OUT") {
        setSession(null);
        setLoading(false);
        return;
      }
      setSession(s);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{ user: session?.user ?? null, session, loading }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
