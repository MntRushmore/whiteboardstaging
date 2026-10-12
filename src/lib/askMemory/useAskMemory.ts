"use client";

import { useCallback, useEffect, useState } from "react";
import type { LearnerMemory } from "@/lib/live/ask/contracts";
import { describeError } from "@/lib/errorMessage";
import { clearAskMemory, loadAskMemory } from "./client";
import { ASK_MEMORY_COPY } from "./copy";

export interface AskMemoryState {
  memory: LearnerMemory | null;
  loading: boolean;
  /** the read failed (the card shows it with Try again) */
  error: string | null;
  clearing: boolean;
  reload: () => void;
  /** clears the notes; resolves false (with `clearError` set) when it could not */
  clear: () => Promise<boolean>;
  clearError: string | null;
}

/** What Ask remembers about the signed-in profile, or (with `kidId`) one of the grown-up's kids. Read while `enabled`. */
export function useAskMemory(kidId: string | null, enabled: boolean): AskMemoryState {
  const [memory, setMemory] = useState<LearnerMemory | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // another kid's notes never show while this one's load
    setMemory(null);
    setLoading(true);
    setError(null);
    setClearError(null);
    loadAskMemory(kidId)
      .then((m) => {
        if (!cancelled) setMemory(m);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err, ASK_MEMORY_COPY.loadFallback));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kidId, enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const clear = useCallback(async () => {
    setClearing(true);
    setClearError(null);
    try {
      setMemory(await clearAskMemory(kidId));
      return true;
    } catch (err) {
      setClearError(describeError(err, ASK_MEMORY_COPY.clearFailed));
      return false;
    } finally {
      setClearing(false);
    }
  }, [kidId]);

  return { memory, loading, error, clearing, reload, clear, clearError };
}
