"use client";

import { useState, useCallback } from "react";

export type AIPerfSettings = {
  fastMode: boolean;
  downscaleEnabled: boolean;
  downscaleMaxEdge: number;
  downscaleQuality: number;
  skeletonEnabled: boolean;
};

export const DEFAULT_AI_PERF_SETTINGS: AIPerfSettings = {
  fastMode: false,
  downscaleEnabled: false,
  downscaleMaxEdge: 1024,
  downscaleQuality: 0.85,
  skeletonEnabled: true,
};

const STORAGE_KEY = "agathon.aiPerf.v1";

function readCache(): AIPerfSettings {
  if (typeof window === "undefined") return DEFAULT_AI_PERF_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_PERF_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_AI_PERF_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_AI_PERF_SETTINGS;
  }
}

function writeCache(settings: AIPerfSettings) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore quota errors */
  }
}

export function useAIPerfSettings() {
  const [settings, setSettings] = useState<AIPerfSettings>(() => readCache());

  const update = useCallback((patch: Partial<AIPerfSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeCache(next);
      return next;
    });
  }, []);

  return { settings, update };
}
