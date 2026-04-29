"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";

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

export function useFeatureLabs() {
  const { user } = useAuth();
  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(
    () => readCache() ?? DEFAULT_FEATURES,
  );
  const [loading, setLoading] = useState(true);

  // Pull authoritative state from Supabase on mount / user change.
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_settings")
        .select("features")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (!error && data?.features) {
        const merged = { ...DEFAULT_FEATURES, ...data.features };
        setFeatures(merged);
        writeCache(merged);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const setFeature = useCallback(
    async (key: FeatureKey, enabled: boolean) => {
      // Optimistic update + cache.
      setFeatures((prev) => {
        const next = { ...prev, [key]: enabled };
        writeCache(next);
        return next;
      });

      if (!user) return;

      const next = { ...features, [key]: enabled };
      const { error } = await supabase.from("user_settings").upsert({
        user_id: user.id,
        features: next,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        console.error("Failed to persist feature toggle", error);
      }
    },
    [features, user],
  );

  return { features, setFeature, loading };
}
