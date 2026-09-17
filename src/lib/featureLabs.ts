"use client";

import { useEffect, useReducer, useCallback, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { describeError } from "@/lib/errorMessage";
import {
  FEATURE_SAVE_FAILED_MESSAGE,
  FEATURE_SAVE_FAILED_TOAST,
  canFetchSettings,
  featureLabsReducer,
  type FeatureLabsState,
  type SaveFailure,
} from "@/lib/featureLabsState";

export type FeatureKey = "stickers" | "worksheetGen" | "pdfUpload";

export type FeatureMeta = {
  key: FeatureKey;
  title: string;
  description: string;
  status: "experimental" | "beta";
  icon: string; // lucide name
};

export const FEATURES: FeatureMeta[] = [
  {
    key: "stickers",
    title: "Sticker library",
    description:
      "Insert ready-made math, science, and writing scaffolds — number lines, coordinate grids, fraction bars, atoms, essay outlines.",
    status: "beta",
    icon: "Sparkles",
  },
  {
    key: "worksheetGen",
    title: "Worksheet generator",
    description:
      "Type a topic and generate a printable worksheet directly onto the canvas. Locked from AI editing.",
    status: "experimental",
    icon: "FileText",
  },
  {
    key: "pdfUpload",
    title: "PDF worksheet upload",
    description:
      "Upload a worksheet PDF and write on top of it. The AI sees only your strokes — never the original worksheet.",
    status: "experimental",
    icon: "Upload",
  },
];

export const DEFAULT_FEATURES: Record<FeatureKey, boolean> = {
  stickers: false,
  worksheetGen: false,
  pdfUpload: false,
};

const STORAGE_KEY = "agathon.featureLabs.v1";

function readCache(): Record<FeatureKey, boolean> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_FEATURES, ...parsed };
  } catch {
    return null;
  }
}

function writeCache(features: Record<FeatureKey, boolean>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(features));
  } catch {
    /* ignore quota errors */
  }
}

export type FeatureSaveFailure = SaveFailure<FeatureKey>;

export function useFeatureLabs() {
  const { user, session } = useAuth();
  const [state, dispatch] = useReducer(
    featureLabsReducer<FeatureKey>,
    undefined,
    (): FeatureLabsState<FeatureKey> => ({
      features: readCache() ?? DEFAULT_FEATURES,
      saving: null,
      failure: null,
    }),
  );
  // Latest features for the persist call, without re-creating setFeature on
  // every render (which would also re-run consumers' effects).
  const featuresRef = useRef(state.features);
  useEffect(() => {
    featuresRef.current = state.features;
  }, [state.features]);

  // The user id whose settings have been fetched from Supabase. `loading` is
  // derived from it so the effect never needs a synchronous setState.
  const [loadedUserId, markLoaded] = useReducer(
    (_: string | null, id: string | null) => id,
    null,
  );
  const loading = !!user && loadedUserId !== user.id;

  // user_settings is RLS-protected: only ask once the session carries a bearer
  // token, otherwise the request is a guaranteed 401 (one per page load).
  const accessToken = session?.access_token ?? null;
  const userId = session?.user?.id ?? null;
  const ready = canFetchSettings(session);

  useEffect(() => {
    if (!ready || !userId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_settings")
        .select("features")
        .eq("user_id", userId)
        .maybeSingle();

      if (cancelled) return;

      if (!error && data?.features) {
        const merged = { ...DEFAULT_FEATURES, ...data.features };
        dispatch({ type: "loaded", features: merged });
        writeCache(merged);
      } else if (error) {
        // Keep the cached copy; the panel still works and persists will retry.
        console.warn("Feature Labs settings not loaded:", error);
      }
      markLoaded(userId);
    })();

    return () => {
      cancelled = true;
    };
    // accessToken is listed so a fresh token after a retry re-triggers the load.
  }, [ready, userId, accessToken]);

  const setFeature = useCallback(
    async (key: FeatureKey, enabled: boolean) => {
      const previous = featuresRef.current[key];
      const next = { ...featuresRef.current, [key]: enabled };
      // Optimistic update + cache.
      dispatch({ type: "toggle", key, enabled });
      writeCache(next);

      if (!user) {
        dispatch({ type: "persisted", key });
        return;
      }

      const { error } = await supabase.from("user_settings").upsert({
        user_id: user.id,
        features: next,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        console.error("Failed to persist feature toggle", error);
        const reverted = { ...featuresRef.current, [key]: previous };
        writeCache(reverted);
        dispatch({
          type: "persistFailed",
          key,
          wanted: enabled,
          previous,
          message: describeError(error, FEATURE_SAVE_FAILED_MESSAGE),
        });
        toast.error(FEATURE_SAVE_FAILED_TOAST);
        return;
      }
      dispatch({ type: "persisted", key });
    },
    [user],
  );

  /** Re-sends the toggle that failed, if any. */
  const retrySave = useCallback(() => {
    const f = state.failure;
    if (!f) return;
    void setFeature(f.key, f.wanted);
  }, [state.failure, setFeature]);

  const dismissSaveFailure = useCallback(() => dispatch({ type: "dismissFailure" }), []);

  return {
    features: state.features,
    setFeature,
    loading,
    saving: state.saving,
    saveFailure: state.failure,
    retrySave,
    dismissSaveFailure,
  };
}
